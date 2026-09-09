import { CozoDb } from "./cozo";
import type { Note } from "./roles";

/** Note ids in numeric order. */
export const byId = (left: string, right: string): number =>
  Number(left.slice(1)) - Number(right.slice(1));

/** The transitive support of `notes` outside them, once each in id order. */
export async function supportClosure(
  notes: readonly Pick<Note, "id" | "support">[],
  known: readonly Pick<Note, "id" | "support">[],
): Promise<string[]> {
  const own = new Set(notes.map(({ id }) => id));
  const byName = new Map(known.map((note) => [note.id, note]));
  if (byName.size !== known.length)
    throw new Error("duplicate note in support closure");
  const db = new CozoDb("mem", "");
  try {
    const result = await db.run(
      `edge[note, support] <- $edges
root[note] <- $roots
reachable[note] := root[note]
reachable[support] := reachable[note], edge[note, support]
?[note] := reachable[note]`,
      {
        roots: [...own].map((id) => [id]),
        edges: known.flatMap(({ id, support }) =>
          support.map((parent) => [id, parent]),
        ),
      },
    );
    const reachable = result.rows.map(([id]) => id as string);
    for (const id of reachable) {
      const note = byName.get(id);
      if (note === undefined) throw new Error(`missing support note ${id}`);
      for (const parent of note.support) {
        if (byId(parent, id) >= 0)
          throw new Error(`support ${parent} must precede ${id}`);
      }
    }
    return reachable.filter((id) => !own.has(id)).sort(byId);
  } finally {
    db.close();
  }
}
