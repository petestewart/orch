/**
 * Mock utilities for filesystem operations
 *
 * Provides MockFilesystem class for testing components that interact
 * with the filesystem without touching real files.
 *
 * @example
 * ```typescript
 * import { MockFilesystem } from './test-utils';
 *
 * const fs = new MockFilesystem();
 * fs.writeFile('/test/file.txt', 'content');
 * const content = fs.readFile('/test/file.txt');
 * ```
 */

import { mkdtemp, rm, writeFile, readFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * File entry in the mock filesystem
 */
export interface MockFileEntry {
  content: string;
  createdAt: Date;
  modifiedAt: Date;
  isDirectory: boolean;
}

/**
 * Mock filesystem for testing
 */
export class MockFilesystem {
  private files: Map<string, MockFileEntry> = new Map();
  private writeError: Error | null = null;
  private readError: Error | null = null;

  /**
   * Write a file to the mock filesystem
   */
  writeFile(path: string, content: string): void {
    if (this.writeError) {
      throw this.writeError;
    }

    const existing = this.files.get(path);
    const now = new Date();

    this.files.set(path, {
      content,
      createdAt: existing?.createdAt ?? now,
      modifiedAt: now,
      isDirectory: false,
    });

    // Auto-create parent directories
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join('/');
      if (dirPath && !this.files.has(dirPath)) {
        this.files.set(dirPath, {
          content: '',
          createdAt: now,
          modifiedAt: now,
          isDirectory: true,
        });
      }
    }
  }

  /**
   * Read a file from the mock filesystem
   */
  readFile(path: string): string {
    if (this.readError) {
      throw this.readError;
    }

    const entry = this.files.get(path);
    if (!entry) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    if (entry.isDirectory) {
      throw new Error(`EISDIR: illegal operation on a directory, read '${path}'`);
    }
    return entry.content;
  }

  /**
   * Check if a file exists
   */
  exists(path: string): boolean {
    return this.files.has(path);
  }

  /**
   * Check if a path is a directory
   */
  isDirectory(path: string): boolean {
    const entry = this.files.get(path);
    return entry?.isDirectory ?? false;
  }

  /**
   * Create a directory
   */
  mkdir(path: string): void {
    const now = new Date();
    this.files.set(path, {
      content: '',
      createdAt: now,
      modifiedAt: now,
      isDirectory: true,
    });
  }

  /**
   * Remove a file or directory
   */
  rm(path: string, options?: { recursive?: boolean }): void {
    if (options?.recursive) {
      // Remove all files/dirs under this path
      const prefix = path.endsWith('/') ? path : `${path}/`;
      for (const key of this.files.keys()) {
        if (key === path || key.startsWith(prefix)) {
          this.files.delete(key);
        }
      }
    } else {
      this.files.delete(path);
    }
  }

  /**
   * List files in a directory
   */
  readdir(path: string): string[] {
    const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;
    const result: string[] = [];

    for (const key of this.files.keys()) {
      if (key.startsWith(`${normalizedPath}/`)) {
        const relativePath = key.slice(normalizedPath.length + 1);
        const firstPart = relativePath.split('/')[0];
        if (!result.includes(firstPart)) {
          result.push(firstPart);
        }
      }
    }

    return result;
  }

  /**
   * Get file stats
   */
  stat(path: string): MockFileEntry | null {
    return this.files.get(path) ?? null;
  }

  /**
   * Set an error to throw on write operations
   */
  setWriteError(error: Error | null): void {
    this.writeError = error;
  }

  /**
   * Set an error to throw on read operations
   */
  setReadError(error: Error | null): void {
    this.readError = error;
  }

  /**
   * Reset the mock filesystem to empty state
   */
  reset(): void {
    this.files.clear();
    this.writeError = null;
    this.readError = null;
  }

  /**
   * Get all files in the mock filesystem
   */
  getAllFiles(): Map<string, MockFileEntry> {
    return new Map(this.files);
  }
}

/**
 * Create a real temporary directory for integration testing
 *
 * @param prefix - Prefix for the temp directory name
 * @returns Object with path and cleanup function
 *
 * @example
 * ```typescript
 * const { path, cleanup } = await createTempDir('test-');
 * try {
 *   // Use path for testing
 * } finally {
 *   await cleanup();
 * }
 * ```
 */
export async function createTempDir(
  prefix: string = 'orch-test-'
): Promise<{
  path: string;
  cleanup: () => Promise<void>;
}> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  return {
    path,
    cleanup: async () => {
      await rm(path, { recursive: true, force: true });
    },
  };
}

/**
 * Helper to create a test PLAN.md file
 *
 * @param dir - Directory to create the file in
 * @param content - Content for the PLAN.md file
 * @returns Path to the created file
 */
export async function createTestPlan(dir: string, content: string): Promise<string> {
  const planPath = join(dir, 'PLAN.md');
  await writeFile(planPath, content);
  return planPath;
}

/**
 * Sample PLAN.md content for testing
 */
export const samplePlanContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 First Task
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** First task description
- **Acceptance Criteria:**
  - Criterion 1
  - Criterion 2
- **Validation Steps:**
  - \`echo "test passed"\`

### Ticket: T002 Second Task
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
- **Dependencies:** T001
- **Scope:** Second task depends on first
- **Acceptance Criteria:**
  - Must work
- **Validation Steps:**
  - \`bun test\`
`;

/**
 * Create a minimal test setup with temp directory and PLAN.md
 *
 * @returns Setup object with paths and cleanup function
 */
export async function createTestSetup(): Promise<{
  dir: string;
  planPath: string;
  cleanup: () => Promise<void>;
}> {
  const { path: dir, cleanup } = await createTempDir();
  const planPath = await createTestPlan(dir, samplePlanContent);
  return { dir, planPath, cleanup };
}

/**
 * File watcher mock for testing file change detection
 */
export class MockFileWatcher {
  private callbacks: Map<string, Array<(event: string) => void>> = new Map();
  private isWatching: boolean = false;

  watch(path: string, callback: (event: string) => void): void {
    const callbacks = this.callbacks.get(path) ?? [];
    callbacks.push(callback);
    this.callbacks.set(path, callbacks);
    this.isWatching = true;
  }

  unwatch(path: string): void {
    this.callbacks.delete(path);
    if (this.callbacks.size === 0) {
      this.isWatching = false;
    }
  }

  /**
   * Simulate a file change event
   */
  triggerChange(path: string, event: string = 'change'): void {
    const callbacks = this.callbacks.get(path);
    if (callbacks) {
      for (const callback of callbacks) {
        callback(event);
      }
    }
  }

  /**
   * Check if currently watching any files
   */
  isActive(): boolean {
    return this.isWatching;
  }

  /**
   * Get all watched paths
   */
  getWatchedPaths(): string[] {
    return Array.from(this.callbacks.keys());
  }

  /**
   * Reset the watcher
   */
  reset(): void {
    this.callbacks.clear();
    this.isWatching = false;
  }
}
