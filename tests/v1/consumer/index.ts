import {
  createCampaign,
  defineTool,
  type CallReceipt,
  type Campaign,
} from "elenx";
import { builtinPi, InMemoryCredentialStore, runPi } from "elenx/pi";
import { z } from "zod";

declare const campaign: Campaign;
const models = builtinPi();
const credentialModels = builtinPi({
  credentials: new InMemoryCredentialStore(),
});
const model = models.getModel("provider", "model");

const tool = defineTool({
  name: "read",
  description: "Read one value",
  input: z.strictObject({ key: z.string() }),
  async run({ key }) {
    return { key };
  },
});

const result =
  model === undefined
    ? undefined
    : runPi(campaign, {
        models,
        model,
        label: "audit/v1",
        prompt: "audit",
        tools: [tool],
      });

void createCampaign;
void (undefined as unknown as CallReceipt);
void result;
void credentialModels;
