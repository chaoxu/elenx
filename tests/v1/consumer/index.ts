import {
  createCampaign,
  defineTool,
  type CallReceipt,
  type Campaign,
} from "elenx";
import { builtinPi, runPi } from "elenx/pi";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
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

const configuredModels = builtinModels();
const configuredModel = configuredModels.getModel("provider", "model");
const configuredResult =
  configuredModel === undefined
    ? undefined
    : runPi(campaign, {
        models: configuredModels,
        model: configuredModel,
        label: "audit/v1",
        prompt: "audit",
      });

void createCampaign;
void (undefined as unknown as CallReceipt);
void result;
void configuredResult;
void credentialModels;
