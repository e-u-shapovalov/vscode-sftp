// Partition modified-file candidates by write access. `writable === false` is the ONLY needs-root
// signal; `undefined` (FTP / no identity / uid-0 skip) is a normal upload — never pull "unknown" into the
// root path (that would mean false positives and needless password prompts). `true` is normal too.
export function partitionByWritable<T extends { writable?: boolean }>(
  cands: T[]
): { normal: T[]; needsRoot: T[] } {
  const normal: T[] = [];
  const needsRoot: T[] = [];
  for (const c of cands) {
    (c.writable === false ? needsRoot : normal).push(c);
  }
  return { normal, needsRoot };
}
