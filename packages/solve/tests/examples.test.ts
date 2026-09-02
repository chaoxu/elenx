import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { settings } from "../runner";

const directory = new URL("../examples/", import.meta.url);

test("every example uses the shared role settings", () => {
  const files = readdirSync(directory).filter((name) => name.endsWith(".json"));
  expect(files.length).toBeGreaterThan(0);
  for (const name of files) {
    const parsed = settings.safeParse(
      JSON.parse(readFileSync(new URL(name, directory), "utf8")),
    );
    expect(parsed.success, `${name}: ${parsed.error?.message}`).toBe(true);
  }
});

test("the all-max example uses one profile per public role", () => {
  const value = settings.parse(
    JSON.parse(
      readFileSync(new URL("settings-sol-max.json", directory), "utf8"),
    ),
  );
  for (const role of ["explorer", "coordinator", "verifier"] as const) {
    expect(value[role].model).toBe("gpt-5.6-sol");
    expect(value[role].reasoning).toBe("max");
  }
});
