import { expect, test } from "bun:test";

import { NoteStore, type NoteMint } from "../notes";

function mint(
  id: string,
  summary: string,
  dependsOn: string[] = [],
  at = 1,
): NoteMint {
  return { id, summary, text: `${summary} -- full text`, dependsOn, at };
}

test("mint, standings default to conjecture, and on-demand text", async () => {
  const store = await NoteStore.open();
  await store.applyMint(mint("n1", "lemma L", [], 3));
  await store.applyMint(mint("n2", "bound X via L", ["n1"], 5));
  expect(await store.liveIndex()).toEqual([
    { id: "n1", summary: "lemma L", standing: "conjecture" },
    { id: "n2", summary: "bound X via L", standing: "conjecture" },
  ]);
  expect(await store.text("n2")).toBe("bound X via L -- full text");
  expect(await store.text("missing")).toBeNull();
  store.close();
});

test("re-minting is rejected; planning or judging unknown notes is rejected", async () => {
  const store = await NoteStore.open();
  await store.applyMint(mint("n1", "lemma L"));
  expect(store.applyMint(mint("n1", "again"))).rejects.toThrow(
    "already minted",
  );
  expect(
    store.applyPlan({ id: "nope", modes: ["proof-audit"], at: 4 }),
  ).rejects.toThrow("unknown note");
  expect(
    store.applyVerdict({
      id: "nope",
      mode: "proof-audit",
      verdict: "PASS",
      report: "r",
      at: 4,
    }),
  ).rejects.toThrow("unknown note");
  store.close();
});

test("a full plan of PASS verdicts verifies; a FAIL refutes and hides", async () => {
  const store = await NoteStore.open();
  await store.applyMint(mint("n1", "lemma L", [], 2));
  await store.applyMint(mint("n2", "bad claim", [], 2));
  await store.applyPlan({
    id: "n1",
    modes: ["proof-audit", "refutation"],
    at: 4,
  });
  await store.applyPlan({ id: "n2", modes: ["proof-audit"], at: 4 });
  await store.applyVerdict({
    id: "n1",
    mode: "proof-audit",
    verdict: "PASS",
    report: "derivation holds",
    at: 6,
  });
  // one PASS of two planned modes: still a conjecture
  expect((await store.standings())[0]).toEqual({
    id: "n1",
    summary: "lemma L",
    standing: "conjecture",
  });
  await store.applyVerdict({
    id: "n1",
    mode: "refutation",
    verdict: "PASS",
    report: "no counterexample found",
    at: 8,
  });
  await store.applyVerdict({
    id: "n2",
    mode: "proof-audit",
    verdict: "FAIL",
    report: "step 3 divides by zero",
    at: 8,
  });
  expect(await store.standings()).toEqual([
    { id: "n1", summary: "lemma L", standing: "verified" },
    { id: "n2", summary: "bad claim", standing: "refuted" },
  ]);
  expect(await store.liveIndex()).toEqual([
    { id: "n1", summary: "lemma L", standing: "verified" },
  ]);
  store.close();
});

test("an empty plan marks a process report; INCONCLUSIVE stays conjecture", async () => {
  const store = await NoteStore.open();
  await store.applyMint(mint("n1", "route A dead-ends at parity", [], 2));
  await store.applyMint(mint("n2", "conjecture C", [], 2));
  await store.applyPlan({ id: "n1", modes: [], at: 4 });
  await store.applyPlan({ id: "n2", modes: ["refutation"], at: 4 });
  await store.applyVerdict({
    id: "n2",
    mode: "refutation",
    verdict: "INCONCLUSIVE",
    report: "no counterexample, no proof",
    at: 6,
  });
  expect(await store.standings()).toEqual([
    { id: "n1", summary: "route A dead-ends at parity", standing: "report" },
    { id: "n2", summary: "conjecture C", standing: "conjecture" },
  ]);
  store.close();
});

test("a revision stales the plan and verdicts back to conjecture", async () => {
  const store = await NoteStore.open();
  await store.applyMint(mint("n1", "lemma L", [], 2));
  await store.applyPlan({ id: "n1", modes: ["proof-audit"], at: 4 });
  await store.applyVerdict({
    id: "n1",
    mode: "proof-audit",
    verdict: "PASS",
    report: "holds",
    at: 6,
  });
  expect((await store.standings())[0]?.standing).toBe("verified");
  await store.applyRevision({
    id: "n1",
    summary: "lemma L, sharpened",
    text: "new text",
    at: 9,
  });
  expect((await store.standings())[0]).toEqual({
    id: "n1",
    summary: "lemma L, sharpened",
    standing: "conjecture",
  });
  // re-triage and a fresh verdict restore verification of the new version
  await store.applyPlan({ id: "n1", modes: ["proof-audit"], at: 11 });
  await store.applyVerdict({
    id: "n1",
    mode: "proof-audit",
    verdict: "PASS",
    report: "new derivation holds",
    at: 13,
  });
  expect((await store.standings())[0]?.standing).toBe("verified");
  store.close();
});

test("ancestors and cycle detection over the dependency graph", async () => {
  const store = await NoteStore.open();
  await store.applyMint(mint("n1", "lemma L"));
  await store.applyMint(mint("n2", "bound X", ["n1"]));
  await store.applyMint(mint("n3", "goal via X", ["n2"]));
  await store.applyMint(mint("n4", "independent"));
  expect(await store.ancestors("n3")).toEqual(["n1", "n2"]);
  expect(await store.inCycle("n3")).toBe(false);
  store.close();
});

test("a dependency cycle is detected", async () => {
  const store = await NoteStore.open();
  await store.applyMint(mint("n1", "a", ["n2"]));
  await store.applyMint(mint("n2", "b", ["n1"]));
  expect(await store.inCycle("n1")).toBe(true);
  expect(await store.inCycle("n2")).toBe(true);
  store.close();
});
