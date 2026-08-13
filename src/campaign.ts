import { z } from "zod";

import { Journal } from "./db";
import { copyJson, parseHash, verdict as verdictSchema } from "./schemas";
import { status as deriveStatus } from "./verification";
import type {
  AuditedTool,
  CallContext,
  CallId,
  CallOptions,
  CallReceipt,
  Campaign,
  CandidateStatus,
  Entry,
  Hash,
  Json,
  Reader,
  Tool,
  ToolCallId,
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

  blob(hash: Hash): Uint8Array {
    return this.journal.blob(hash);
  }

  status(candidate: Hash): CandidateStatus {
    return deriveStatus(this.records(), parseHash(candidate));
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
  ): Hash {
    const candidate = this.journal.put(Uint8Array.from(material));
    const required = names(requiredVerifiers);
    return this.journal.transaction(() => {
      const existing = this.records().find(
        (entry) => entry.kind === "candidate" && entry.candidate === candidate,
      );
      if (existing?.kind === "candidate") {
        if (
          existing.requiredVerifiers.length !== required.length ||
          existing.requiredVerifiers.some(
            (verifier, index) => verifier !== required[index],
          )
        ) {
          throw new Error(`candidate contract conflict: ${candidate}`);
        }
        return candidate;
      }
      this.journal.append({
        kind: "candidate",
        candidate,
        requiredVerifiers: required,
      });
      return candidate;
    });
  }

  recordVerdict(
    candidateValue: Hash,
    verifierValue: string,
    call: CallId,
    verdictValue: Verdict,
    evidenceValue: Json,
  ): Entry {
    const candidate = parseHash(candidateValue);
    const verifier = z.string().min(1).parse(verifierValue);
    const verdict = verdictSchema.parse(verdictValue);
    const evidence = copyJson(evidenceValue);
    return this.journal.transaction(() => {
      const records = this.records();
      const declaration = records.find(
        (entry) => entry.kind === "candidate" && entry.candidate === candidate,
      );
      if (declaration?.kind !== "candidate") {
        throw new Error(`candidate not found: ${candidate}`);
      }
      if (!declaration.requiredVerifiers.includes(verifier)) {
        throw new Error(`verifier is not required by candidate: ${verifier}`);
      }
      if (
        records.some(
          (entry) =>
            entry.kind === "promotion" && entry.candidate === candidate,
        )
      ) {
        throw new Error(`candidate is already promoted: ${candidate}`);
      }
      const start = records.find(
        (entry) => entry.kind === "call" && entry.id === call,
      );
      const result = records.find(
        (entry) => entry.kind === "call-result" && entry.call === call,
      );
      if (
        start?.kind !== "call" ||
        start.label !== verifier ||
        start.seq <= declaration.seq ||
        result?.kind !== "call-result" ||
        result.state !== "returned" ||
        !isObject(start.request) ||
        start.request.candidate !== candidate ||
        !isObject(result.output) ||
        result.output.state !== "succeeded"
      ) {
        throw new Error(`verdict requires a fresh successful ${verifier} call`);
      }
      if (
        records.some((entry) => entry.kind === "verdict" && entry.call === call)
      ) {
        throw new Error(`call already has a verdict: ${call}`);
      }
      return this.journal.append({
        kind: "verdict",
        candidate,
        verifier,
        call,
        verdict,
        evidence,
      });
    });
  }

  promote(candidateValue: Hash): Entry {
    const candidate = parseHash(candidateValue);
    return this.journal.transaction(() => {
      const records = this.records();
      const existing = records.find(
        (entry) => entry.kind === "promotion" && entry.candidate === candidate,
      );
      if (existing?.kind === "promotion") return existing;
      const check = deriveStatus(records, candidate);
      if (!check.promotable) {
        throw new Error(`candidate is not promotable: ${candidate}`);
      }
      return this.journal.append({
        kind: "promotion",
        candidate,
        verdicts: check.passes,
      });
    });
  }

  async call(
    options: CallOptions,
    runner: (context: CallContext) => Promise<unknown>,
  ): Promise<CallReceipt> {
    const label = z.string().min(1).parse(options.label);
    const request = copyJson(options.request);
    const signal = options.signal ?? new AbortController().signal;
    const call = `call:${crypto.randomUUID()}` as CallId;
    const prepared = this.prepareTools(options.tools ?? []);
    const state: CallState = { pending: new Set(), accepting: true };
    const tools = prepared.map((tool) =>
      this.wrapTool(call, tool, signal, state),
    );
    this.journal.append({
      kind: "call",
      id: call,
      label,
      request,
      tools: tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    });
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
          call,
          state: "threw",
          error: errorText(failure),
        });
        throw failure;
      }
      this.journal.append({
        kind: "call-result",
        call,
        state: "returned",
        output,
      });
      return { id: call, output };
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
    call: CallId,
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
        const id = `tool:${crypto.randomUUID()}` as ToolCallId;
        this.journal.append({
          kind: "tool-call",
          id,
          call,
          tool: name,
          ...(source === undefined ? {} : { source }),
          input,
        });
        const execution = (async () => {
          let output: Json;
          try {
            output = copyJson(await tool.run(input, signal));
          } catch (error) {
            this.journal.append({
              kind: "tool-result",
              id,
              state: "threw",
              error: errorText(error),
            });
            throw error;
          }
          this.journal.append({
            kind: "tool-result",
            id,
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
  return new CampaignWriter(Journal.open(path));
}

export function openReader(path: string): Reader {
  return new CampaignReader(Journal.open(path, true));
}
