export const verifierKinds = [
  "proof-audit",
  "premise-audit",
  "reconstruction",
] as const;

export type VerifierKind = (typeof verifierKinds)[number];
export type DirectVerifierKind = Exclude<VerifierKind, "reconstruction">;
