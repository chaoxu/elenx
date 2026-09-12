import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { modelRuntimeOptions } from "../solve";
import { createModelRuntime } from "../runtime";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function runtimeOptions() {
  const directory = await mkdtemp(join(tmpdir(), "elenx-model-runtime-"));
  directories.push(directory);
  return {
    modelsPath: join(directory, "models.json"),
    authPath: join(directory, "auth.json"),
    refreshOnCreate: false,
  };
}

test("custom model configuration is disabled unless explicitly selected", () => {
  expect(modelRuntimeOptions({})).toEqual({ modelsPath: null });
});

test("custom model configuration requires an absolute path", () => {
  expect(
    modelRuntimeOptions({ ELENX_MODELS_PATH: "/run/elenx/models.json" }),
  ).toEqual({
    modelsPath: "/run/elenx/models.json",
  });
  expect(() =>
    modelRuntimeOptions({ ELENX_MODELS_PATH: "models.json" }),
  ).toThrow("ELENX_MODELS_PATH must be absolute");
});

test("a missing explicit registry fails instead of selecting public models", async () => {
  const options = await runtimeOptions();
  await expect(createModelRuntime(options)).rejects.toThrow("ENOENT");
});

test.each([
  ["{ invalid json }", "Failed to parse models.json"],
  ['{"providers":{"openai":{"baseUrl":42}}}', "Invalid models.json schema"],
])("an invalid explicit registry fails: %s", async (content, message) => {
  const options = await runtimeOptions();
  await Bun.write(options.modelsPath, content);
  await expect(createModelRuntime(options)).rejects.toThrow(message);
});

test("a valid explicit registry preserves Pi provider overrides", async () => {
  const options = await runtimeOptions();
  await Bun.write(
    options.modelsPath,
    JSON.stringify({
      providers: {
        openai: {
          baseUrl: "https://provider.invalid/v1",
          apiKey: "test-key",
        },
      },
    }),
  );
  const runtime = await createModelRuntime(options);
  expect(runtime.getModel("openai", "gpt-5.6-luna")?.baseUrl).toBe(
    "https://provider.invalid/v1",
  );
});
