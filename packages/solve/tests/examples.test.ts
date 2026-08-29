import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { settings } from "../exploration";

const examplesDir = new URL("../examples/", import.meta.url);
const files = readdirSync(examplesDir).filter((name) => name.endsWith(".json"));

describe("example settings", () => {
  test("every example parses with the settings schema", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const value = JSON.parse(
        readFileSync(new URL(name, examplesDir), "utf8"),
      );
      const parsed = settings.safeParse(value);
      expect(parsed.success, `${name}: ${parsed.error?.message}`).toBe(true);
    }
  });

  test("the sol-max example stays the all-max baseline", () => {
    const value = settings.parse(
      JSON.parse(
        readFileSync(new URL("exploration-sol-max.json", examplesDir), "utf8"),
      ),
    );
    for (const role of [
      "explorer",
      "curator",
      "premiseVerifier",
      "proofVerifier",
    ] as const) {
      expect(value[role].model).toBe("gpt-5.6-sol");
      expect(value[role].reasoning).toBe("max");
    }
    expect(value.sourceChecker).toEqual({
      model: "gpt-5.6-sol",
      reasoning: "max",
    });
  });

  test("the mixed example downgrades only the curator", () => {
    const value = settings.parse(
      JSON.parse(
        readFileSync(new URL("exploration-mixed.json", examplesDir), "utf8"),
      ),
    );
    expect(value.curator.model).toBe("gpt-5.6-luna");
    for (const role of [
      "explorer",
      "premiseVerifier",
      "proofVerifier",
    ] as const) {
      expect(value[role].model).toBe("gpt-5.6-sol");
      expect(value[role].reasoning).toBe("max");
    }
    expect(value.sourceChecker).toEqual({
      model: "gpt-5.6-sol",
      reasoning: "max",
    });
  });
});
