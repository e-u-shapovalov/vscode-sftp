const TransferSchedulerGroup = require('../../src/core/transferSchedulerGroup').default;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function cancelledError() {
  const e = new Error('Transfer cancelled');
  e.code = 'TRANSFER_CANCELLED';
  return e;
}

// A stand-in for TransferTask: `run()` resolves after `ms`, and honours cancellation the way the
// real task does — cancelled before it runs it throws at once (no work); cancelled mid-run it aborts
// and rejects immediately. `track` counts how many tasks are running at the same instant.
function makeTask(opts = {}) {
  const ms = opts.ms == null ? 10 : opts.ms;
  const track = opts.track;
  let timer = null;
  let rejectRun = null;
  const t = {
    cancelled: false,
    started: false,
    finished: false,
    run() {
      if (t.cancelled) {
        throw cancelledError();
      }
      t.started = true;
      if (track) track.inc();
      return new Promise((resolve, reject) => {
        rejectRun = reject;
        timer = setTimeout(() => {
          if (track) track.dec();
          t.finished = true;
          resolve();
        }, ms);
      });
    },
    cancel() {
      if (t.cancelled) {
        return;
      }
      t.cancelled = true;
      if (timer) {
        clearTimeout(timer);
        if (track) track.dec();
        timer = null;
      }
      if (rejectRun) {
        rejectRun(cancelledError());
      }
    },
  };
  return t;
}

function makeTracker() {
  let cur = 0;
  let max = 0;
  return {
    inc() {
      cur += 1;
      max = Math.max(max, cur);
    },
    dec() {
      cur -= 1;
    },
    get max() {
      return max;
    },
  };
}

const noop = () => {};

describe('TransferSchedulerGroup', () => {
  test('shares one concurrency budget across concurrent batches', async () => {
    const track = makeTracker();
    const group = new TransferSchedulerGroup(noop, noop);
    const a = group.createBatch(2);
    const b = group.createBatch(2);

    for (let i = 0; i < 4; i++) a.add(makeTask({ track, ms: 15 }));
    for (let i = 0; i < 4; i++) b.add(makeTask({ track, ms: 15 }));

    await Promise.all([a.run(), b.run()]);

    // A per-operation Scheduler (the old design) would allow 2 + 2 = 4 transfers at once. One shared
    // gate keeps it to the single configured budget.
    expect(track.max).toBeLessThanOrEqual(2);
  });

  test("run() resolves on its own tasks while another batch still has queued work", async () => {
    const group = new TransferSchedulerGroup(noop, noop);
    const a = group.createBatch(2);
    const b = group.createBatch(2);

    const aTasks = [makeTask({ ms: 5 }), makeTask({ ms: 5 })];
    const bTasks = [makeTask({ ms: 200 }), makeTask({ ms: 200 })];
    aTasks.forEach(t => a.add(t));
    bTasks.forEach(t => b.add(t));

    await a.run();

    expect(aTasks.every(t => t.finished)).toBe(true);
    expect(bTasks.every(t => t.finished)).toBe(false);

    await b.run(); // let b drain so no timers outlive the test
  });

  test('stop() cancels only its batch; the other batch completes', async () => {
    const group = new TransferSchedulerGroup(noop, noop);
    const a = group.createBatch(2);
    const b = group.createBatch(2);

    const aTasks = [makeTask({ ms: 100 }), makeTask({ ms: 100 }), makeTask({ ms: 100 })];
    const bTasks = [makeTask({ ms: 5 }), makeTask({ ms: 5 })];
    aTasks.forEach(t => a.add(t));
    bTasks.forEach(t => b.add(t));

    const aRun = a.run();
    const bRun = b.run();
    a.stop();

    await Promise.all([aRun, bRun]);

    expect(bTasks.every(t => t.finished)).toBe(true); // b untouched
    expect(aTasks.every(t => !t.finished)).toBe(true); // a's work was cancelled
  });

  test('cancelAll settles every batch and drains cancelled tasks', async () => {
    const group = new TransferSchedulerGroup(noop, noop);
    const a = group.createBatch(2);
    const b = group.createBatch(2);

    const aTasks = [makeTask({ ms: 100 }), makeTask({ ms: 100 })];
    const bTasks = [makeTask({ ms: 100 }), makeTask({ ms: 100 })];
    aTasks.forEach(t => a.add(t));
    bTasks.forEach(t => b.add(t));

    const runs = Promise.all([a.run(), b.run()]);
    expect(group.isBusy).toBe(true);

    group.cancelAll();

    await runs; // must resolve, not hang
    expect(group.isBusy).toBe(false);
    expect([...aTasks, ...bTasks].every(t => !t.finished)).toBe(true);
  });

  test('an empty batch resolves immediately and clears busy', async () => {
    const group = new TransferSchedulerGroup(noop, noop);
    const a = group.createBatch(4);
    expect(group.isBusy).toBe(true);

    await a.run();

    expect(group.isBusy).toBe(false);
  });

  test('invokes onStart and onDone once per task (err null on success)', async () => {
    const starts = [];
    const dones = [];
    const group = new TransferSchedulerGroup(
      t => starts.push(t),
      (err, t) => dones.push([err, t])
    );
    const a = group.createBatch(2);
    const t1 = makeTask({ ms: 5 });
    const t2 = makeTask({ ms: 5 });
    a.add(t1);
    a.add(t2);

    await a.run();

    expect(starts.length).toBe(2);
    expect(starts).toEqual(expect.arrayContaining([t1, t2]));
    expect(dones.length).toBe(2);
    expect(dones.every(([err]) => err === null)).toBe(true);
  });

  test('onDone reports the error for a failed task without hanging the batch', async () => {
    const dones = [];
    const group = new TransferSchedulerGroup(noop, (err, t) => dones.push([err, t]));
    const a = group.createBatch(1);
    const bad = { run: () => Promise.reject(new Error('boom')), cancel: noop };
    a.add(bad);

    await a.run();

    expect(dones.length).toBe(1);
    expect(dones[0][0]).toBeInstanceOf(Error);
    expect(dones[0][0].message).toBe('boom');
  });

  test('a task that finishes before run() is sealed completes only once run() is called', async () => {
    const group = new TransferSchedulerGroup(noop, noop);
    const batch = group.createBatch(4);
    const fast = makeTask({ ms: 1 });
    batch.add(fast);

    // Let the task settle BEFORE run() seals the batch: _added === _done transiently, but the batch
    // must NOT be treated as complete yet (that early-resolve was the invariant reviewers flagged).
    await delay(20);
    expect(fast.finished).toBe(true);
    expect(group.isBusy).toBe(true);

    // Sealing now must resolve immediately (added === done) rather than hang.
    await batch.run();
    expect(group.isBusy).toBe(false);
  });

  test('reconciles concurrency to the latest batch — one shared cap, not the sum', async () => {
    const track = makeTracker();
    const group = new TransferSchedulerGroup(noop, noop);
    const a = group.createBatch(1); // gate starts at 1
    const b = group.createBatch(3); // last-wins → gate reconciles to 3

    for (let i = 0; i < 4; i++) a.add(makeTask({ track, ms: 15 }));
    for (let i = 0; i < 4; i++) b.add(makeTask({ track, ms: 15 }));

    await Promise.all([a.run(), b.run()]);

    // Exactly the reconciled cap: not stuck at a's 1, and not a's 1 + b's 3 = 4.
    expect(track.max).toBe(3);
  });
});
