import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function run(command: string[], cwd: string): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0) throw new Error(`${command[1]} failed`);
}

const solver = process.cwd();
const kernel = resolve(solver, "../..");
const temporary = await mkdtemp(join(tmpdir(), "elenx-solve-package-"));
const consumer = join(temporary, "consumer");
const kernelArchive = join(temporary, "elenx.tgz");
const solverArchive = join(temporary, "elenx-solve.tgz");
try {
  await run(
    [
      process.execPath,
      "pm",
      "pack",
      "--filename",
      kernelArchive,
      "--ignore-scripts",
      "--quiet",
    ],
    kernel,
  );
  await run(
    [
      process.execPath,
      "pm",
      "pack",
      "--filename",
      solverArchive,
      "--ignore-scripts",
      "--quiet",
    ],
    solver,
  );
  await mkdir(consumer);
  await Bun.write(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        elenx: `file:${kernelArchive}`,
        "elenx-solve": `file:${solverArchive}`,
      },
    }),
  );
  await run([process.execPath, "install"], consumer);
  await run(
    [process.execPath, "run", "node_modules/elenx-solve/solve.ts", "--help"],
    consumer,
  );
  await run(
    [process.execPath, "run", "node_modules/elenx-solve/solve.ts", "contract"],
    consumer,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
