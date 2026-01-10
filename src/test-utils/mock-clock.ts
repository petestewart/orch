/**
 * Mock utilities for clock/timer testing
 *
 * Provides MockClock class for testing components that use
 * setTimeout, setInterval, and Date.now() without real time delays.
 *
 * Note: Bun's runtime may not allow replacing global timer functions.
 * This mock provides explicit timer methods (setTimeout, setInterval)
 * that can be used directly or injected into code under test.
 *
 * @example
 * ```typescript
 * import { MockClock } from './test-utils';
 *
 * const clock = new MockClock();
 *
 * let called = false;
 * clock.setTimeout(() => { called = true; }, 1000);
 *
 * clock.tick(500);  // Not called yet
 * clock.tick(500);  // Now called
 * ```
 */

/**
 * Pending timer entry
 */
interface TimerEntry {
  id: number;
  callback: () => void;
  scheduledTime: number;
  interval?: number;
  type: 'timeout' | 'interval';
}

/**
 * Mock clock for testing time-dependent code
 *
 * Provides mock timer functions that can be controlled precisely.
 * Use clock.setTimeout/setInterval instead of global functions,
 * then use clock.tick() to advance time.
 */
export class MockClock {
  private currentTime: number = 0;
  private timers: Map<number, TimerEntry> = new Map();
  private nextTimerId: number = 1;
  private installed: boolean = false;

  // Save original functions
  private originalDateNow: typeof Date.now | null = null;

  /**
   * Create a mock clock starting at specified time
   *
   * @param startTime - Starting timestamp in ms (default: 0)
   */
  constructor(startTime: number = 0) {
    this.currentTime = startTime;
  }

  /**
   * Install the mock clock (currently only mocks Date.now)
   *
   * Note: Global setTimeout/setInterval replacement may not work in all runtimes.
   * Use clock.setTimeout and clock.setInterval instead for reliable testing.
   */
  install(): void {
    if (this.installed) return;

    this.originalDateNow = Date.now;
    Date.now = (): number => this.currentTime;
    this.installed = true;
  }

  /**
   * Uninstall the mock clock, restoring original functions
   */
  uninstall(): void {
    if (!this.installed) return;

    if (this.originalDateNow) {
      Date.now = this.originalDateNow;
    }

    this.installed = false;
    this.timers.clear();
  }

  /**
   * Mock setTimeout - schedule a callback to run after ms milliseconds
   *
   * @param callback - Function to call when timer fires
   * @param ms - Delay in milliseconds
   * @returns Timer ID that can be passed to clearTimeout
   */
  setTimeout(callback: () => void, ms: number = 0): number {
    const id = this.nextTimerId++;
    this.timers.set(id, {
      id,
      callback,
      scheduledTime: this.currentTime + ms,
      type: 'timeout',
    });
    return id;
  }

  /**
   * Mock clearTimeout - cancel a pending timeout
   *
   * @param id - Timer ID returned from setTimeout
   */
  clearTimeout(id: number): void {
    this.timers.delete(id);
  }

  /**
   * Mock setInterval - schedule a callback to run repeatedly
   *
   * @param callback - Function to call on each interval
   * @param ms - Interval in milliseconds
   * @returns Timer ID that can be passed to clearInterval
   */
  setInterval(callback: () => void, ms: number): number {
    const id = this.nextTimerId++;
    this.timers.set(id, {
      id,
      callback,
      scheduledTime: this.currentTime + ms,
      interval: ms,
      type: 'interval',
    });
    return id;
  }

  /**
   * Mock clearInterval - cancel a repeating interval
   *
   * @param id - Timer ID returned from setInterval
   */
  clearInterval(id: number): void {
    this.timers.delete(id);
  }

  /**
   * Advance time by specified milliseconds and run due timers
   *
   * @param ms - Milliseconds to advance
   */
  tick(ms: number): void {
    const targetTime = this.currentTime + ms;

    // Process all timers that should fire up to (and including) targetTime
    while (true) {
      // Find the earliest timer that should fire
      let nextTimer: TimerEntry | null = null;

      for (const timer of this.timers.values()) {
        if (timer.scheduledTime <= targetTime) {
          if (!nextTimer || timer.scheduledTime < nextTimer.scheduledTime) {
            nextTimer = timer;
          }
        }
      }

      if (nextTimer) {
        // Advance time to this timer
        this.currentTime = nextTimer.scheduledTime;

        // Execute the callback
        nextTimer.callback();

        // Handle interval reschedule or timeout removal
        if (nextTimer.type === 'interval' && nextTimer.interval) {
          nextTimer.scheduledTime = this.currentTime + nextTimer.interval;
        } else {
          this.timers.delete(nextTimer.id);
        }
      } else {
        // No more timers to fire, jump to target time
        this.currentTime = targetTime;
        break;
      }
    }
  }

