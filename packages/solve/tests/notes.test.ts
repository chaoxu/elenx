import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  NoteStore,
  indexTokenEstimate,
  type NoteMint,
} from "../notes";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function mint(
  id: string,
  summary: string,
  dependsOn: string[] = [],
  at = 1,
): NoteMint {
  return { id, summary, text: `${summary} -- full text`, dependsOn, at };
}

test("mint, live index, and on-demand text", async () => {
  const store = await NoteStore.open("mem");
  await store.applyMint(mint("n1", "lemma L", [], 3));
  await store.applyMint(mint("n2", "bound X via L", ["n1"], 5));
  expect(await store.liveIndex()).toEqual([
    { id: "n1", summary: "lemma L" },
    { id: "n2", summary: "bound X via L" },
  ]);
  expect(await store.text("n2")).toBe("bound X via L -- full text");
  expect(await store.text("missing")).toBeNull();
  store.close();
});

test("re-minting an id is rejected; revising an unknown note is rejected", async () => {
  const store = await NoteStore.open("mem");
  await store.applyMint(mint("n1", "lemma L"));
  expect(store.applyMint(mint("n1", "again"))).rejects.toThrow(
    "already minted",
  );
  expect(
    store.applyRevision({ id: "nope", summary: "s", text: "t", at: 9 }),
  ).rejects.toThrow("unknown note");
  store.close();
});

test("revision appends a version and the current view serves the latest", async () => {
  const store = await NoteStore.open("mem");
  await store.applyMint(mint("n1", "lemma L", [], 2));
  await store.applyRevision({
    id: "n1",
    summary: "lemma L, the load-bearing parity bound",
    text: "sharpened text",
    at: 7,
  });
  expect(await store.liveIndex()).toEqual([
    { id: "n1", summary: "lemma L, the load-bearing parity bound" },
  ]);
  expect(await store.history("n1")).toEqual([
    { at: 2, summary: "lemma L", text: "lemma L -- full text" },
    {
      at: 7,
      summary: "lemma L, the load-bearing parity bound",
      text: "sharpened text",
    },
  ]);
  store.close();
});

test("invalidation hides a note and cascade finds transitive dependents", async () => {
  const store = await NoteStore.open("mem");
  await store.applyMint(mint("n1", "lemma L"));
  await store.applyMint(mint("n2", "bound X via L", ["n1"]));
  await store.applyMint(mint("n3", "reduction via X", ["n2"]));
  await store.applyMint(mint("n4", "independent gadget"));

  expect(await store.cascade("n1")).toEqual(["n2", "n3"]);

  for (const id of ["n1", ...(await store.cascade("n1"))]) {
    await store.applyInvalidation({ id, verdict: "proof audit: L false", at: 9 });
  }
  expect(await store.liveIndex()).toEqual([
    { id: "n4", summary: "independent gadget" },
  ]);
  expect(await store.invalidated()).toEqual([
    { id: "n1", verdict: "proof audit: L false" },
    { id: "n2", verdict: "proof audit: L false" },
    { id: "n3", verdict: "proof audit: L false" },
  ]);
  store.close();
});

test("invalidation is idempotent and keeps the first verdict", async () => {
  const store = await NoteStore.open("mem");
  await store.applyMint(mint("n1", "lemma L"));
  await store.applyInvalidation({ id: "n1", verdict: "first", at: 4 });
  await store.applyInvalidation({ id: "n1", verdict: "second", at: 8 });
  expect(await store.invalidated()).toEqual([{ id: "n1", verdict: "first" }]);
  store.close();
});

test("replaying the same events into a fresh store reproduces the projection", async () => {
  const events = [
    mint("n1", "lemma L", [], 1),
    mint("n2", "bound X", ["n1"], 2),
  ];
  const first = await NoteStore.open("mem");
  for (const event of events) await first.applyMint(event);
  await first.applyInvalidation({ id: "n2", verdict: "refuted", at: 3 });
  const a = {
    index: await first.liveIndex(),
    dead: await first.invalidated(),
  };
  first.close();

  const second = await NoteStore.open("mem");
  for (const event of events) await second.applyMint(event);
  await second.applyInvalidation({ id: "n2", verdict: "refuted", at: 3 });
  const b = {
    index: await second.liveIndex(),
    dead: await second.invalidated(),
  };
  second.close();
  expect(b).toEqual(a);
});

test("sqlite engine persists across reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "elenx-notes-"));
  directories.push(directory);
  const path = join(directory, "notes.cozo");

  const store = await NoteStore.open("sqlite", path);
  await store.applyMint(mint("n1", "durable lemma"));
  store.close();

  const reopened = await NoteStore.open("sqlite", path);
  expect(await reopened.liveIndex()).toEqual([
    { id: "n1", summary: "durable lemma" },
  ]);
  reopened.close();
});

test("index token estimate is proportional and non-zero", () => {
  expect(indexTokenEstimate([])).toBe(0);
  const small = indexTokenEstimate([{ id: "n1", summary: "short" }]);
  const large = indexTokenEstimate([
    { id: "n1", summary: "a much longer summary that says quite a bit more" },
  ]);
  expect(small).toBeGreaterThan(0);
  expect(large).toBeGreaterThan(small);
});
