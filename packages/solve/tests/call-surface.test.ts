import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  callSurfaceGolden,
  callSurfaceGoldenUrl,
} from "./call-surface-fixture";

test("the structured call surface matches its immutable golden", () => {
  const expected = JSON.parse(
    readFileSync(callSurfaceGoldenUrl(), "utf8"),
  ) as ReturnType<typeof callSurfaceGolden>;
  expect(callSurfaceGolden()).toEqual(expected);
});
