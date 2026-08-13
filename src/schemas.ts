import { z } from "zod";

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

export type Hash = `sha256:${string}`;
export type CallId = `call:${string}`;
export type ToolCallId = `tool:${string}`;

export const hash = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/) as z.ZodType<Hash>;
const callId = z.string().startsWith("call:") as z.ZodType<CallId>;
const toolCallId = z.string().startsWith("tool:") as z.ZodType<ToolCallId>;
export const json = z.json() as z.ZodType<Json>;
export const verdict = z.enum(["PASS", "FAIL", "INCONCLUSIVE"]);

const base = {
  seq: z.number().int().positive(),
  atMs: z.number().int().nonnegative(),
};
const tool = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1),
  inputSchema: json,
});

export const entry = z.union([
  z.strictObject({
    ...base,
    kind: z.literal("campaign"),
    application: z.string().min(1),
    config: json,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("candidate"),
    candidate: hash,
    requiredVerifiers: z.array(z.string().min(1)).min(1).readonly(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("verdict"),
    candidate: hash,
    verifier: z.string().min(1),
    call: callId,
    verdict,
    evidence: json,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("call"),
    id: callId,
    label: z.string().min(1),
    request: json,
    tools: z.array(tool).readonly(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("tool-call"),
    id: toolCallId,
    call: callId,
    tool: z.string().min(1),
    source: z.string().min(1).optional(),
    input: json,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("tool-result"),
    id: toolCallId,
    state: z.literal("returned"),
    output: json,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("tool-result"),
    id: toolCallId,
    state: z.literal("threw"),
    error: z.string(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("call-result"),
    call: callId,
    state: z.literal("returned"),
    output: json,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("call-result"),
    call: callId,
    state: z.literal("threw"),
    error: z.string(),
  }),
]);

export type Entry = z.output<typeof entry>;
export type EntryDraft = Entry extends infer E
  ? E extends Entry
    ? Omit<E, "seq" | "atMs">
    : never
  : never;
export type ToolDeclaration = z.output<typeof tool>;
export type Verdict = z.output<typeof verdict>;

export function copyJson(value: unknown): Json {
  return json.parse(value);
}

export function parseHash(value: unknown): Hash {
  return hash.parse(value);
}
