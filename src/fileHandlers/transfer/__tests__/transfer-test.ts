jest.mock('fs');

import { vol } from 'memfs';
import * as fs from 'fs';
import * as path from 'path';
import { sync, TransferDirection } from '../transfer';
import localFs from '../../../core/localFs';
import TransferTask from '../../../core/transferTask';
import RemoteFs from '../../../../test/helper/localRemoteFs';

declare global {
  interface Array<T> {
    formatSep(): Array<T>;
  }
}

Array.prototype.formatSep = function() {
  return this.map(str => str.replace(/\//g, path.sep))
}

function createRemoteFs({ remoteTimeOffsetInHours = 0 } = {}) {
  return new RemoteFs(path, {
    clientOption: {} as any,
    remoteTimeOffsetInHours,
  });
}

async function runTasks(tasks: TransferTask[]) {
  return Promise.all(
    tasks.map(async task => {
      try {
        await task.run();
      } catch (error) {
        console.log('run task fail', error);
      }
    })
  );
}

const file = (c, time = 0) => ({
  $$type: 'file',
  content: c,
  mtime: new Date(new Date().getTime() + time * 1000),
});

const fillFs = obj => {
  const files: { [x: string]: string } = {};
  const dirs: string[] = [];
  const stats: {
    [x: string]: {
      mtime: Date;
    };
  } = {};
  const processDirTree = (obj1, filepath = '/') => {
    const keys = Object.keys(obj1);
    if (keys.length <= 0) {
      dirs.push(filepath);
      return;
    }

    keys.forEach(key => {
      const fullpath = path.join(filepath, key);
      if (obj1[key].$$type === 'file') {
        files[fullpath] = obj1[key].content;
        stats[fullpath] = obj1[key];
      } else {
        processDirTree(obj1[key], fullpath);
      }
    });
  };
  processDirTree(obj);
  vol.fromJSON(files, '/');
  dirs.forEach(dir => fs.mkdirSync(dir));
  Object.keys(stats).forEach(filepath => {
    fs.utimesSync(filepath, stats[filepath].mtime, stats[filepath].mtime);
  });
};
const mapList = (list: any[], key: string) => list.map(t => t[key]);

// Every collected task must be self-consistent: its direction has to agree with BOTH the
// filesystem pair it carries AND the namespace of its paths. A `bothDirections` regression that
// flipped only the direction label (without swapping the filesystems) passes a single shared-memfs
// check but fails this one, because the "download" tasks would still read from `localFs`.
function expectDirectionConsistent(
  tasks: TransferTask[],
  localFs: any,
  remoteFs: any
) {
  const localRoot = path.normalize('/local');
  const remoteRoot = path.normalize('/remote');
  tasks.forEach(task => {
    const toRemote = task.transferType === TransferDirection.LOCAL_TO_REMOTE;
    expect(task.srcFs).toBe(toRemote ? localFs : remoteFs);
    expect(task.targetFs).toBe(toRemote ? remoteFs : localFs);
    expect(task.srcFsPath.startsWith(toRemote ? localRoot : remoteRoot)).toBe(true);
    expect(task.targetFsPath.startsWith(toRemote ? remoteRoot : localRoot)).toBe(true);
  });
}

describe('transfer algorithm', () => {
  describe('sync', () => {
    afterEach(() => {
      vol.reset();
    });

    test('sync', async () => {
      fillFs({
        local: {
          a: file('a', 1),
          b: file('b', 1),
          c: {
            'c-a': file('c-a', 1),
            'c-b': file('c-b', 1),
            d: {
              'd-a': file('d-a', 1),
              'd-b': file('d-b', 1),
            },
          },
        },
        remote: {
          a: file('$a'),
          $da: file('$da'),
          $db: {},
          c: {
            'c-a': file('$c-a'),
            $dc: file('$dc'),
            d: {
              'd-a': file('$d-a'),
            },
          },
        },
      });

      const task: TransferTask[] = [];
      const collect = (a: TransferTask) => task.push(a);
      const deleted = await sync(
        {
          srcFsPath: '/local',
          srcFs: localFs,
          targetFs: localFs,
          targetFsPath: '/remote',
          transferDirection: TransferDirection.LOCAL_TO_REMOTE,
          transferOption: {
            perserveTargetMode: false,
          },
        },
        collect
      );
      expect(task.length).toEqual(6);
      expect(deleted.length).toEqual(0);
      expect(mapList(task, 'targetFsPath').sort()).toEqual(
        [
          '/remote/a',
          '/remote/b',
          '/remote/c/c-a',
          '/remote/c/c-b',
          '/remote/c/d/d-a',
          '/remote/c/d/d-b',
        ].formatSep().sort()
      );
    });

    test('sync --delete', async () => {
      fillFs({
        local: {
          a: file('a', 1),
          b: file('b', 1),
          c: {
            'c-a': file('c-a', 1),
            'c-b': file('c-b', 1),
            d: {
              'd-a': file('d-a', 1),
              'd-b': file('d-b', 1),
            },
          },
        },
        remote: {
          a: file('$a'),
          $da: file('$da'),
          $db: {},
          c: {
            'c-a': file('$c-a'),
            $dc: file('$dc'),
            d: {
              'd-a': file('$d-a'),
            },
          },
        },
      });

      const task: TransferTask[] = [];
      const collect = (a: TransferTask) => task.push(a);
      const deleted = await sync(
        {
          srcFsPath: '/local',
          srcFs: localFs,
          targetFs: localFs,
          targetFsPath: '/remote',
          transferDirection: TransferDirection.LOCAL_TO_REMOTE,
          transferOption: {
            delete: true,
            perserveTargetMode: false,
          },
        },
        collect
      );
      expect(task.length).toEqual(6);
      expect(deleted.length).toEqual(3);
      expect(mapList(deleted, 'fspath').sort()).toEqual(
        ['/remote/$da', '/remote/$db', '/remote/c/$dc'].formatSep().sort()
      );
      expect(mapList(task, 'targetFsPath').sort()).toEqual(
        [
          '/remote/a',
          '/remote/b',
          '/remote/c/c-a',
          '/remote/c/c-b',
          '/remote/c/d/d-a',
          '/remote/c/d/d-b',
        ].formatSep().sort()
      );
    });

    test('sync --update', async () => {
      fillFs({
        local: {
          a: file('a', 1),
          b: file('b', 1),
          c: {
            'c-a': file('c-a', 1),
            'c-b': file('c-b', 1),
            d: {
              'd-a': file('d-a', 1),
              'd-b': file('d-b', 1),
            },
          },
        },
        remote: {
          a: file('$a'),
          $da: file('$da'),
          $db: {},
          c: {
            'c-a': file('$c-a'),
            $dc: file('$dc'),
            d: {
              'd-a': file('$d-a'),
            },
          },
        },
      });

      const task: TransferTask[] = [];
      const collect = (a: TransferTask) => task.push(a);
      const deleted = await sync(
        {
          srcFsPath: '/local',
          srcFs: localFs,
          targetFs: localFs,
          targetFsPath: '/remote',
          transferDirection: TransferDirection.LOCAL_TO_REMOTE,
          transferOption: {
            delete: true,
            perserveTargetMode: false,
          },
        },
        collect
      );
      expect(task.length).toEqual(6);
      expect(deleted.length).toEqual(3);
      expect(mapList(deleted, 'fspath').sort()).toEqual(
        ['/remote/$da', '/remote/$db', '/remote/c/$dc'].formatSep().sort()
      );
      expect(mapList(task, 'targetFsPath').sort()).toEqual(
        [
          '/remote/a',
          '/remote/b',
          '/remote/c/c-a',
          '/remote/c/c-b',
          '/remote/c/d/d-a',
          '/remote/c/d/d-b',
        ].formatSep().sort()
      );
    });

    // SKIPPED: `remoteTimeOffsetInHours` is currently disabled in the transfer pipeline (it is
    // commented out in transfer/index.ts), and the sync --update mtime comparison does not yet
    // account for the offset, so a re-sync re-uploads an already-synced file. Re-enable the option
    // and fix the offset-aware comparison together — see ROADMAP.
    test.skip('sync --update with time offset', async () => {
      const remoteFs = createRemoteFs({ remoteTimeOffsetInHours: 6 });
      fillFs({
        local: {
          a: file('a', 1),
        },
        remote: {
          a: file('$a'),
        },
      });
      const task: TransferTask[] = [];
      const collect = (a: TransferTask) => task.push(a);
      let deleted;
      const runSync = async () => {
        deleted = await sync(
          {
            srcFsPath: '/local',
            srcFs: localFs,
            targetFs: remoteFs,
            targetFsPath: '/remote',
            transferDirection: TransferDirection.LOCAL_TO_REMOTE,
            transferOption: {
              skipCreate: true,
              delete: false,
              perserveTargetMode: false,
            },
          },
          collect
        );
        await runTasks(task);
      };
      await runSync();
      expect(task.length).toEqual(1);
      expect(deleted.length).toEqual(0);
      expect(mapList(task, 'targetFsPath').sort()).toEqual(
        ['/remote/a'].formatSep().sort()
      );
      task.length = 0;
      deleted.length = 0;
      await runSync();
      expect(task.length).toEqual(0);
      expect(deleted.length).toEqual(0);
    });

    test('sync --skipDelete', async () => {
      fillFs({
        local: {
          a: file('a', 1),
          b: file('b', 1),
          c: {
            'c-a': file('c-a', 1),
            'c-b': file('c-b', 1),
            d: {
              'd-a': file('d-a', 1),
              'd-b': file('d-b', 1),
            },
          },
        },
        remote: {
          a: file('$a'),
          c: {
            'c-a': file('$c-a'),
            d: {
              'd-a': file('$d-a'),
            },
          },
        },
      });

      const task: TransferTask[] = [];
      const collect = (a: TransferTask) => task.push(a);
      const deleted = await sync(
        {
          srcFsPath: '/local',
          srcFs: localFs,
          targetFs: localFs,
          targetFsPath: '/remote',
          transferDirection: TransferDirection.LOCAL_TO_REMOTE,
          transferOption: {
            skipCreate: true,
            perserveTargetMode: false,
          },
        },
        collect
      );
      expect(task.length).toEqual(3);
      expect(deleted.length).toEqual(0);
      expect(mapList(task, 'targetFsPath').sort()).toEqual(
        ['/remote/a', '/remote/c/c-a', '/remote/c/d/d-a'].formatSep().sort()
      );
    });

    test('sync --update', async () => {
      fillFs({
        local: {
          a: file('a', 1),
          b: file('b', 1),
          c: {
            'c-a': file('c-a', 1),
            'c-b': file('c-b', 1),
            d: {
              'd-a': file('d-a', 1),
              'd-b': file('d-b', 1),
            },
          },
        },
        remote: {
          a: file('$a', 2),
          c: {
            'c-a': file('$c-a', 1),
            d: {
              'd-a': file('$d-a'),
            },
          },
        },
      });

      const task: TransferTask[] = [];
      const collect = (a: TransferTask) => task.push(a);
      const deleted = await sync(
        {
          srcFsPath: '/local',
          srcFs: localFs,
          targetFs: localFs,
          targetFsPath: '/remote',
          transferDirection: TransferDirection.LOCAL_TO_REMOTE,
          transferOption: {
            update: true,
            perserveTargetMode: false,
          },
        },
        collect
      );
      expect(task.length).toEqual(4);
      expect(deleted.length).toEqual(0);
      expect(mapList(task, 'targetFsPath').sort()).toEqual(
        [
          '/remote/b',
          '/remote/c/c-b',
          '/remote/c/d/d-a',
          '/remote/c/d/d-b',
        ].formatSep().sort()
      );
    });

    test('sync both direction"', async () => {
      fillFs({
        local: {
          a: file('a', 1),
          b: file('b', 1),
          c: {
            'c-a': file('c-a', 1),
            'c-b': file('c-b', 1),
            'c-c': file('c-c', 1),
            d: {
              'd-a': file('d-a', 1),
              'd-b': file('d-b', 1),
            },
          },
        },
        remote: {
          a: file('$a'),
          b: file('$b', 2),
          c: {
            'c-a': file('$c-a'),
            'c-b': file('$c-b', 2),
            d: {
              'd-a': file('$d-a'),
              'd-b': file('$d-b', 2),
              'd-c': file('$d-c'),
            },
          },
        },
      });

      // Use a DISTINCT filesystem object for the remote side. With a single shared memfs the
      // direction/filesystem swap can't be observed (both sides are the same object), which is
      // exactly what hid the "downloads never happen" bug.
      const remoteFs = createRemoteFs();
      const task: TransferTask[] = [];
      const collect = (a: TransferTask) => task.push(a);
      const deleted = await sync(
        {
          srcFsPath: '/local',
          srcFs: localFs,
          targetFs: remoteFs,
          targetFsPath: '/remote',
          transferDirection: TransferDirection.LOCAL_TO_REMOTE,
          transferOption: {
            bothDirections: true,
            perserveTargetMode: false,
          },
        },
        collect
      );
      expect(task.length).toEqual(8);
      expect(deleted.length).toEqual(0);
      expect(mapList(task, 'targetFsPath').sort()).toEqual(
        [
          '/remote/a',
          '/local/b',
          '/remote/c/c-a',
          '/local/c/c-b',
          '/remote/c/c-c',
          '/remote/c/d/d-a',
          '/local/c/d/d-b',
          '/local/c/d/d-c',
        ].formatSep().sort()
      );
      // Downloads (server → local) must read from remoteFs and write to localFs, and vice versa.
      expectDirectionConsistent(task, localFs, remoteFs);
    });

    test('sync both direction --skipCreate"', async () => {
      fillFs({
        local: {
          a: file('a', 1),
          b: file('b', 1),
          c: {
            'c-a': file('c-a', 1),
            'c-b': file('c-b', 1),
            'c-c': file('c-c', 1),
            d: {
              'd-a': file('d-a', 1),
              'd-b': file('d-b', 1),
            },
          },
        },
        remote: {
          a: file('$a'),
          b: file('$b', 2),
          c: {
            'c-a': file('$c-a'),
            'c-b': file('$c-b', 2),
            d: {
              'd-a': file('$d-a'),
              'd-b': file('$d-b', 2),
              'd-c': file('$d-c'),
            },
          },
        },
      });

      const task: TransferTask[] = [];
      const collect = (a: TransferTask) => task.push(a);
      const deleted = await sync(
        {
          srcFsPath: '/local',
          srcFs: localFs,
          targetFs: localFs,
          targetFsPath: '/remote',
          transferDirection: TransferDirection.LOCAL_TO_REMOTE,
          transferOption: {
            skipCreate: true,
            bothDirections: true,
            perserveTargetMode: false,
          },
        },
        collect
      );
      expect(task.length).toEqual(6);
      expect(deleted.length).toEqual(0);
      expect(mapList(task, 'targetFsPath').sort()).toEqual(
        [
          '/remote/a',
          '/local/b',
          '/remote/c/c-a',
          '/local/c/c-b',
          '/remote/c/d/d-a',
          '/local/c/d/d-b',
        ].formatSep().sort()
      );
    });

    test('sync both direction downloads remote-only files and folders', async () => {
      // `up` lives only on local (upload); `down` and the whole `sub/` tree live only on the
      // server (download). The remote-only DIRECTORY exercises the dir2trans reverse path, which
      // must swap filesystems too — otherwise transferFolder lists the remote path on localFs and
      // the folder is silently never downloaded.
      fillFs({
        local: {
          up: file('up', 1),
        },
        remote: {
          down: file('$down'),
          sub: {
            'sub-a': file('$sub-a'),
          },
        },
      });

      const remoteFs = createRemoteFs();
      const task: TransferTask[] = [];
      const collect = (a: TransferTask) => task.push(a);
      await sync(
        {
          srcFsPath: '/local',
          srcFs: localFs,
          targetFs: remoteFs,
          targetFsPath: '/remote',
          transferDirection: TransferDirection.LOCAL_TO_REMOTE,
          transferOption: {
            bothDirections: true,
            perserveTargetMode: false,
          },
        },
        collect
      );

      expect(mapList(task, 'targetFsPath').sort()).toEqual(
        ['/remote/up', '/local/down', '/local/sub/sub-a'].formatSep().sort()
      );
      expectDirectionConsistent(task, localFs, remoteFs);
    });
  });
});
