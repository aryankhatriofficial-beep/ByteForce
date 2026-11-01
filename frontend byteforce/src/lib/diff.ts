import type { InventoryEntry } from "@/lib/api/types";

export type DiffState = "added" | "removed" | "changed" | "unchanged";

export interface DiffRow {
  path: string;
  state: DiffState;
  before?: InventoryEntry;
  after?: InventoryEntry;
}

/** Strips the version-bearing *.dist-info directory so metadata files line up across versions. */
const canonical = (path: string) => path.replace(/^[^/]+\.dist-info\//, "<dist-info>/");

/**
 * Client-side diff of two archive inventories (derived from backend data).
 * A file is `changed` when its RECORD hash differs, or its size differs when no hash is known.
 */
export function diffInventories(before: InventoryEntry[], after: InventoryEntry[]): DiffRow[] {
  const a = new Map(before.map((e) => [canonical(e.path), e]));
  const b = new Map(after.map((e) => [canonical(e.path), e]));
  const keys = Array.from(new Set([...a.keys(), ...b.keys()])).sort();
  return keys.map((path) => {
    const x = a.get(path);
    const y = b.get(path);
    if (!x) return { path, state: "added", after: y };
    if (!y) return { path, state: "removed", before: x };
    const changed = x.sha256 && y.sha256 ? x.sha256 !== y.sha256 : x.sizeBytes !== y.sizeBytes;
    return { path, state: changed ? "changed" : "unchanged", before: x, after: y };
  });
}

export const diffCounts = (rows: DiffRow[]) =>
  rows.reduce((acc, r) => ({ ...acc, [r.state]: acc[r.state] + 1 }), { added: 0, removed: 0, changed: 0, unchanged: 0 } as Record<DiffState, number>);
