import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0) throw new Error(`${command[1]} failed`);
}

async function reject(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: "ignore", stderr: "ignore" });
  if ((await child.exited) === 0) throw new Error(`${command[1]} succeeded`);
}

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "elenx-package-"));
const consumer = join(temporary, "consumer");
const archive = join(temporary, "elenx.tgz");
try {
  await run(
    [
      process.execPath,
      "pm",
      "pack",
      "--filename",
      archive,
      "--ignore-scripts",
      "--quiet",
    ],
    root,
  );
  await mkdir(consumer);
  await Bun.write(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: { elenx: `file:${archive}`, zod: "4.4.3" },
      devDependencies: { "@types/bun": "1.3.14", typescript: "5.9.2" },
    }),
  );
  await Bun.write(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        lib: ["ES2023"],
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        skipLibCheck: true,
        types: ["bun"],
      },
      include: ["index.ts"],
    }),
  );
  await Bun.write(
    join(consumer, "index.ts"),
    `import {
  createCampaign, defineTool, deriveCandidateStatus, entryIdSchema,
  openCampaign, openReader, returnedToolSubmission, verdictSchema,
  type CallReceipt, type Campaign, type Entry, type Json, type Verdict,
} from "elenx";
import {
  builtinPi, derivePiSpend, ELENX_PI_TELEMETRY_SCHEMA,
  InMemoryCredentialStore, piReasoning, piRequest,
  piRequestAttempts, piStoredResult, PI_TELEMETRY_SCHEMA_VERSIONS,
  piTelemetry, runPi, type PiResult, type PiSpend,
} from "elenx/pi";
import { z } from "zod";

const campaign = createCampaign("consumer.db", "packed-consumer", null);
try {
  const candidate = campaign.submitCandidate(new TextEncoder().encode("x"), ["v1"]);
  deriveCandidateStatus(campaign.records(), candidate);
  derivePiSpend(campaign.records());
  piRequest.parse({ protocol: "elenx/pi-run/v1", model: { provider: "p", id: "m", api: "a" }, prompt: "x" });
  piStoredResult.parse({ state: "succeeded", text: "x", transcript: [] });
  builtinPi({ credentials: new InMemoryCredentialStore() });
  defineTool({ name: "read", description: "Read", input: z.strictObject({}), replay: "safe", async run() { return null; } });
} finally { campaign.close(); }
void [entryIdSchema, verdictSchema, openCampaign, openReader,
  returnedToolSubmission, ELENX_PI_TELEMETRY_SCHEMA, PI_TELEMETRY_SCHEMA_VERSIONS,
  piReasoning, piRequestAttempts, piTelemetry, runPi];
void (undefined as unknown as CallReceipt | Campaign | Entry | Json | Verdict | PiResult | PiSpend);
`,
  );
  await run([process.execPath, "install", "--ignore-scripts"], consumer);
  await reject(
    [process.execPath, "-e", 'await import("elenx/src/campaign")'],
    consumer,
  );
  await run([process.execPath, "x", "tsc", "--noEmit"], consumer);
  await run([process.execPath, "run", "index.ts"], consumer);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
