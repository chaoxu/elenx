import { z } from "zod";

import { createCampaign, openReader, type Verdict } from "elenx";

const verifier = "hostile-audit/v1";
const verdict = z.enum(["PASS", "FAIL", "INCONCLUSIVE"]);

export interface AuditReport {
  readonly candidate: string;
  readonly verdict: Verdict;
  readonly verified: boolean;
}

export function parseVerdict(text: string): Verdict {
  return verdict.parse(text.split(/\r?\n/, 1)[0]?.trim());
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
      request: {
        prompt: "Audit the candidate and return PASS, FAIL, or INCONCLUSIVE.",
        candidate,
      },
    },
    async () => ({
      state: "succeeded",
      text: "PASS\nThe scripted verifier accepts this fixture.",
    }),
  );
  const text = z
    .strictObject({ state: z.literal("succeeded"), text: z.string() })
    .parse(audit.output).text;
  const result = parseVerdict(text);
  campaign.recordVerdict(candidate, verifier, audit.id, result, { text });
  campaign.close();

  const reader = openReader(path);
  try {
    return {
      candidate,
      verdict: result,
      verified: reader.status(candidate).verified,
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
