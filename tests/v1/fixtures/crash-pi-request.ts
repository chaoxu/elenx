import {
  createAssistantMessageEventStream,
  type Api,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";

import { createCampaign } from "../../../src";
import { runPi } from "../../../src/pi";

const path = process.argv[2];
if (path === undefined) throw new Error("missing database path");
const model: Model<Api> = {
  id: "crash-test",
  name: "Crash test",
  api: "openai-responses",
  provider: "fake",
  baseUrl: "https://invalid.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10_000,
  maxTokens: 1_000,
};
const models = {
  streamSimple(requestModel, _context, options) {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      await options?.onPayload?.({ input: "durable request" }, requestModel);
      process.exit(0);
    })();
    return stream;
  },
} satisfies Pick<Models, "streamSimple">;
const campaign = createCampaign(path, "crash-pi-request-fixture", null);
await runPi(campaign, {
  models,
  model,
  label: "crash/v1",
  prompt: "Crash after checkpoint",
});
