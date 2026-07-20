const { partitionByWritable } = require('../src/modules/uploadModified/partition');

describe('partitionByWritable', () => {
  test('writable:false → needsRoot; true and undefined → normal (never pull unknown into root)', () => {
    const cands = [
      { id: 'a', writable: false },
      { id: 'b', writable: true },
      { id: 'c' }, // undefined — FTP / no identity / uid-0 skip
      { id: 'd', writable: false },
    ];
    const { normal, needsRoot } = partitionByWritable(cands);
    expect(needsRoot.map(c => c.id)).toEqual(['a', 'd']);
    expect(normal.map(c => c.id)).toEqual(['b', 'c']);
  });

  test('empty in → empty out', () => {
    const { normal, needsRoot } = partitionByWritable([]);
    expect(normal).toEqual([]);
    expect(needsRoot).toEqual([]);
  });

  test('all normal when nothing is read-only', () => {
    const { normal, needsRoot } = partitionByWritable([{ writable: true }, {}, { writable: undefined }]);
    expect(normal).toHaveLength(3);
    expect(needsRoot).toHaveLength(0);
  });

  test('all needs-root when every file is read-only', () => {
    const { normal, needsRoot } = partitionByWritable([{ writable: false }, { writable: false }]);
    expect(normal).toHaveLength(0);
    expect(needsRoot).toHaveLength(2);
  });
});
