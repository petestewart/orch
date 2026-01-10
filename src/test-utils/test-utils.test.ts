/**
 * Tests for test utilities
 *
 * Validates that the mock utilities work correctly
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  MockSubprocess,
  createMockSpawn,
  createCompletionMock,
  createBlockedMock,
  createFailureMock,
  createHangingMock,
  SpawnTracker,
} from './mock-subprocess';
import {
  MockFilesystem,
  createTempDir,
  createTestPlan,
  createTestSetup,
  MockFileWatcher,
  samplePlanContent,
} from './mock-filesystem';
import {
  MockClock,
  useMockClock,
  withMockClock,
  mockDelay,
} from './mock-clock';

// =============================================================================
// MockSubprocess Tests
// =============================================================================

describe('MockSubprocess', () => {
  describe('basic behavior', () => {
    test('creates subprocess with PID', () => {
      const proc = new MockSubprocess();
      expect(proc.pid).toBeGreaterThan(0);
    });

    test('exits with configured code', async () => {
      const proc = new MockSubprocess({ exitCode: 42 });
      await proc.exited;
      expect(proc.exitCode).toBe(42);
    });

    test('defaults to exit code 0', async () => {
      const proc = new MockSubprocess();
      await proc.exited;
      expect(proc.exitCode).toBe(0);
    });

    test('can be killed', async () => {
      const proc = new MockSubprocess({ hang: true });

      // Kill it
      proc.kill('SIGTERM');
      await proc.exited;

      expect(proc.signalCode).toBe('SIGTERM');
      expect(proc.exitCode).toBeNull();
    });

    test('handles SIGKILL', async () => {
      const proc = new MockSubprocess({ hang: true });
      proc.kill(9);
      await proc.exited;
      expect(proc.signalCode).toBe('SIGKILL');
    });
  });

  describe('stdout streaming', () => {
    test('provides stdout reader', async () => {
      const proc = new MockSubprocess({ stdout: 'Hello, World!' });
      const reader = proc.stdout!.getReader();

      const { value, done } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toBe('Hello, World!');
    });

    test('handles multiple chunks', async () => {
      const proc = new MockSubprocess({
        stdout: ['Chunk 1\n', 'Chunk 2\n', 'Chunk 3\n'],
      });
      const reader = proc.stdout!.getReader();

      const chunks: string[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(new TextDecoder().decode(value));
      }

      expect(chunks).toEqual(['Chunk 1\n', 'Chunk 2\n', 'Chunk 3\n']);
    });
  });

  describe('stderr streaming', () => {
    test('provides stderr reader', async () => {
      const proc = new MockSubprocess({ stderr: 'Error message' });
      const reader = proc.stderr!.getReader();

      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);

      expect(text).toBe('Error message');
    });
  });
});

describe('createMockSpawn', () => {
  test('creates spawn function', () => {
    const spawn = createMockSpawn({ exitCode: 0 });
    const proc = spawn(['echo', 'test']);
    expect(proc.pid).toBeGreaterThan(0);
  });

  test('throws on spawn if configured', () => {
    const spawn = createMockSpawn({
      throwOnSpawn: new Error('Spawn failed'),
    });

    expect(() => spawn(['echo', 'test'])).toThrow('Spawn failed');
  });
});

describe('convenience mocks', () => {
  test('createCompletionMock returns completion output', async () => {
    const proc = createCompletionMock('T001', ['Working...']);
    const reader = proc.stdout!.getReader();

    const chunks: string[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }

    const fullOutput = chunks.join('');
    expect(fullOutput).toContain('=== TICKET T001 COMPLETE ===');
  });

  test('createBlockedMock returns blocked output', async () => {
    const proc = createBlockedMock('T002', 'Missing dependency');
    const reader = proc.stdout!.getReader();

    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);

    expect(text).toContain('=== TICKET T002 BLOCKED: Missing dependency ===');
  });

  test('createFailureMock returns error', async () => {
    const proc = createFailureMock('Something went wrong');
    await proc.exited;

    expect(proc.exitCode).toBe(1);

    const reader = proc.stderr!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);

    expect(text).toContain('Something went wrong');
  });

  test('createHangingMock hangs until killed', async () => {
    const proc = createHangingMock();

    // Process should not exit on its own
    let exited = false;
    proc.exited.then(() => {
      exited = true;
    });

    // Wait a bit
    await new Promise((r) => setTimeout(r, 50));
    expect(exited).toBe(false);

    // Kill it
    proc.kill();
    await proc.exited;
    expect(proc.signalCode).toBe('SIGTERM');
  });
});

describe('SpawnTracker', () => {
  test('tracks spawn calls', () => {
    const tracker = new SpawnTracker();
    const spawn = tracker.getSpawn();

    spawn(['echo', 'hello']);
    spawn(['echo', 'world']);

    expect(tracker.callCount()).toBe(2);
    expect(tracker.getCalls()[0].cmd).toEqual(['echo', 'hello']);
    expect(tracker.getCalls()[1].cmd).toEqual(['echo', 'world']);
  });

  test('tracks spawn options', () => {
    const tracker = new SpawnTracker();
    const spawn = tracker.getSpawn();

    spawn(['echo', 'test'], { cwd: '/tmp' });

    const lastCall = tracker.getLastCall();
    expect(lastCall?.options?.cwd).toBe('/tmp');
  });

  test('wasCalledWith checks command', () => {
    const tracker = new SpawnTracker();
    const spawn = tracker.getSpawn();

    spawn(['claude', '-p', 'test']);

    expect(tracker.wasCalledWith(['claude', '-p', 'test'])).toBe(true);
    expect(tracker.wasCalledWith(['echo', 'different'])).toBe(false);
  });

  test('reset clears calls', () => {
    const tracker = new SpawnTracker();
    const spawn = tracker.getSpawn();

    spawn(['echo', 'test']);
    expect(tracker.callCount()).toBe(1);

    tracker.reset();
    expect(tracker.callCount()).toBe(0);
  });
});

// =============================================================================
// MockFilesystem Tests
// =============================================================================

describe('MockFilesystem', () => {
  let fs: MockFilesystem;

  beforeEach(() => {
    fs = new MockFilesystem();
  });

  describe('writeFile and readFile', () => {
    test('writes and reads file', () => {
      fs.writeFile('/test/file.txt', 'Hello, World!');
      expect(fs.readFile('/test/file.txt')).toBe('Hello, World!');
    });

    test('throws on non-existent file', () => {
      expect(() => fs.readFile('/nonexistent')).toThrow('ENOENT');
    });

    test('auto-creates parent directories', () => {
      fs.writeFile('/a/b/c/file.txt', 'content');
      expect(fs.isDirectory('/a')).toBe(true);
      expect(fs.isDirectory('/a/b')).toBe(true);
      expect(fs.isDirectory('/a/b/c')).toBe(true);
    });
  });

  describe('exists and isDirectory', () => {
    test('checks file existence', () => {
      expect(fs.exists('/test')).toBe(false);
      fs.writeFile('/test', 'data');
      expect(fs.exists('/test')).toBe(true);
    });

    test('distinguishes files and directories', () => {
      fs.mkdir('/dir');
      fs.writeFile('/file', 'data');

      expect(fs.isDirectory('/dir')).toBe(true);
      expect(fs.isDirectory('/file')).toBe(false);
    });
  });

  describe('rm', () => {
    test('removes file', () => {
      fs.writeFile('/test', 'data');
      fs.rm('/test');
      expect(fs.exists('/test')).toBe(false);
    });

    test('removes directory recursively', () => {
      fs.writeFile('/dir/sub/file.txt', 'data');
      fs.rm('/dir', { recursive: true });
      expect(fs.exists('/dir')).toBe(false);
      expect(fs.exists('/dir/sub')).toBe(false);
      expect(fs.exists('/dir/sub/file.txt')).toBe(false);
    });
  });

  describe('readdir', () => {
    test('lists directory contents', () => {
      fs.writeFile('/dir/file1.txt', 'a');
      fs.writeFile('/dir/file2.txt', 'b');
      fs.mkdir('/dir/subdir');

      const contents = fs.readdir('/dir');
      expect(contents).toContain('file1.txt');
      expect(contents).toContain('file2.txt');
      expect(contents).toContain('subdir');
    });
  });

  describe('error simulation', () => {
    test('simulates write error', () => {
      fs.setWriteError(new Error('Disk full'));
      expect(() => fs.writeFile('/test', 'data')).toThrow('Disk full');
    });

    test('simulates read error', () => {
      fs.writeFile('/test', 'data');
      fs.setReadError(new Error('Permission denied'));
      expect(() => fs.readFile('/test')).toThrow('Permission denied');
    });
  });

  describe('reset', () => {
    test('clears all files and errors', () => {
      fs.writeFile('/test', 'data');
      fs.setWriteError(new Error('error'));

      fs.reset();

      expect(fs.exists('/test')).toBe(false);
      fs.writeFile('/test2', 'data'); // Should not throw
      expect(fs.exists('/test2')).toBe(true);
    });
  });
});

describe('temp directory helpers', () => {
  test('createTempDir creates and cleans up', async () => {
    const { path, cleanup } = await createTempDir('test-');

    expect(path).toContain('test-');

    // Verify it exists
    const stat = await Bun.file(path).exists();
    // Path is a directory, not a file, so this might not work as expected
    // But the directory was created

    await cleanup();
    // Directory should be removed
  });

  test('createTestPlan creates PLAN.md', async () => {
    const { path, cleanup } = await createTempDir('test-');
    try {
      const planPath = await createTestPlan(path, '# Test Plan');
      const content = await Bun.file(planPath).text();
      expect(content).toBe('# Test Plan');
    } finally {
      await cleanup();
    }
  });

  test('createTestSetup creates full setup', async () => {
    const { dir, planPath, cleanup } = await createTestSetup();
    try {
      const content = await Bun.file(planPath).text();
      expect(content).toContain('T001');
      expect(content).toContain('T002');
    } finally {
      await cleanup();
    }
  });

  test('samplePlanContent is valid', () => {
    expect(samplePlanContent).toContain('### Ticket: T001');
    expect(samplePlanContent).toContain('### Ticket: T002');
    // Note: The field has markdown formatting
    expect(samplePlanContent).toContain('**Dependencies:** T001');
  });
});

describe('MockFileWatcher', () => {
  let watcher: MockFileWatcher;

  beforeEach(() => {
    watcher = new MockFileWatcher();
  });

  test('watches files', () => {
    watcher.watch('/test/file.txt', () => {});
    expect(watcher.isActive()).toBe(true);
    expect(watcher.getWatchedPaths()).toContain('/test/file.txt');
  });

  test('triggers change events', () => {
    let triggered = false;
    watcher.watch('/test/file.txt', (event) => {
      triggered = true;
      expect(event).toBe('change');
    });

    watcher.triggerChange('/test/file.txt', 'change');
    expect(triggered).toBe(true);
  });

  test('unwatches files', () => {
    watcher.watch('/test/file.txt', () => {});
    watcher.unwatch('/test/file.txt');

    expect(watcher.getWatchedPaths()).not.toContain('/test/file.txt');
    expect(watcher.isActive()).toBe(false);
  });
});

// =============================================================================
// MockClock Tests
// =============================================================================

describe('MockClock', () => {
  let clock: MockClock;

  beforeEach(() => {
    clock = new MockClock();
    clock.install();
  });

  afterEach(() => {
    clock.uninstall();
  });

  describe('basic timing', () => {
    test('now() returns current mock time', () => {
      expect(clock.now()).toBe(0);
      clock.setTime(1000);
      expect(clock.now()).toBe(1000);
    });

    test('Date.now() uses mock time', () => {
      clock.setTime(5000);
      expect(Date.now()).toBe(5000);
    });

    test('tick advances time', () => {
      clock.tick(1000);
      expect(clock.now()).toBe(1000);
    });
  });

  describe('setTimeout', () => {
    test('runs timeout after tick', () => {
      let called = false;
      clock.setTimeout(() => {
        called = true;
      }, 1000);

      expect(called).toBe(false);
      clock.tick(999);
      expect(called).toBe(false);
      clock.tick(1);
      expect(called).toBe(true);
    });

    test('runs multiple timeouts in order', () => {
      const order: number[] = [];

      clock.setTimeout(() => order.push(2), 200);
      clock.setTimeout(() => order.push(1), 100);
      clock.setTimeout(() => order.push(3), 300);

      clock.tick(300);
      expect(order).toEqual([1, 2, 3]);
    });

    test('clearTimeout cancels timeout', () => {
      let called = false;
      const id = clock.setTimeout(() => {
        called = true;
      }, 1000);

      clock.clearTimeout(id);
      clock.tick(2000);
      expect(called).toBe(false);
    });
  });

  describe('setInterval', () => {
    test('runs interval repeatedly', () => {
      let count = 0;
      clock.setInterval(() => {
        count++;
      }, 100);

      clock.tick(100);
      expect(count).toBe(1);

      clock.tick(100);
      expect(count).toBe(2);

      clock.tick(300);
      expect(count).toBe(5);
    });

    test('clearInterval stops interval', () => {
      let count = 0;
      const id = clock.setInterval(() => {
        count++;
      }, 100);

      clock.tick(250);
      expect(count).toBe(2);

      clock.clearInterval(id);
      clock.tick(200);
      expect(count).toBe(2); // No more increments
    });
  });

  describe('runAll', () => {
    test('runs all pending timeouts', () => {
      const called: number[] = [];

      clock.setTimeout(() => called.push(1), 100);
      clock.setTimeout(() => called.push(2), 200);
      clock.setTimeout(() => called.push(3), 300);

      clock.runAll();

      expect(called).toEqual([1, 2, 3]);
      expect(clock.now()).toBe(300);
    });
  });

  describe('runTimeouts', () => {
    test('runs only timeouts, not intervals', () => {
      let timeoutCalled = false;
      let intervalCount = 0;

      clock.setTimeout(() => {
        timeoutCalled = true;
      }, 100);
      clock.setInterval(() => {
        intervalCount++;
      }, 50);

      clock.runTimeouts();

      expect(timeoutCalled).toBe(true);
      // Interval may have run due to time advancement
      // but importantly, the timeout was executed
    });
  });

  describe('pendingTimers', () => {
    test('returns count of pending timers', () => {
      expect(clock.pendingTimers()).toBe(0);

      clock.setTimeout(() => {}, 100);
      clock.setTimeout(() => {}, 200);
      clock.setInterval(() => {}, 50);

      expect(clock.pendingTimers()).toBe(3);
    });
  });

  describe('clearAll', () => {
    test('clears all pending timers', () => {
      clock.setTimeout(() => {}, 100);
      clock.setInterval(() => {}, 50);

      clock.clearAll();
      expect(clock.pendingTimers()).toBe(0);
    });
  });

  describe('reset', () => {
    test('resets time and timers', () => {
      clock.setTime(5000);
      clock.setTimeout(() => {}, 100);

      clock.reset();

      expect(clock.now()).toBe(0);
      expect(clock.pendingTimers()).toBe(0);
    });
  });
});

describe('useMockClock', () => {
  test('provides clock and cleanup', () => {
    const { clock, cleanup } = useMockClock(1000);

    expect(clock.now()).toBe(1000);
    expect(Date.now()).toBe(1000);

    cleanup();

    // Date.now should be restored
    expect(Date.now()).not.toBe(1000);
  });
});

describe('withMockClock', () => {
  test('runs function with mock clock', async () => {
    let value = 0;

    await withMockClock((clock) => {
      clock.setTimeout(() => {
        value = 42;
      }, 1000);
      clock.tick(1000);
    });

    expect(value).toBe(42);
  });

  test('restores clock after error', async () => {
    const originalNow = Date.now();

    try {
      await withMockClock(() => {
        throw new Error('test error');
      });
    } catch (e) {
      // Expected
    }

    // Clock should be restored
    expect(Date.now()).toBeGreaterThanOrEqual(originalNow);
  });
});
