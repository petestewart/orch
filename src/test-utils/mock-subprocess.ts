/**
 * Mock utilities for subprocess (Bun.spawn) testing
 *
 * Provides MockSubprocess class for testing agent spawning without
 * running real Claude processes.
 *
 * @example
 * ```typescript
 * import { MockSubprocess, createMockSpawn } from './test-utils';
 *
 * // Create a mock that simulates successful completion
 * const mockSpawn = createMockSpawn({
 *   stdout: 'Working...\n=== TICKET T001 COMPLETE ===',
 *   exitCode: 0,
 * });
 *
 * // Use in tests
 * const proc = mockSpawn(['claude', '-p', 'test']);
 * ```
 */

/**
 * Configuration for mock subprocess behavior
 */
export interface MockSubprocessConfig {
  /** Data to emit on stdout */
  stdout?: string | string[];
  /** Data to emit on stderr */
  stderr?: string | string[];
  /** Exit code when process completes */
  exitCode?: number;
  /** Delay in ms before emitting stdout chunks */
  stdoutDelay?: number;
  /** Delay in ms before process exits */
  exitDelay?: number;
  /** Signal to use for exit (e.g., 'SIGTERM') */
  exitSignal?: string;
  /** If true, process throws on spawn */
  throwOnSpawn?: Error;
  /** If true, process hangs (never exits until killed) */
  hang?: boolean;
}

/**
 * Spawn options (simplified from Bun's SpawnOptions)
 */
export interface MockSpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: 'inherit' | 'pipe' | 'ignore' | null;
  stdout?: 'inherit' | 'pipe' | 'ignore' | null;
  stderr?: 'inherit' | 'pipe' | 'ignore' | null;
}

/**
 * Mock readable stream for stdout/stderr
 */
export class MockReadableStream {
  private data: string[];
  private delay: number;
  private index: number = 0;
  private closed: boolean = false;
  private reader: MockStreamReader | null = null;

  constructor(data: string | string[], delay: number = 0) {
    this.data = Array.isArray(data) ? data : [data];
    this.delay = delay;
  }

  getReader(): MockStreamReader {
    if (this.reader) {
      return this.reader;
    }
    this.reader = new MockStreamReader(this.data, this.delay);
    return this.reader;
  }

  cancel(): void {
    this.closed = true;
    if (this.reader) {
      this.reader.cancel();
    }
  }

  get locked(): boolean {
    return this.reader !== null;
  }
}

/**
 * Mock stream reader for reading chunks
 */
export class MockStreamReader {
  private data: string[];
  private delay: number;
  private index: number = 0;
  private cancelled: boolean = false;

  constructor(data: string[], delay: number) {
    this.data = data;
    this.delay = delay;
  }

  async read(): Promise<{ done: boolean; value?: Uint8Array }> {
    if (this.cancelled || this.index >= this.data.length) {
      return { done: true };
    }

    if (this.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    }

    const chunk = this.data[this.index++];
    const encoder = new TextEncoder();
    return { done: false, value: encoder.encode(chunk) };
  }

  cancel(): void {
    this.cancelled = true;
  }

  releaseLock(): void {
    // No-op for mock
  }
}

/**
 * Mock subprocess that simulates Bun.spawn behavior
 */
export class MockSubprocess {
  readonly pid: number;
  readonly stdin: null = null;
  readonly stdout: MockReadableStream | null;
  readonly stderr: MockReadableStream | null;

  private config: MockSubprocessConfig;
  private _exitCode: number | null = null;
  private _signalCode: string | null = null;
  private _exited: boolean = false;
  private exitPromise: Promise<void>;
  private exitResolve!: () => void;
  private killed: boolean = false;

  constructor(config: MockSubprocessConfig = {}) {
    this.config = config;
    this.pid = Math.floor(Math.random() * 100000) + 1000;

    // Set up stdout if provided
    if (config.stdout !== undefined) {
      this.stdout = new MockReadableStream(
        config.stdout,
        config.stdoutDelay ?? 0
      );
    } else {
      this.stdout = new MockReadableStream('');
    }

    // Set up stderr if provided
    if (config.stderr !== undefined) {
      this.stderr = new MockReadableStream(config.stderr, 0);
    } else {
      this.stderr = new MockReadableStream('');
    }

    // Set up exit promise
    this.exitPromise = new Promise((resolve) => {
      this.exitResolve = resolve;
    });

    // Schedule exit unless hanging
    if (!config.hang) {
      this.scheduleExit();
    }
  }

