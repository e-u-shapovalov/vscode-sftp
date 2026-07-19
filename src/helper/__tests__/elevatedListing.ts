import { parseFindListing } from '../elevatedListing';
import { FileType } from '../../core/fs';

const join = (d: string, n: string) => `${d.replace(/\/$/, '')}/${n}`;
const rec = (fields: string[]) => fields.join('\t');
// find emits NUL-terminated records; the raw stream ends with a trailing NUL.
const out = (records: string[]) => records.join('\0') + '\0';

describe('parseFindListing', () => {
  it('parses NUL-separated, tab-field find output', () => {
    const output = out([
      rec(['d', '700', '4096', 'root', 'root', '1721400000', '.ssh']),
      rec(['f', '644', '1234', 'root', 'root', '1721400100', 'config.json']),
      rec(['l', '777', '10', 'root', 'root', '1721400200', 'link']),
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
      fspath: '/root/.ssh',
      mtime: 1721400000000,
    });
    expect(entries[1]).toMatchObject({ name: 'config.json', type: FileType.File, mode: 0o644, size: 1234 });
    expect(entries[2]).toMatchObject({ name: 'link', type: FileType.SymbolicLink });
  });

  it('keeps a tab inside a filename (name is the last field, joined back)', () => {
    const entries = parseFindListing(out([rec(['f', '644', '5', 'u', 'g', '100', 'tab\tname.txt'])]), '/x', join);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('tab\tname.txt');
  });

  it('a newline in a name does NOT split the record (NUL-separated) and is rejected as unsafe', () => {
    const entries = parseFindListing(out([rec(['f', '644', '5', 'u', 'g', '100', 'weird\nname.txt'])]), '/x', join);
    expect(entries).toHaveLength(0);
  });

  it('rejects path-traversal names (a segment with / \\ .. or a control char)', () => {
    const output = out([
      rec(['f', '644', '0', 'u', 'g', '0', '..\\..\\etc\\shadow']),
      rec(['f', '644', '0', 'u', 'g', '0', 'a/b']),
      rec(['d', '755', '0', 'u', 'g', '0', '..']),
      rec(['f', '600', '7', 'u', 'g', '9', 'safe.txt']),
    ]);
    const entries = parseFindListing(output, '/srv', join);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'safe.txt', mode: 0o600, fspath: '/srv/safe.txt' });
  });

  it('skips malformed/short records and a non-octal mode without throwing', () => {
    const entries = parseFindListing(out([rec(['garbage']), rec(['s', 'abc', '0', 'u', 'g', '0', 'sock'])]), '/x', join);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe(FileType.Unknown);
    expect(entries[0].mode).toBe(0); // 'abc' isn't octal → 0, not NaN
  });
});
