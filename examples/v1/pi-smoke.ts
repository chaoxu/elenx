import { createCampaign } from "elenx";
import { runPi } from "elenx/pi";
import { parseVerdict } from "./hostile-audit";

const [path, provider, modelId] = process.argv.slice(2);
if (path === undefined || provider === undefined || modelId === undefined) {
  throw new Error(
    "usage: bun examples/v1/pi-smoke.ts CAMPAIGN.db PROVIDER MODEL_ID",
  );
}

const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
const models = await ModelRuntime.create({ modelsPath: null });
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
    system: "Audit the supplied claim adversarially.",
    prompt:
      "Return PASS, FAIL, or INCONCLUSIVE on the first line, then explain briefly.\n\n" +
      stored,
    candidate,
  });
  if (audit.state !== "succeeded") throw new Error(audit.error);
  const verdict = parseVerdict(audit.text);
  campaign.recordVerdict(audit.call, verdict, {
    text: audit.text,
  });
  console.log(
    JSON.stringify({ candidate, ...campaign.status(candidate) }, null, 2),
  );
} finally {
  campaign.close();
}
