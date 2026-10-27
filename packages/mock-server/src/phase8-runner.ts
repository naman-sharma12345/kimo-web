/** Synthetic bounded producer only. Does not imply engine cancellation support. */
export type HeldStep = { start(): void; finish(): void; stop(): void };
export function createHeldRunner(holdMs: number, gapMs: number) {
  let queue: HeldStep[] = [];
  let active: HeldStep | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let paused = false;
  let epoch = 0;
  let boundary: (() => void) | undefined;
  function cancelTimer() {
    epoch++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  function schedule(ms: number, fn: () => void) {
    const generation = epoch;
    timer = setTimeout(() => {
      timer = undefined;
      if (!paused && generation === epoch) fn();
    }, ms);
  }
  function pump() {
    if (paused || active || timer !== undefined) return;
    if (boundary) {
      const callback = boundary;
      boundary = undefined;
      callback();
      return;
    }
    active = queue.shift();
    const step = active;
    if (!step) return;
    step.start();
    schedule(holdMs, () => {
      active = undefined;
      step.finish();
      if (boundary) pump();
      else schedule(gapMs, pump);
    });
  }
  return {
    enqueue(steps: HeldStep[]) {
      queue.push(...steps);
      pump();
    },
    afterCurrent(callback: () => void) {
      queue = [];
      boundary = callback;
      if (!active) {
        cancelTimer();
        pump();
      }
    },
    pause() {
      if (paused) return;
      paused = true;
      cancelTimer();
      const step = active;
      active = undefined;
      step?.stop();
    },
    resume() {
      if (!paused) return;
      paused = false;
      pump();
    },
    dispose() {
      paused = true;
      cancelTimer();
      queue = [];
      boundary = undefined;
      active = undefined;
    },
  };
}

/** Freezes outstanding non-action work, with no polling timer while paused. */
export function createPausableTimers() {
  type Task = {
    fn: () => void;
    remaining: number;
    due: number;
    timer?: ReturnType<typeof setTimeout>;
    generation: number;
  };
  const tasks = new Set<Task>();
  let paused = false;
  let disposed = false;
  function arm(task: Task) {
    task.due = Date.now() + task.remaining;
    const generation = ++task.generation;
    task.timer = setTimeout(() => {
      if (disposed || paused || task.generation !== generation) return;
      tasks.delete(task);
      task.fn();
    }, task.remaining);
  }
  return {
    schedule(ms: number, fn: () => void) {
      if (disposed) return;
      const task: Task = { fn, remaining: ms, due: 0, generation: 0 };
      tasks.add(task);
      if (!paused) arm(task);
    },
    pause() {
      if (paused) return;
      paused = true;
      for (const task of tasks) {
        task.remaining = Math.max(0, task.due - Date.now());
        task.generation++;
        if (task.timer !== undefined) clearTimeout(task.timer);
      }
    },
    resume() {
      if (!paused || disposed) return;
      paused = false;
      for (const task of tasks) arm(task);
    },
    dispose() {
      disposed = true;
      for (const task of tasks)
        if (task.timer !== undefined) clearTimeout(task.timer);
      tasks.clear();
    },
  };
}
