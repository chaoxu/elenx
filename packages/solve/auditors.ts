import { z } from "zod";

import { verifierResult, type Verifier, type VerifierInput } from "./roles";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "must contain non-whitespace text",
});

export const auditResult = z.strictObject({
  verdict: z.enum(["PASS", "FAIL"]),
  report: nonblank,
});
export type AuditResult = z.output<typeof auditResult>;

export const auditorDefinitions = [
  {
    name: "requirements",
    instruction:
      "Check the declared candidate kind against the exact target and every completion criterion.",
  },
  {
    name: "correctness",
    instruction: "Check every load-bearing mathematical claim.",
  },
  {
    name: "adversarial",
    instruction:
      "Actively search for counterexamples, missing cases, invalid bounds, and reasons the claimed resolution does not follow. Pass the candidate when this search finds no blocking defect.",
  },
] as const;
export type AuditorName = (typeof auditorDefinitions)[number]["name"];
export type AuditorInput = VerifierInput;
export type Auditor = (input: AuditorInput) => Promise<AuditResult>;
export type AuditorSet = { readonly [Name in AuditorName]: Auditor };

export function verifierFromAuditors(implementations: AuditorSet): Verifier {
  return async (input) => {
    for (const { name } of auditorDefinitions) {
      const result = auditResult.parse(await implementations[name](input));
      if (result.verdict === "FAIL") {
        return verifierResult.parse({
          verdict: "REJECT",
          report: `${name}: ${result.report}`,
        });
      }
    }
    return verifierResult.parse({
      verdict: "ACCEPT",
      report: "Every required audit completed without a blocking defect.",
    });
  };
}
