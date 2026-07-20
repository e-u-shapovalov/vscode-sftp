import Scheduler, { Task } from './scheduler';

// A task the group can also cancel — TransferTask satisfies this (run + cancel).
export interface CancellableTask extends Task {
  cancel(): void;
}

// A per-operation handle over the shared gate. `add` enqueues work, `run` resolves once THIS
// operation's tasks have finished (not the whole gate), and `stop` cancels only THIS operation's
// tasks. Structurally what fileHandlers/transfer expects from createTransferScheduler.
export interface TransferBatch {
  readonly size: number;
  // First task error observed in this batch, or null. run() still resolves regardless (batch transfers
  // report per-file failures via the afterTransfer hook and must not abort on the first one); callers
  // that DO need to know whether every task succeeded — e.g. an explicit single-file download, or the
  // upload-as-root staging step that must not `cp` a partial tree — inspect this after run().
  readonly error: Error | null;
  add(task: CancellableTask): void;
  run(): Promise<void>;
  stop(): void;
}

// One bounded Scheduler ("gate") shared by every batch a FileService mints.
//
// Before this, createTransferScheduler built a fresh Scheduler per transfer, so `concurrency` was a
// per-operation budget: N operations at once (e.g. a watcher touching N files, or "Upload Changed
// Files" over N git changes) opened up to N × concurrency parallel transfers — enough to trip sshd
// MaxSessions/MaxStartups, exhaust file descriptors, or get the IP banned on shared hosting.
//
// Routing every batch through one gate makes `concurrency` a single global limit for the owning
// service, while each batch still observes only its own completion and cancels only its own tasks.
// The gate stays running for the service's lifetime; when it has no work it simply sits idle.
export default class TransferSchedulerGroup {
  private _gate: Scheduler | null = null;
  private _batchOfTask: Map<Task, TransferBatchImpl> = new Map();
  private _active: Set<TransferBatchImpl> = new Set();

  // onStart/onDone are wired once onto the shared gate — the owning FileService uses them to track
  // pending tasks and emit its BEFORE/AFTER_TRANSFER events, exactly as the per-call schedulers did.
  constructor(
    private _onStart: (task: Task) => void,
    private _onDone: (err: Error | null, task: Task) => void
  ) {}

  // True while any operation is still in flight (drives FileService.isTransferring()).
  get isBusy(): boolean {
    return this._active.size > 0;
  }

  createBatch(concurrency: number): TransferBatch {
    this._ensureGate(concurrency);
    const batch = new TransferBatchImpl(this);
    this._active.add(batch);
    return batch;
  }

  // Cancel every active operation. Cancelled tasks still drain through the gate (a cancelled transfer
  // throws early in run() before touching the target), so each fires onDone and no queued task is
  // silently dropped — which keeps every batch's completion accounting sound.
  cancelAll(): void {
    // Copy first: stop() removes the batch from _active while we iterate.
    Array.from(this._active).forEach(batch => batch.stop());
    this._active.clear();
  }

  private _ensureGate(concurrency: number): void {
    if (!this._gate) {
      const gate = new Scheduler({ autoStart: true, concurrency });
      gate.onTaskStart(task => this._onStart(task));
      gate.onTaskDone((err, task) => {
        this._onDone(err, task);
        const batch = this._batchOfTask.get(task);
        if (batch) {
          this._batchOfTask.delete(task);
          batch._settle(err, task);
        }
      });
      this._gate = gate;
    } else if (typeof concurrency === 'number' && concurrency >= 1) {
      // Keep one global budget: reconcile to the newest operation's configured concurrency. Within a
      // service this value is stable (FTP is forced to 1), so it normally just re-affirms the same
      // number; even if two profile operations disagreed it stays a single cap, never their sum.
      this._gate.setConcurrency(concurrency);
    }
  }

  // Called by a batch as it enqueues each task, so the gate's single onDone can route completion back
  // to the batch that owns the task.
  _enqueue(task: CancellableTask, batch: TransferBatchImpl): void {
    this._batchOfTask.set(task, batch);
    this._gate!.add(task);
  }

  _release(batch: TransferBatchImpl): void {
    this._active.delete(batch);
  }
}

class TransferBatchImpl implements TransferBatch {
  private _added = 0;
  private _done = 0;
  private _sealed = false;
  private _stopped = false;
  private _resolveRun: (() => void) | null = null;
  // First error any task in this batch reported (success/cancel leave it null). Exposed via `error`.
  private _firstError: Error | null = null;
  // This batch's tasks that haven't settled yet — so stop() can cancel exactly its own work.
  private _liveTasks: Set<CancellableTask> = new Set();

  constructor(private _group: TransferSchedulerGroup) {}

  get size(): number {
    return this._added - this._done;
  }

  get error(): Error | null {
    return this._firstError;
  }

  add(task: CancellableTask): void {
    if (this._stopped) {
      return;
    }
    this._added += 1;
    this._liveTasks.add(task);
    this._group._enqueue(task, this);
  }

  run(): Promise<void> {
    if (this._stopped) {
      return Promise.resolve();
    }
    // Seal: every task is now enqueued, so an added === done means the batch is truly finished
    // (during the collect walk the two can momentarily match before all tasks are added).
    this._sealed = true;
    if (this._added === this._done) {
      this._group._release(this);
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this._resolveRun = resolve;
    });
  }

  stop(): void {
    this._stopped = true;
    // Cancel only this batch's tasks; other batches sharing the gate are untouched. We don't resolve
    // run() here — the cancelled tasks drain (throwing fast in run()) and settle it the normal way.
    this._liveTasks.forEach(task => task.cancel());
    this._group._release(this);
  }

  // Invoked once per task when the gate reports it done (success, failure, or cancellation).
  _settle(err: Error | null, task: Task): void {
    if (err && !this._firstError) {
      // Ignore cancellation errors: stop() deliberately cancels this batch's own tasks, so a cancelled
      // task is not a transfer failure the caller should react to.
      if (!(task as any).isCancelled || !(task as any).isCancelled()) {
        this._firstError = err;
      }
    }
    this._liveTasks.delete(task as CancellableTask);
    this._done += 1;
    if (this._sealed && this._added === this._done && this._resolveRun) {
      const resolve = this._resolveRun;
      this._resolveRun = null;
      this._group._release(this);
      resolve();
    }
  }
}