  private scheduleExit(): void {
    const delay = this.config.exitDelay ?? 0;
    setTimeout(() => {
      if (!this.killed) {
        this._exitCode = this.config.exitCode ?? 0;
        this._signalCode = this.config.exitSignal ?? null;
        this._exited = true;
        this.exitResolve();
      }
    }, delay);
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  get signalCode(): string | null {
    return this._signalCode;
  }

  get exited(): Promise<void> {
    return this.exitPromise;
  }

  kill(signal?: number | string): void {
    if (this._exited || this.killed) return;

    this.killed = true;
    this._exitCode = null;
    this._signalCode =
      typeof signal === 'string' ? signal : signal === 9 ? 'SIGKILL' : 'SIGTERM';
    this._exited = true;
    this.exitResolve();
  }

  /**
   * Simulate sending additional stdout data after spawn
   */
  pushStdout(_data: string): void {
    // For simplicity, this is a no-op
    // In a more advanced implementation, we'd push to existing stream
  }
}

/**
 * Factory function to create a mock spawn function
 *
 * @param config - Configuration for the mock subprocess behavior
 * @returns A function that mimics Bun.spawn
 *
 * @example
 * ```typescript
 * const mockSpawn = createMockSpawn({
 *   stdout: ['Reading files...\n', '=== TICKET T001 COMPLETE ===\n'],
 *   exitCode: 0,
 *   stdoutDelay: 100,
 * });
 * ```
 */
export function createMockSpawn(
  config: MockSubprocessConfig = {}
): (cmd: string[], options?: MockSpawnOptions) => MockSubprocess {
  return (cmd: string[], options?: MockSpawnOptions): MockSubprocess => {
    if (config.throwOnSpawn) {
      throw config.throwOnSpawn;
    }
    return new MockSubprocess(config);
  };
}

/**
 * Create a mock that simulates a successful agent completion
 */
export function createCompletionMock(
  ticketId: string,
  output: string[] = []
): MockSubprocess {
  const fullOutput = [
    ...output,
    `\n=== TICKET ${ticketId} COMPLETE ===\nTask completed successfully.\n`,
  ];
  return new MockSubprocess({
    stdout: fullOutput,
    exitCode: 0,
    stdoutDelay: 10,
    exitDelay: 50,
  });
}

/**
 * Create a mock that simulates an agent being blocked
 */
export function createBlockedMock(
  ticketId: string,
  reason: string
): MockSubprocess {
  return new MockSubprocess({
    stdout: `Working on ticket...\n=== TICKET ${ticketId} BLOCKED: ${reason} ===\n`,
    exitCode: 0,
    exitDelay: 50,
  });
}

/**
 * Create a mock that simulates an agent failure
 */
export function createFailureMock(errorMessage: string): MockSubprocess {
  return new MockSubprocess({
    stderr: `Error: ${errorMessage}\n`,
    exitCode: 1,
    exitDelay: 50,
  });
}

/**
 * Create a mock that hangs until killed
 */
export function createHangingMock(): MockSubprocess {
  return new MockSubprocess({
    stdout: 'Starting work...\n',
    hang: true,
  });
}

/**
 * SpawnTracker to record spawn calls for verification
 */
export class SpawnTracker {
  private calls: Array<{
    cmd: string[];
    options?: MockSpawnOptions;
    timestamp: Date;
  }> = [];

  private mockConfig: MockSubprocessConfig;

  constructor(config: MockSubprocessConfig = {}) {
    this.mockConfig = config;
  }

  /**
   * Get the spawn function that tracks calls
   */
  getSpawn(): (cmd: string[], options?: MockSpawnOptions) => MockSubprocess {
    return (cmd: string[], options?: MockSpawnOptions) => {
      this.calls.push({ cmd, options, timestamp: new Date() });
      if (this.mockConfig.throwOnSpawn) {
        throw this.mockConfig.throwOnSpawn;
      }
      return new MockSubprocess(this.mockConfig);
    };
  }

  /**
   * Get all recorded spawn calls
   */
  getCalls(): Array<{
    cmd: string[];
    options?: MockSpawnOptions;
    timestamp: Date;
  }> {
    return [...this.calls];
  }

  /**
   * Get the last spawn call
   */
  getLastCall():
    | { cmd: string[]; options?: MockSpawnOptions; timestamp: Date }
    | undefined {
    return this.calls[this.calls.length - 1];
  }

  /**
   * Check if spawn was called with specific command
   */
  wasCalledWith(cmd: string[]): boolean {
    return this.calls.some(
      (call) => JSON.stringify(call.cmd) === JSON.stringify(cmd)
    );
  }

  /**
   * Get call count
   */
  callCount(): number {
    return this.calls.length;
  }

  /**
   * Reset tracked calls
   */
  reset(): void {
    this.calls = [];
  }
}
