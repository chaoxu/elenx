import { z } from "zod";

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

export const entryId = z.number().int().positive();
export type EntryId = z.output<typeof entryId>;
export const json = z.json() as z.ZodType<Json>;
export const verdict = z.enum(["PASS", "FAIL", "INCONCLUSIVE"]);

const base = {
  seq: entryId,
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
    requiredVerifiers: z.array(z.string().min(1)).min(1).readonly(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("verdict"),
    call: entryId,
    verdict,
    evidence: json,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("call"),
    label: z.string().min(1),
    candidate: entryId.optional(),
    request: json,
    tools: z.array(tool).readonly(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("tool-call"),
    call: entryId,
    tool: z.string().min(1),
    source: z.string().min(1).optional(),
    input: json,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("call-result"),
    parent: entryId,
    state: z.literal("returned"),
    output: json,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("call-result"),
    parent: entryId,
    state: z.literal("threw"),
    error: z.string(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("tool-result"),
    parent: entryId,
    state: z.literal("returned"),
    output: json,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("tool-result"),
    parent: entryId,
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
