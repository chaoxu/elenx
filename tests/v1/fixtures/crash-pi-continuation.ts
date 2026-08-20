import {
  createAssistantMessageEventStream,
  type Api,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";

import { openCampaign } from "../../../src";
import { continuePi } from "../../../src/pi";

const path = process.argv[2];
const parent = Number(process.argv[3]);
if (path === undefined || !Number.isSafeInteger(parent) || parent < 1) {
  throw new Error("missing continuation fixture arguments");
}
const model: Model<Api> = {
  id: "test-v1",
  name: "Test",
  api: "openai-responses",
  provider: "fake",
  baseUrl: "https://invalid.test",
  reasoning: true,
  thinkingLevelMap: { max: "max" },
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10_000,
  maxTokens: 1_000,
};
const models = {
  streamSimple(requestModel, _context, options) {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      await options?.onPayload?.(
        { input: "durable continuation" },
        requestModel,
      );
      process.exit(0);
    })();
    return stream;
  },
} satisfies Pick<Models, "streamSimple">;

await continuePi(openCampaign(path), { parent, models, model });
