import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { piProfileNames } from "../pi-roles";
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

test("the all-max example uses one profile per Pi call", () => {
  const value = settings.parse(
    JSON.parse(
      readFileSync(new URL("settings-sol-max.json", directory), "utf8"),
    ),
  );
  for (const name of piProfileNames) {
    expect(value[name].model).toBe("gpt-5.6-sol");
    expect(value[name].reasoning).toBe("max");
  }
  expect(value.source.provider).toBe("codex");
});
