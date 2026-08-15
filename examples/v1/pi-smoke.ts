import { createCampaign, defineTool, deriveCandidateStatus } from "elenx";
import { builtinPi, runPi } from "elenx/pi";
import { verdictSubmission } from "./hostile-audit";

const [path, provider, modelId] = process.argv.slice(2);
if (path === undefined || provider === undefined || modelId === undefined) {
  throw new Error(
    "usage: bun examples/v1/pi-smoke.ts CAMPAIGN.db PROVIDER MODEL_ID",
  );
}

const models = builtinPi();
const model = models.getModel(provider, modelId);
if (model === undefined)
  throw new Error(`unknown Pi model: ${provider}/${modelId}`);

const verifier = "hostile-audit/v1";
const material = new TextEncoder().encode(
  "Every finite tree has one fewer edge than vertices.",
);
const campaign = createCampaign(path, "pi-hostile-audit", { revision: 1 });
try {
  const candidate = campaign.submitCandidate(material, [verifier]);
  const stored = new TextDecoder().decode(campaign.material(candidate));
  const submitVerdict = defineTool({
    name: "submit_verdict",
    description: "Submit the hostile audit verdict and reason",
    input: verdictSubmission,
    replay: "safe",
    async run() {
      return null;
    },
  });
  const audit = await runPi(campaign, {
    models,
    model,
    label: verifier,
    system:
      "Audit the supplied claim adversarially. Call submit_verdict exactly once, then stop.",
    prompt: stored,
    candidate,
    tools: [submitVerdict],
    stopAfterToolResult: true,
  });
  if (audit.state !== "succeeded") throw new Error(audit.error);
  const submissions = campaign
    .records()
    .flatMap((entry) =>
      entry.kind === "tool-call" &&
      entry.call === audit.call &&
      entry.tool === submitVerdict.name
        ? [entry]
        : [],
    );
  if (submissions.length !== 1) {
    throw new Error("audit did not submit exactly one verdict");
  }
  const submission = submissions[0]!;
  const report = verdictSubmission.parse(submission.input);
  campaign.recordVerdict(audit.call, report.verdict, {
    submission: submission.seq,
    reason: report.reason,
  });
  console.log(
    JSON.stringify(
      { candidate, ...deriveCandidateStatus(campaign.records(), candidate) },
      null,
      2,
    ),
  );
} finally {
  campaign.close();
}
