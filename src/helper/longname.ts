// Pull the owner/group NAMES out of an OpenSSH SFTP readdir `longname` — the classic `ls -l` line:
//   "-rw-r--r--   1 root     www-data     1234 Jan  1 12:00 file"
// Fields: perms, nlink, owner, group, size, … . We only trust the line when the first field looks
// like a permissions string (type char + rwx block), so a server that stuffs something else into
// longname doesn't yield garbage names. Returns undefined names on any doubt — callers fall back to
// the numeric uid/gid.
export function parseLongnameOwner(longname: unknown): { owner?: string; group?: string } {
  if (typeof longname !== 'string') {
    return {};
  }
  const fields = longname.trim().split(/\s+/);
  // perms(0) nlink(1) owner(2) group(3) size(4) — need at least these to be present.
  if (fields.length < 5 || !/^[-dlbcps][-rwxsStT]{9}/.test(fields[0])) {
    return {};
  }
  return { owner: fields[2], group: fields[3] };
}
