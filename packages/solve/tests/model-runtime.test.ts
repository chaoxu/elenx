import { expect, test } from "bun:test";

import { modelRuntimeOptions } from "../solve";

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
