import { FileEntry, FileType } from '../core/fs';
import { isUnsafeRemoteSegment } from '../utils';

// A GNU `find -printf` format that emits one tab-separated record per entry, records NUL-terminated:
//   type(%y)  mode-octal(%m)  size(%s)  owner-name(%u)  group-name(%g)  uid(%U)  gid(%G)  mtime-epoch(%.10T@)  name(%f) \0
// Far easier and safer to parse than `ls -l` (no locale-dependent columns, no ambiguous spaces). NUL as
// the record separator (a filename can contain \t or \n but never \0) means a newline in a name can't
// split one entry into two. Used to list a directory the login user can't read, via `su` as owner/root.
// The NUMERIC uid/gid (%U/%G) matter: the tree's read/write access hints (canUserRead/canUserWrite) work
// off numeric ids, so without them an elevated listing can't compute 🔒/RO and, worse, a re-merge would
// wipe the real uid/gid it already had.
export const FIND_PRINTF = '%y\\t%m\\t%s\\t%u\\t%g\\t%U\\t%G\\t%.10T@\\t%f\\0';

function mapType(y: string): FileType {
  switch (y) {
    case 'd':
      return FileType.Directory;
    case 'f':
      return FileType.File;
    case 'l':
      return FileType.SymbolicLink;
    default:
      return FileType.Unknown; // block/char/socket/fifo — shown but not descended
  }
}

// Parse the output of `find <dir> -mindepth 1 -maxdepth 1 -printf FIND_PRINTF` into FileEntry records.
// `join` builds each child's absolute remote path from the directory and the entry name (pass upath.join).
// Malformed lines are skipped rather than throwing, so one odd entry can't blank the whole listing.
export function parseFindListing(
  output: string,
  dir: string,
  join: (dir: string, name: string) => string
): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const record of output.split('\0')) {
    if (!record) {
      continue;
    }
    const parts = record.split('\t');
    if (parts.length < 9) {
      continue; // trailing marker / malformed record
    }
    // A name could contain a tab; everything from field 9 on is the name.
    const name = parts.slice(8).join('\t');
    // Reject crafted names exactly as the SFTP listing does. A segment with a path separator, '..' or a
    // control char would let `upath.join` escape the directory (e.g. '..\\..\\etc\\shadow' -> /etc/shadow),
    // turning "View as root" into an arbitrary read — or a wrong-target delete — as root.
    if (isUnsafeRemoteSegment(name)) {
      continue;
    }
    const mode = /^[0-7]{1,4}$/.test(parts[1]) ? parseInt(parts[1], 8) : 0;
    const size = Number(parts[2]);
    // Numeric uid/gid drive the read/write access hints; keep them undefined on a non-numeric field
    // rather than 0 (which would falsely read as root-owned).
    const uid = /^\d+$/.test(parts[5]) ? Number(parts[5]) : undefined;
    const gid = /^\d+$/.test(parts[6]) ? Number(parts[6]) : undefined;
    const mtime = (Number(parts[7]) || 0) * 1000;
    entries.push({
      fspath: join(dir, name),
      name,
      type: mapType(parts[0]),
      mode,
      size: Number.isFinite(size) ? size : 0,
      mtime,
      atime: mtime,
      owner: parts[3] || undefined,
      group: parts[4] || undefined,
      uid,
      gid,
    });
  }
  return entries;
}