  /**
   * Run all pending timers immediately
   */
  runAll(): void {
    const maxIterations = 10000; // Safety limit
    let iterations = 0;

    while (this.timers.size > 0 && iterations < maxIterations) {
      iterations++;

      // Find earliest timer
      let earliest: TimerEntry | null = null;
      for (const timer of this.timers.values()) {
        if (!earliest || timer.scheduledTime < earliest.scheduledTime) {
          earliest = timer;
        }
      }

      if (earliest) {
        this.currentTime = earliest.scheduledTime;
        earliest.callback();

        if (earliest.type === 'interval' && earliest.interval) {
          earliest.scheduledTime = this.currentTime + earliest.interval;
        } else {
          this.timers.delete(earliest.id);
        }
      }
    }

    if (iterations >= maxIterations) {
      throw new Error('MockClock.runAll() exceeded maximum iterations');
    }
  }

  /**
   * Run only pending timeout timers (not intervals)
   */
  runTimeouts(): void {
    const timeouts = Array.from(this.timers.values()).filter(
      (t) => t.type === 'timeout'
    );

    for (const timer of timeouts.sort(
      (a, b) => a.scheduledTime - b.scheduledTime
    )) {
      this.currentTime = timer.scheduledTime;
      timer.callback();
      this.timers.delete(timer.id);
    }
  }

  /**
   * Get the current mock time
   */
  now(): number {
    return this.currentTime;
  }

  /**
   * Set the current time without running timers
   */
  setTime(time: number): void {
    this.currentTime = time;
  }

  /**
   * Get count of pending timers
   */
  pendingTimers(): number {
    return this.timers.size;
  }

  /**
   * Get pending timer details (for debugging)
   */
  getPendingTimers(): Array<{
    id: number;
    type: 'timeout' | 'interval';
    scheduledTime: number;
  }> {
    return Array.from(this.timers.values()).map((t) => ({
      id: t.id,
      type: t.type,
      scheduledTime: t.scheduledTime,
    }));
  }

  /**
   * Clear all pending timers without running them
   */
  clearAll(): void {
    this.timers.clear();
  }

  /**
   * Reset the clock to initial state
   */
  reset(): void {
    this.currentTime = 0;
    this.timers.clear();
    this.nextTimerId = 1;
  }
}

/**
 * Create and install a mock clock for a test
 *
 * @returns Object with clock and cleanup function
 *
 * @example
 * ```typescript
 * const { clock, cleanup } = useMockClock();
 * try {
 *   clock.setTimeout(() => {}, 1000);
 *   clock.tick(1000);
 * } finally {
 *   cleanup();
 * }
 * ```
 */
export function useMockClock(startTime: number = 0): {
  clock: MockClock;
  cleanup: () => void;
} {
  const clock = new MockClock(startTime);
  clock.install();
  return {
    clock,
    cleanup: () => clock.uninstall(),
  };
}

/**
 * Helper to run async code with mock clock
 *
 * @example
 * ```typescript
 * await withMockClock(async (clock) => {
 *   clock.setTimeout(() => { value = 42; }, 1000);
 *   clock.tick(1000);
 * });
 * ```
 */
export async function withMockClock<T>(
  fn: (clock: MockClock) => T | Promise<T>,
  startTime: number = 0
): Promise<T> {
  const { clock, cleanup } = useMockClock(startTime);
  try {
    return await fn(clock);
  } finally {
    cleanup();
  }
}

/**
 * Create a promise that resolves after mock time advances
 *
 * @example
 * ```typescript
 * const clock = new MockClock();
 *
 * const done = mockDelay(clock, 1000);
 * clock.tick(1000);
 * await done;
 * ```
 */
export function mockDelay(clock: MockClock, ms: number): Promise<void> {
  return new Promise((resolve) => {
    clock.setTimeout(resolve, ms);
  });
}
