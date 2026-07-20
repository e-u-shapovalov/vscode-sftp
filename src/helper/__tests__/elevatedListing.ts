import { parseFindListing } from '../elevatedListing';
import { FileType } from '../../core/fs';

const join = (d: string, n: string) => `${d.replace(/\/$/, '')}/${n}`;
const rec = (fields: string[]) => fields.join('\t');
// find emits NUL-terminated records; the raw stream ends with a trailing NUL.
const out = (records: string[]) => records.join('\0') + '\0';

// Field order: type %y | mode %m | size %s | owner %u | group %g | uid %U | gid %G | mtime %.10T@ | name %f
describe('parseFindListing', () => {
  it('parses NUL-separated, tab-field find output with numeric uid/gid', () => {
    const output = out([
      rec(['d', '700', '4096', 'root', 'root', '0', '0', '1721400000', '.ssh']),
      rec(['f', '644', '1234', 'deploy', 'deploy', '1000', '1000', '1721400100', 'config.json']),
      rec(['l', '777', '10', 'root', 'root', '0', '0', '1721400200', 'link']),
    ]);
    const entries = parseFindListing(output, '/root', join);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      name: '.ssh',
      type: FileType.Directory,
      mode: 0o700,
      size: 4096,
      owner: 'root',
      group: 'root',
      uid: 0,
      gid: 0,
      fspath: '/root/.ssh',
      mtime: 1721400000000,
    });
    expect(entries[1]).toMatchObject({ name: 'config.json', mode: 0o644, uid: 1000, gid: 1000 });
    expect(entries[2]).toMatchObject({ name: 'link', type: FileType.SymbolicLink });
  });

  it('a non-numeric uid/gid field becomes undefined (NOT 0, which would falsely read as root-owned)', () => {
    const entries = parseFindListing(out([rec(['f', '644', '5', 'root', 'root', '-', '-', '100', 'x'])]), '/x', join);
    expect(entries).toHaveLength(1);
    expect(entries[0].uid).toBeUndefined();
    expect(entries[0].gid).toBeUndefined();
  });

  it('keeps a tab inside a filename (name is the last field, joined back)', () => {
    const entries = parseFindListing(
      out([rec(['f', '644', '5', 'u', 'g', '1', '1', '100', 'tab\tname.txt'])]),
      '/x',
      join
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('tab\tname.txt');
  });

  it('a newline in a name does NOT split the record (NUL-separated) and is rejected as unsafe', () => {
    const entries = parseFindListing(
      out([rec(['f', '644', '5', 'u', 'g', '1', '1', '100', 'weird\nname.txt'])]),
      '/x',
      join
    );
    expect(entries).toHaveLength(0);
  });

  it('rejects path-traversal names (a segment with / \\ .. or a control char)', () => {
    const output = out([
      rec(['f', '644', '0', 'u', 'g', '1', '1', '0', '..\\..\\etc\\shadow']),
      rec(['f', '644', '0', 'u', 'g', '1', '1', '0', 'a/b']),
      rec(['d', '755', '0', 'u', 'g', '1', '1', '0', '..']),
      rec(['f', '600', '7', 'root', 'root', '0', '0', '9', 'safe.txt']),
    ]);
    const entries = parseFindListing(output, '/srv', join);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'safe.txt', mode: 0o600, uid: 0, gid: 0, fspath: '/srv/safe.txt' });
  });

  it('skips malformed/short records and a non-octal mode without throwing', () => {
    const entries = parseFindListing(
      out([rec(['garbage']), rec(['s', 'abc', '0', 'u', 'g', '1', '1', '0', 'sock'])]),
      '/x',
      join
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe(FileType.Unknown);
    expect(entries[0].mode).toBe(0); // 'abc' isn't octal → 0, not NaN
  });
});
