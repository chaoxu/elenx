#!/usr/bin/env bun

import { constants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const usage =
  "bun run debug:trial -- TRIAL.json RUN_DIRECTORY SETTINGS.json USAGE_TAG";
const usageTagPattern = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/u;
const secretCli = "/usr/local/bin/fleet-secret";
type Child = ReturnType<typeof Bun.spawn>;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["-h", "--help"].includes(args[0]!)) {
    console.log(usage);
    return;
  }
  if (args.length !== 4) throw new Error(usage);

  const [trialArgument, runDirectoryArgument, settingsArgument, usageTag] =
    args as [string, string, string, string];
  if (!usageTagPattern.test(usageTag)) {
    throw new Error(
      "USAGE_TAG must start with an ASCII letter or digit, use only letters, digits, . _ : / @ + -, and contain at most 128 characters",
    );
  }

  const repository = resolve(import.meta.dir, "../../..");
  const solveDirectory = resolve(import.meta.dir, "..");
  const trialSource = resolve(trialArgument);
  const settingsSource = resolve(settingsArgument);
  const runDirectory = resolve(runDirectoryArgument);
  const modelsPath = join(repository, "runs/codex-lb-models.json");
  const caPath = join(repository, "runs/lab-ca-root.pem");
  await Promise.all([
    access(trialSource, constants.R_OK),
    access(settingsSource, constants.R_OK),
    access(modelsPath, constants.R_OK),
    access(caPath, constants.R_OK),
    access(secretCli, constants.X_OK),
  ]);

  await mkdir(runDirectory, { recursive: false });
  const trialPath = join(runDirectory, "trial.json");
  const settingsPath = join(runDirectory, "settings.json");
  const campaignPath = join(runDirectory, "campaign.db");
  await Promise.all([
    copyFile(trialSource, trialPath, constants.COPYFILE_EXCL),
    copyFile(settingsSource, settingsPath, constants.COPYFILE_EXCL),
  ]);

  const [revision, status] = await Promise.all([
    settle(
      Bun.spawn(["git", "rev-parse", "HEAD"], {
        cwd: repository,
        stdout: "pipe",
        stderr: "pipe",
      }),
    ),
    settle(
      Bun.spawn(["git", "status", "--porcelain"], {
        cwd: repository,
        stdout: "pipe",
        stderr: "pipe",
      }),
    ),
  ]);
  if (revision.exitCode !== 0 || status.exitCode !== 0) {
    throw new Error("git provenance check failed");
  }
  await Bun.write(
    join(runDirectory, "debug-run.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        kind: "elenx-debug-trial",
        startedAt: new Date().toISOString(),
        elenxRevision: revision.stdout.trim(),
        worktreeDirty: status.stdout.trim().length > 0,
        usageTag,
        trial: "trial.json",
        settings: "settings.json",
      },
      null,
      2,
    )}\n`,
  );

  const secret = await settle(
    Bun.spawn([secretCli, "get", "codex-lb/api-key", "--field=key"], {
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
  const apiKey = secret.stdout.trim();
  if (secret.exitCode !== 0 || apiKey.length === 0) {
    throw new Error(withStderr("codex-lb credential lookup failed", secret));
  }

  const run = await settle(
    Bun.spawn(
      [
        process.execPath,
        "solve.ts",
        "trial",
        trialPath,
        campaignPath,
        settingsPath,
      ],
      {
        cwd: solveDirectory,
        env: {
          ...process.env,
          CODEX_LB_API_KEY: apiKey,
          ELENX_MODELS_PATH: modelsPath,
          NODE_EXTRA_CA_CERTS: caPath,
          ELENX_LAB_CODEX_LB_USAGE_TAG: usageTag,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    ),
  );
  if (run.exitCode !== 0) {
    await Promise.all([
      Bun.write(join(runDirectory, "solver-stdout.log"), run.stdout),
      Bun.write(join(runDirectory, "solver-stderr.log"), run.stderr),
    ]);
    throw new Error(withStderr(`elenx-solve exited ${run.exitCode}`, run));
  }

  const result = JSON.parse(run.stdout) as {
    readonly outcome?: unknown;
    readonly turns?: unknown;
  };
  await Bun.write(
    join(runDirectory, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  const { inspectRoleCampaign } = await import("../role-cli");
  const inspection = inspectRoleCampaign(campaignPath) as {
    readonly spend?: unknown;
  };
  await Bun.write(
    join(runDirectory, "inspect.json"),
    `${JSON.stringify(inspection, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        outcome: result.outcome,
        turns: result.turns,
        usageTag,
        runDirectory,
        result: join(runDirectory, "result.json"),
        inspection: join(runDirectory, "inspect.json"),
        spend: inspection.spend,
      },
      null,
      2,
    ),
  );
}

async function settle(child: Child) {
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function withStderr(
  message: string,
  result: { readonly stderr: string },
): string {
  return result.stderr.trim() === ""
    ? message
    : `${message}: ${result.stderr.trim()}`;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
