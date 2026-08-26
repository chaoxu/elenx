import { openCampaign } from "elenx";

const [path, label, candidateText, requestText] = Bun.argv.slice(2);
if (
  path === undefined ||
  label === undefined ||
  candidateText === undefined ||
  requestText === undefined
) {
  throw new Error("missing unsettled source fixture argument");
}

const campaign = openCampaign(path);
await campaign.call(
  {
    label,
    candidate: Number(candidateText),
    request: JSON.parse(requestText),
  },
  async () => process.exit(0),
);
