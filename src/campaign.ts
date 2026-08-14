import { z } from "zod";

import { Journal } from "./db";
import { copyJson, entryId, verdict as verdictSchema } from "./schemas";
import { status as deriveStatus } from "./verification";
import type {
  AuditedTool,
  CallContext,
  CallOptions,
  CallReceipt,
  Campaign,
  CandidateStatus,
  Entry,
  EntryId,
  Json,
  Reader,
  Tool,
  Verdict,
} from "./types";

interface PreparedTool {
  readonly declaration: Omit<AuditedTool, "execute">;
  readonly input: Tool["input"];
  readonly run: Tool["run"];
}

interface CallState {
  readonly pending: Set<Promise<Json>>;
  accepting: boolean;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function names(values: readonly string[]): readonly string[] {
  return [...new Set(z.array(z.string().min(1)).min(1).parse(values))].sort();
}

class CampaignReader implements Reader {
  constructor(protected readonly journal: Journal) {}

  records(): readonly Entry[] {
    return this.journal.records();
  }

  material(candidate: EntryId): Uint8Array {
    return this.journal.material(candidate);
  }

  status(candidate: EntryId): CandidateStatus {
    return deriveStatus(this.records(), entryId.parse(candidate));
  }

  close(): void {
    this.journal.close();
  }
}

class CampaignWriter extends CampaignReader implements Campaign {
  #activeCalls = 0;

  submitCandidate(
    material: Uint8Array,
    requiredVerifiers: readonly string[],
  ): EntryId {
    const required = names(requiredVerifiers);
    return this.journal.append(
      {
        kind: "candidate",
        requiredVerifiers: required,
      },
      material,
    ).seq;
  }

  recordVerdict(
    callValue: EntryId,
    verdictValue: Verdict,
    evidenceValue: Json,
  ): EntryId {
    const call = entryId.parse(callValue);
    const verdict = verdictSchema.parse(verdictValue);
    const evidence = copyJson(evidenceValue);
    const records = this.records();
    const start = records.find(
      (entry) => entry.kind === "call" && entry.seq === call,
    );
    const candidate = start?.kind === "call" ? start.candidate : undefined;
    const declaration = records.find(
      (entry) => entry.kind === "candidate" && entry.seq === candidate,
    );
    const result = records.find(
      (entry) => entry.kind === "call-result" && entry.parent === call,
    );
    if (
      start?.kind !== "call" ||
      candidate === undefined ||
      declaration?.kind !== "candidate" ||
      start.seq <= declaration.seq ||
      !declaration.requiredVerifiers.includes(start.label) ||
      result?.kind !== "call-result" ||
      result.state !== "returned" ||
      !isObject(result.output) ||
      result.output.state !== "succeeded"
    ) {
      throw new Error("verdict requires a fresh successful verifier call");
    }
    return this.journal.append({
      kind: "verdict",
      call,
      verdict,
      evidence,
    }).seq;
  }

  async call(
    options: CallOptions,
    runner: (context: CallContext) => Promise<unknown>,
  ): Promise<CallReceipt> {
    const label = z.string().min(1).parse(options.label);
    const candidate =
      options.candidate === undefined
        ? undefined
        : entryId.parse(options.candidate);
    const request = copyJson(options.request);
    const signal = options.signal ?? new AbortController().signal;
    const prepared = this.prepareTools(options.tools ?? []);
    const state: CallState = { pending: new Set(), accepting: true };
    const start = this.journal.append({
      kind: "call",
      label,
      ...(candidate === undefined ? {} : { candidate }),
      request,
      tools: prepared.map(({ declaration }) => declaration),
    });
    const call = start.seq;
    const tools = prepared.map((tool) =>
      this.wrapTool(call, tool, signal, state),
    );
    this.#activeCalls += 1;
    let output: Json | undefined;
    let failure: unknown;
    try {
      output = copyJson(await runner({ request, tools, signal }));
    } catch (error) {
      failure = error;
    } finally {
      state.accepting = false;
      await Promise.allSettled([...state.pending]);
    }
    try {
      if (failure !== undefined || output === undefined) {
        this.journal.append({
          kind: "call-result",
          parent: call,
          state: "threw",
          error: errorText(failure),
        });
        throw failure;
      }
      this.journal.append({
        kind: "call-result",
        parent: call,
        state: "returned",
        output,
      });
      return { call, output };
    } finally {
      this.#activeCalls -= 1;
    }
  }

  private prepareTools(tools: readonly Tool[]): readonly PreparedTool[] {
    const seen = new Set<string>();
    return tools.map((tool) => {
      const name = z.string().min(1).parse(tool.name);
      if (seen.has(name)) throw new Error(`duplicate tool name: ${name}`);
      seen.add(name);
      const description = z.string().min(1).parse(tool.description);
      const input = tool.input;
      const inputSchema = copyJson(z.toJSONSchema(input));
      return {
        declaration: { name, description, inputSchema },
        input,
        run: tool.run.bind(tool),
      };
    });
  }

  private wrapTool(
    call: EntryId,
    tool: PreparedTool,
    signal: AbortSignal,
    state: CallState,
  ): AuditedTool {
    const { name, description, inputSchema } = tool.declaration;
    return {
      name,
      description,
      inputSchema,
      execute: async (raw, sourceValue) => {
        if (!state.accepting) {
          return Promise.reject(
            new Error(`call is no longer accepting ${name}`),
          );
        }
        const input = copyJson(tool.input.parse(raw));
        const source =
          sourceValue === undefined
            ? undefined
            : z.string().min(1).parse(sourceValue);
        const toolCall = this.journal.append({
          kind: "tool-call",
          call,
          tool: name,
          ...(source === undefined ? {} : { source }),
          input,
        }).seq;
        const execution = (async () => {
          let output: Json;
          try {
            output = copyJson(await tool.run(input, signal));
          } catch (error) {
            this.journal.append({
              kind: "tool-result",
              parent: toolCall,
              state: "threw",
              error: errorText(error),
            });
            throw error;
          }
          this.journal.append({
            kind: "tool-result",
            parent: toolCall,
            state: "returned",
            output,
          });
          return output;
        })();
        state.pending.add(execution);
        void execution
          .finally(() => state.pending.delete(execution))
          .catch(() => {});
        return execution;
      },
    };
  }

  override close(): void {
    if (this.#activeCalls > 0) throw new Error("campaign has active calls");
    super.close();
  }
}

function isObject(value: Json): value is { readonly [key: string]: Json } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createCampaign(
  path: string,
  application: string,
  config: Json,
): Campaign {
  return new CampaignWriter(
    Journal.create(
      path,
      z.string().min(1).parse(application),
      copyJson(config),
    ),
  );
}

export function openCampaign(path: string): Campaign {
  return new CampaignWriter(Journal.open(path, "write"));
}

export function openReader(path: string): Reader {
  return new CampaignReader(Journal.open(path, "read"));
}
