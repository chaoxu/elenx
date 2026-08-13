import { createCampaign } from "elenx";
import { builtinPi, runPi } from "elenx/pi";
import { parseVerdict } from "./hostile-audit";

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
  const audit = await runPi(campaign, {
    models,
    model,
    label: verifier,
    system: "Audit the supplied claim adversarially.",
    prompt:
      "Return PASS, FAIL, or INCONCLUSIVE on the first line, then explain briefly.\n\n" +
      new TextDecoder().decode(material),
    candidate,
  });
  if (audit.state !== "succeeded") throw new Error(audit.error);
  const verdict = parseVerdict(audit.text);
  campaign.recordVerdict(candidate, verifier, audit.call, verdict, {
    text: audit.text,
  });
  if (campaign.status(candidate).promotable) campaign.promote(candidate);
  console.log(JSON.stringify(campaign.status(candidate), null, 2));
} finally {
  campaign.close();
}
