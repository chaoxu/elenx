import {
  createCampaign,
  deriveCandidateStatus,
  finalizeVerdict,
  submitVerdictTool,
} from "elenx";
import { builtinPi, runPi } from "elenx/pi";

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
  const audit = await runPi(campaign, {
    models,
    model,
    label: verifier,
    system:
      "Audit the supplied claim adversarially. Call submit_verdict exactly once with the reason in evidence, then stop.",
    prompt: stored,
    candidate,
    tools: [submitVerdictTool],
    stopAfterToolResult: true,
  });
  if (audit.state !== "succeeded") throw new Error(audit.error);
  finalizeVerdict(campaign, audit.call);
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
