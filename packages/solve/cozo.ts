import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// cozo-node is CommonJS with a native addon; keep its untyped API here.
export const { CozoDb } = require("cozo-node") as {
  CozoDb: new (
    engine: string,
    path: string,
  ) => {
    run(
      script: string,
      params?: Record<string, unknown>,
    ): Promise<{ headers: string[]; rows: unknown[][] }>;
    close(): void;
  };
};
