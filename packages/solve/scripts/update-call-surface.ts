import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { callSurface } from "../exploration-protocol";
import {
  callSurfaceGoldenText,
  callSurfaceGoldenUrl,
} from "../tests/call-surface-fixture";

if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(callSurface)) {
  throw new Error("callSurface is not a safe golden-file slug");
}

const path = fileURLToPath(callSurfaceGoldenUrl());
mkdirSync(dirname(path), { recursive: true });
try {
  writeFileSync(path, callSurfaceGoldenText(), {
    encoding: "utf8",
    flag: "wx",
  });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "EEXIST") {
    throw new Error(
      `call-surface golden already exists for ${callSurface}; bump callSurface first`,
      { cause: error },
    );
  }
  throw error;
}
console.log(path);
