import { z } from "zod";

import {
  createCampaign,
  deriveCandidateStatus,
  openReader,
  verdictSchema,
  type EntryId,
  type Verdict,
} from "elenx";

const verifier = "hostile-audit/v1";
export const verdictSubmission = z.strictObject({
  verdict: verdictSchema,
  reason: z.string().min(1),
});
const scriptedAuditResult = verdictSubmission.extend({
  state: z.literal("succeeded"),
});

export interface AuditReport {
  readonly candidate: EntryId;
  readonly verdict: Verdict;
  readonly verified: boolean;
}

export async function runHostileAudit(path: string): Promise<AuditReport> {
  const campaign = createCampaign(path, "hostile-audit-example", {
    revision: 1,
  });
  const material = new TextEncoder().encode(
    "Every finite tree has one fewer edge than vertices.",
  );
  const candidate = campaign.submitCandidate(material, [verifier]);
  const audit = await campaign.call(
    {
      label: verifier,
      candidate,
      request: {
        prompt: "Audit the candidate and return PASS, FAIL, or INCONCLUSIVE.",
      },
    },
    async () => ({
      state: "succeeded",
      verdict: "PASS" as const,
      reason: "The scripted verifier accepts this fixture.",
    }),
  );
  const result = scriptedAuditResult.parse(audit.output);
  campaign.recordVerdict(audit.call, result.verdict, {
    reason: result.reason,
  });
  campaign.close();

  const reader = openReader(path);
  try {
    return {
      candidate,
      verdict: result.verdict,
      verified: deriveCandidateStatus(reader.records(), candidate).verified,
    };
  } finally {
    reader.close();
  }
}

if (import.meta.main) {
  const path = process.argv[2];
  if (path === undefined)
    throw new Error("usage: bun examples/v1/hostile-audit.ts CAMPAIGN.db");
  console.log(JSON.stringify(await runHostileAudit(path), null, 2));
}
