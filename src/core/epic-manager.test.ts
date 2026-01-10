/**
 * Unit tests for EpicManager
 * Implements: T031, T032 validation
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  EpicManager,
  createWorktree,
  listWorktrees,
  removeWorktree,
  mergeBranch,
  getCurrentBranch,
  abortMerge,
  isMergeInProgress,
  completeMergeAfterConflictResolution,
} from './epic-manager';
import { resetEventBus, getEventBus } from './events';
import type { Ticket, Epic, OrchEvent } from './types';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

// Helper to create a test ticket
function createTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'T001',
    title: 'Test Ticket',
    priority: 'P0',
    status: 'Todo',
    dependencies: [],
    acceptanceCriteria: [],
    validationSteps: [],
    ...overrides,
  };
}

describe('EpicManager', () => {
  let tempDir: string;
  let manager: EpicManager;

  beforeEach(() => {
    // Create a temporary directory for testing
    tempDir = join(tmpdir(), `orch-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    manager = new EpicManager(tempDir);
    resetEventBus();
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('discoverEpics', () => {
    test('returns empty array for tickets without epics', () => {
      const tickets = [
        createTicket({ id: 'T001' }),
        createTicket({ id: 'T002' }),
      ];

      const epics = manager.discoverEpics(tickets);
      expect(epics).toEqual([]);
    });

    test('discovers unique epics from tickets', () => {
      const tickets = [
        createTicket({ id: 'T001', epic: 'core' }),
        createTicket({ id: 'T002', epic: 'ui' }),
        createTicket({ id: 'T003', epic: 'core' }), // duplicate
      ];

      const epics = manager.discoverEpics(tickets);
      expect(epics.length).toBe(2);

      const epicNames = epics.map(e => e.name).sort();
      expect(epicNames).toEqual(['core', 'ui']);
    });

    test('sets epic path to epic name by default', () => {
      const tickets = [createTicket({ id: 'T001', epic: 'src/core' })];

      const epics = manager.discoverEpics(tickets);
      expect(epics[0].path).toBe('src/core');
    });

    test('handles mixed tickets with and without epics', () => {
      const tickets = [
        createTicket({ id: 'T001', epic: 'core' }),
        createTicket({ id: 'T002' }), // no epic
        createTicket({ id: 'T003', epic: 'ui' }),
      ];

      const epics = manager.discoverEpics(tickets);
      expect(epics.length).toBe(2);
    });
  });

  describe('validateEpicDirectories', () => {
    test('returns valid when all directories exist', async () => {
      // Create test directories
      mkdirSync(join(tempDir, 'core'), { recursive: true });
      mkdirSync(join(tempDir, 'ui'), { recursive: true });

      const epics: Epic[] = [
        { name: 'core', path: 'core' },
        { name: 'ui', path: 'ui' },
      ];

      const result = await manager.validateEpicDirectories(epics);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test('returns errors for missing directories', async () => {
      const epics: Epic[] = [
        { name: 'core', path: 'core' },
        { name: 'missing', path: 'missing' },
      ];

      // Only create core
      mkdirSync(join(tempDir, 'core'), { recursive: true });

      const result = await manager.validateEpicDirectories(epics);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('missing');
    });

    test('handles nested paths', async () => {
      mkdirSync(join(tempDir, 'src', 'core'), { recursive: true });

      const epics: Epic[] = [{ name: 'core', path: 'src/core' }];

      const result = await manager.validateEpicDirectories(epics);
      expect(result.valid).toBe(true);
    });
  });

  describe('initialize', () => {
    test('stores epics and initializes agent counts', async () => {
      mkdirSync(join(tempDir, 'core'), { recursive: true });

      const epics: Epic[] = [{ name: 'core', path: 'core' }];

      await manager.initialize(epics);

      expect(manager.getEpic('core')).toEqual(epics[0]);
      expect(manager.getAllEpics()).toEqual(epics);
    });

    test('clears previous state on reinitialize', async () => {
      mkdirSync(join(tempDir, 'core'), { recursive: true });
      mkdirSync(join(tempDir, 'ui'), { recursive: true });

      await manager.initialize([{ name: 'core', path: 'core' }]);
      expect(manager.getAllEpics().length).toBe(1);

      await manager.initialize([{ name: 'ui', path: 'ui' }]);
      expect(manager.getAllEpics().length).toBe(1);
      expect(manager.getEpic('core')).toBeUndefined();
      expect(manager.getEpic('ui')).toBeDefined();
    });
  });

  describe('allocateWorktree', () => {
    test('returns project root for ticket without epic', async () => {
      const ticket = createTicket({ id: 'T001' }); // no epic

      const result = await manager.allocateWorktree(ticket, 'agent-1');

      expect(result.worktreePath).toBe(tempDir);
      expect(result.branch).toBe('main');
      expect(result.isNew).toBe(false);
    });

    test('throws for unknown epic', async () => {
      const ticket = createTicket({ id: 'T001', epic: 'unknown' });

      await expect(manager.allocateWorktree(ticket, 'agent-1'))
        .rejects.toThrow('Epic not found: unknown');
    });

    test('first agent uses main epic directory', async () => {
      mkdirSync(join(tempDir, 'core'), { recursive: true });

      await manager.initialize([{ name: 'core', path: 'core' }]);

      const ticket = createTicket({ id: 'T001', epic: 'core' });
      const result = await manager.allocateWorktree(ticket, 'agent-1');

      expect(result.worktreePath).toBe(resolve(tempDir, 'core'));
      expect(result.branch).toBe('ticket/T001');
      expect(result.isNew).toBe(false);
    });

    test('tracks worktree allocation', async () => {
      mkdirSync(join(tempDir, 'core'), { recursive: true });

      await manager.initialize([{ name: 'core', path: 'core' }]);

      const ticket = createTicket({ id: 'T001', epic: 'core' });
      await manager.allocateWorktree(ticket, 'agent-1');

      const worktree = manager.getWorktreeForAgent('agent-1');
      expect(worktree).toBeDefined();
      expect(worktree?.agentId).toBe('agent-1');
      expect(worktree?.ticketId).toBe('T001');
      expect(worktree?.epicName).toBe('core');
    });

    test('throws when auto-create disabled and epic has agent', async () => {
      mkdirSync(join(tempDir, 'core'), { recursive: true });

      const restrictedManager = new EpicManager(tempDir, {
        autoCreateWorktrees: false,
      });
      await restrictedManager.initialize([{ name: 'core', path: 'core' }]);

      // First agent succeeds
      const ticket1 = createTicket({ id: 'T001', epic: 'core' });
      await restrictedManager.allocateWorktree(ticket1, 'agent-1');

      // Second agent fails
      const ticket2 = createTicket({ id: 'T002', epic: 'core' });
      await expect(restrictedManager.allocateWorktree(ticket2, 'agent-2'))
        .rejects.toThrow('already has an active agent');
    });

    test('throws when max worktrees reached', async () => {
      mkdirSync(join(tempDir, 'core'), { recursive: true });

      // Initialize a git repo so worktree commands work
      const initProc = Bun.spawn(['git', 'init'], { cwd: tempDir });
      await initProc.exited;
      const configProc1 = Bun.spawn(['git', 'config', 'user.email', 'test@test.com'], { cwd: tempDir });
      await configProc1.exited;
      const configProc2 = Bun.spawn(['git', 'config', 'user.name', 'Test'], { cwd: tempDir });
      await configProc2.exited;
      // Create initial commit
      const touchProc = Bun.spawn(['touch', '.gitkeep'], { cwd: tempDir });
      await touchProc.exited;
      const addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
      await addProc.exited;
      const commitProc = Bun.spawn(['git', 'commit', '-m', 'initial'], { cwd: tempDir });
      await commitProc.exited;

      const limitedManager = new EpicManager(tempDir, { maxWorktreesPerEpic: 2 });
      await limitedManager.initialize([{ name: 'core', path: 'core' }]);

      // First agent uses main dir
      const ticket1 = createTicket({ id: 'T001', epic: 'core' });
      await limitedManager.allocateWorktree(ticket1, 'agent-1');

      // Second creates worktree
      const ticket2 = createTicket({ id: 'T002', epic: 'core' });
      await limitedManager.allocateWorktree(ticket2, 'agent-2');

      // Third exceeds limit
      const ticket3 = createTicket({ id: 'T003', epic: 'core' });
      await expect(limitedManager.allocateWorktree(ticket3, 'agent-3'))
        .rejects.toThrow('maximum worktrees');
    });

    test('emits epic:worktree-created event for new worktrees', async () => {
      mkdirSync(join(tempDir, 'core'), { recursive: true });

      // Initialize git repo
      const initProc = Bun.spawn(['git', 'init'], { cwd: tempDir });
      await initProc.exited;
      const configProc1 = Bun.spawn(['git', 'config', 'user.email', 'test@test.com'], { cwd: tempDir });
      await configProc1.exited;
      const configProc2 = Bun.spawn(['git', 'config', 'user.name', 'Test'], { cwd: tempDir });
      await configProc2.exited;
      const touchProc = Bun.spawn(['touch', '.gitkeep'], { cwd: tempDir });
      await touchProc.exited;
      const addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
      await addProc.exited;
      const commitProc = Bun.spawn(['git', 'commit', '-m', 'initial'], { cwd: tempDir });
      await commitProc.exited;

      await manager.initialize([{ name: 'core', path: 'core' }]);

      const events: OrchEvent[] = [];
      getEventBus().subscribe('epic:worktree-created', (event) => {
        events.push(event);
      });

      // First agent - no event (uses main dir)
      const ticket1 = createTicket({ id: 'T001', epic: 'core' });
      await manager.allocateWorktree(ticket1, 'agent-1');
      expect(events.length).toBe(0);

      // Second agent - emits event
      const ticket2 = createTicket({ id: 'T002', epic: 'core' });
      await manager.allocateWorktree(ticket2, 'agent-2');
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('epic:worktree-created');
    });
  });

  describe('releaseWorktree', () => {
    test('removes worktree tracking for agent', async () => {
      mkdirSync(join(tempDir, 'core'), { recursive: true });

      await manager.initialize([{ name: 'core', path: 'core' }]);

      const ticket = createTicket({ id: 'T001', epic: 'core' });
      await manager.allocateWorktree(ticket, 'agent-1');

      expect(manager.getWorktreeForAgent('agent-1')).toBeDefined();

      await manager.releaseWorktree('agent-1');

      expect(manager.getWorktreeForAgent('agent-1')).toBeUndefined();
    });

    test('decrements epic agent count', async () => {
      mkdirSync(join(tempDir, 'core'), { recursive: true });

      await manager.initialize([{ name: 'core', path: 'core' }]);

      const ticket = createTicket({ id: 'T001', epic: 'core' });
      await manager.allocateWorktree(ticket, 'agent-1');

      expect(manager.canAcceptAgent('core')).toBe(true);

      await manager.releaseWorktree('agent-1');

      // Should be able to accept new agent now
      expect(manager.canAcceptAgent('core')).toBe(true);
    });

    test('handles release of non-existent worktree gracefully', async () => {
      // Should not throw
      await manager.releaseWorktree('non-existent-agent');
    });
  });

  describe('canAcceptAgent', () => {
    test('returns false for unknown epic', () => {
      expect(manager.canAcceptAgent('unknown')).toBe(false);
    });

    test('returns true for epic with no agents', async () => {
      mkdirSync(join(tempDir, 'core'), { recursive: true });

      await manager.initialize([{ name: 'core', path: 'core' }]);

      expect(manager.canAcceptAgent('core')).toBe(true);
    });

    test('returns true when under worktree limit', async () => {
      mkdirSync(join(tempDir, 'core'), { recursive: true });

      const mgr = new EpicManager(tempDir, { maxWorktreesPerEpic: 5 });
      await mgr.initialize([{ name: 'core', path: 'core' }]);

      const ticket = createTicket({ id: 'T001', epic: 'core' });
      await mgr.allocateWorktree(ticket, 'agent-1');

      expect(mgr.canAcceptAgent('core')).toBe(true);
    });

    test('returns false when at worktree limit', async () => {
      mkdirSync(join(tempDir, 'core'), { recursive: true });

      // Initialize git repo
      const initProc = Bun.spawn(['git', 'init'], { cwd: tempDir });
      await initProc.exited;
      const configProc1 = Bun.spawn(['git', 'config', 'user.email', 'test@test.com'], { cwd: tempDir });
      await configProc1.exited;
      const configProc2 = Bun.spawn(['git', 'config', 'user.name', 'Test'], { cwd: tempDir });
      await configProc2.exited;
      const touchProc = Bun.spawn(['touch', '.gitkeep'], { cwd: tempDir });
      await touchProc.exited;
      const addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
      await addProc.exited;
      const commitProc = Bun.spawn(['git', 'commit', '-m', 'initial'], { cwd: tempDir });
      await commitProc.exited;

      const mgr = new EpicManager(tempDir, { maxWorktreesPerEpic: 2 });
      await mgr.initialize([{ name: 'core', path: 'core' }]);

      // Allocate to limit
      const ticket1 = createTicket({ id: 'T001', epic: 'core' });
      await mgr.allocateWorktree(ticket1, 'agent-1');
      const ticket2 = createTicket({ id: 'T002', epic: 'core' });
      await mgr.allocateWorktree(ticket2, 'agent-2');

      expect(mgr.canAcceptAgent('core')).toBe(false);
    });
  });

  describe('getWorktreesForEpic', () => {
    test('returns empty array when no worktrees', async () => {
      mkdirSync(join(tempDir, 'core'), { recursive: true });

      await manager.initialize([{ name: 'core', path: 'core' }]);

      expect(manager.getWorktreesForEpic('core')).toEqual([]);
    });

    test('returns worktrees for specified epic', async () => {
      mkdirSync(join(tempDir, 'core'), { recursive: true });
      mkdirSync(join(tempDir, 'ui'), { recursive: true });

      await manager.initialize([
        { name: 'core', path: 'core' },
        { name: 'ui', path: 'ui' },
      ]);

      const coreTicket = createTicket({ id: 'T001', epic: 'core' });
      const uiTicket = createTicket({ id: 'T002', epic: 'ui' });

      await manager.allocateWorktree(coreTicket, 'agent-1');
      await manager.allocateWorktree(uiTicket, 'agent-2');

      const coreWorktrees = manager.getWorktreesForEpic('core');
      expect(coreWorktrees.length).toBe(1);
      expect(coreWorktrees[0].epicName).toBe('core');

      const uiWorktrees = manager.getWorktreesForEpic('ui');
      expect(uiWorktrees.length).toBe(1);
      expect(uiWorktrees[0].epicName).toBe('ui');
    });
  });
});

describe('Git Operations', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary git repo for testing
    tempDir = join(tmpdir(), `orch-git-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    // Initialize git repo
    const initProc = Bun.spawn(['git', 'init'], { cwd: tempDir });
    await initProc.exited;
    const configProc1 = Bun.spawn(['git', 'config', 'user.email', 'test@test.com'], { cwd: tempDir });
    await configProc1.exited;
    const configProc2 = Bun.spawn(['git', 'config', 'user.name', 'Test'], { cwd: tempDir });
    await configProc2.exited;

    // Create initial commit
    const touchProc = Bun.spawn(['touch', 'README.md'], { cwd: tempDir });
    await touchProc.exited;
    const addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
    await addProc.exited;
    const commitProc = Bun.spawn(['git', 'commit', '-m', 'Initial commit'], { cwd: tempDir });
    await commitProc.exited;
  });

  afterEach(() => {
    // Clean up temp directory and any worktrees
    if (existsSync(tempDir)) {
      // Remove worktrees first
      const worktreePath = join(tempDir, '..', 'test-worktree');
      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('listWorktrees', () => {
    test('returns main worktree for clean repo', async () => {
      const worktrees = await listWorktrees(tempDir);
      expect(worktrees.length).toBe(1);
      expect(worktrees[0]).toBe(tempDir);
    });

    test('returns all worktrees after creating one', async () => {
      const worktreePath = join(tempDir, '..', 'test-worktree');

      await createWorktree(tempDir, worktreePath, 'test-branch');

      const worktrees = await listWorktrees(tempDir);
      expect(worktrees.length).toBe(2);
      expect(worktrees).toContain(tempDir);
      expect(worktrees).toContain(worktreePath);

      // Cleanup
      const removeProc = Bun.spawn(['git', 'worktree', 'remove', worktreePath], { cwd: tempDir });
      await removeProc.exited;
    });
  });

  describe('createWorktree', () => {
    test('creates worktree at specified path', async () => {
      const worktreePath = join(tempDir, '..', `test-worktree-${Date.now()}`);

      await createWorktree(tempDir, worktreePath, 'feature-branch');

      expect(existsSync(worktreePath)).toBe(true);
      expect(existsSync(join(worktreePath, 'README.md'))).toBe(true);

      // Cleanup
      const removeProc = Bun.spawn(['git', 'worktree', 'remove', worktreePath], { cwd: tempDir });
      await removeProc.exited;
    });

    test('creates branch with correct name', async () => {
      const worktreePath = join(tempDir, '..', `test-worktree-${Date.now()}`);

      await createWorktree(tempDir, worktreePath, 'ticket/T001');

      // Check branch exists
      const branchProc = Bun.spawn(['git', 'branch', '--list', 'ticket/T001'], {
        cwd: tempDir,
        stdout: 'pipe',
      });
      await branchProc.exited;
      const output = await new Response(branchProc.stdout).text();
      expect(output).toContain('ticket/T001');

      // Cleanup
      const removeProc = Bun.spawn(['git', 'worktree', 'remove', worktreePath], { cwd: tempDir });
      await removeProc.exited;
    });

    test('throws error for invalid repo path', async () => {
      await expect(createWorktree('/nonexistent', '/tmp/worktree', 'branch'))
        .rejects.toThrow();
    });

    test('throws error for existing branch name', async () => {
      const worktreePath1 = join(tempDir, '..', `test-worktree1-${Date.now()}`);
      const worktreePath2 = join(tempDir, '..', `test-worktree2-${Date.now()}`);

      // Create first worktree with branch
      await createWorktree(tempDir, worktreePath1, 'duplicate-branch');

      // Try to create second with same branch name
      await expect(createWorktree(tempDir, worktreePath2, 'duplicate-branch'))
        .rejects.toThrow();

      // Cleanup
      const removeProc = Bun.spawn(['git', 'worktree', 'remove', worktreePath1], { cwd: tempDir });
      await removeProc.exited;
    });
  });

  describe('removeWorktree', () => {
    test('removes an existing worktree', async () => {
      const worktreePath = join(tempDir, '..', `test-worktree-remove-${Date.now()}`);

      // Create a worktree
      await createWorktree(tempDir, worktreePath, 'remove-test-branch');
      expect(existsSync(worktreePath)).toBe(true);

      // Remove it
      await removeWorktree(worktreePath);
      expect(existsSync(worktreePath)).toBe(false);
    });

    test('throws error for non-existent worktree', async () => {
      await expect(removeWorktree('/nonexistent/worktree'))
        .rejects.toThrow();
    });
  });

  describe('getCurrentBranch', () => {
    test('returns main branch for clean repo', async () => {
      const branch = await getCurrentBranch(tempDir);
      expect(['main', 'master']).toContain(branch);
    });

    test('returns branch name after checkout', async () => {
      // Create and checkout a new branch
      const branchProc = Bun.spawn(['git', 'checkout', '-b', 'test-branch-getcurrent'], { cwd: tempDir });
      await branchProc.exited;

      const branch = await getCurrentBranch(tempDir);
      expect(branch).toBe('test-branch-getcurrent');

      // Cleanup - checkout back
      const checkoutProc = Bun.spawn(['git', 'checkout', '-'], { cwd: tempDir });
      await checkoutProc.exited;
    });
  });

  describe('mergeBranch', () => {
    test('merges clean branch successfully', async () => {
      // Create a feature branch
      const branchProc = Bun.spawn(['git', 'checkout', '-b', 'feature-clean'], { cwd: tempDir });
      await branchProc.exited;

      // Make a change
      writeFileSync(join(tempDir, 'feature.txt'), 'feature content');
      const addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
      await addProc.exited;
      const commitProc = Bun.spawn(['git', 'commit', '-m', 'Add feature'], { cwd: tempDir });
      await commitProc.exited;

      // Get the main branch name
      const checkoutMainProc = Bun.spawn(['git', 'checkout', '-'], { cwd: tempDir });
      await checkoutMainProc.exited;
      const mainBranch = await getCurrentBranch(tempDir);

      // Merge
      const result = await mergeBranch(tempDir, 'feature-clean', mainBranch);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.mergedCommit).toBeDefined();
      expect(existsSync(join(tempDir, 'feature.txt'))).toBe(true);
    });

    test('detects merge conflicts', async () => {
      // Get the main branch
      const mainBranch = await getCurrentBranch(tempDir);

      // Create conflicting content on main
      writeFileSync(join(tempDir, 'conflict.txt'), 'main content');
      let addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
      await addProc.exited;
      let commitProc = Bun.spawn(['git', 'commit', '-m', 'Main change'], { cwd: tempDir });
      await commitProc.exited;

      // Create feature branch from before the change
      const branchProc = Bun.spawn(['git', 'checkout', '-b', 'feature-conflict', 'HEAD~1'], { cwd: tempDir });
      await branchProc.exited;

      // Make conflicting change on feature
      writeFileSync(join(tempDir, 'conflict.txt'), 'feature content');
      addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
      await addProc.exited;
      commitProc = Bun.spawn(['git', 'commit', '-m', 'Feature change'], { cwd: tempDir });
      await commitProc.exited;

      // Go back to main
      const checkoutProc = Bun.spawn(['git', 'checkout', mainBranch], { cwd: tempDir });
      await checkoutProc.exited;

      // Attempt merge
      const result = await mergeBranch(tempDir, 'feature-conflict', mainBranch);

      expect(result.success).toBe(false);
      expect(result.hasConflicts).toBe(true);
      expect(result.conflictFiles).toContain('conflict.txt');

      // Cleanup - abort merge
      await abortMerge(tempDir);
    });
  });

  describe('isMergeInProgress', () => {
    test('returns false when no merge in progress', async () => {
      const result = await isMergeInProgress(tempDir);
      expect(result).toBe(false);
    });

    test('returns true during merge conflict', async () => {
      // Get the main branch
      const mainBranch = await getCurrentBranch(tempDir);

      // Create conflicting content
      writeFileSync(join(tempDir, 'merge-check.txt'), 'main');
      let addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
      await addProc.exited;
      let commitProc = Bun.spawn(['git', 'commit', '-m', 'Main'], { cwd: tempDir });
      await commitProc.exited;

      // Create feature branch
      const branchProc = Bun.spawn(['git', 'checkout', '-b', 'feature-merge-check', 'HEAD~1'], { cwd: tempDir });
      await branchProc.exited;

      writeFileSync(join(tempDir, 'merge-check.txt'), 'feature');
      addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
      await addProc.exited;
      commitProc = Bun.spawn(['git', 'commit', '-m', 'Feature'], { cwd: tempDir });
      await commitProc.exited;

      // Go back and try merge
      const checkoutProc = Bun.spawn(['git', 'checkout', mainBranch], { cwd: tempDir });
      await checkoutProc.exited;

      // Start conflicting merge
      const mergeProc = Bun.spawn(['git', 'merge', 'feature-merge-check'], {
        cwd: tempDir,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await mergeProc.exited;

      const inProgress = await isMergeInProgress(tempDir);
      expect(inProgress).toBe(true);

      // Cleanup
      await abortMerge(tempDir);
    });
  });

  describe('completeMergeAfterConflictResolution', () => {
    test('throws when no merge in progress', async () => {
      await expect(completeMergeAfterConflictResolution(tempDir))
        .rejects.toThrow('No merge in progress');
    });

    test('completes merge after resolving conflicts', async () => {
      // Get the main branch
      const mainBranch = await getCurrentBranch(tempDir);

      // Create conflicting content
      writeFileSync(join(tempDir, 'complete-test.txt'), 'main');
      let addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
      await addProc.exited;
      let commitProc = Bun.spawn(['git', 'commit', '-m', 'Main complete'], { cwd: tempDir });
      await commitProc.exited;

      // Create feature branch
      const branchProc = Bun.spawn(['git', 'checkout', '-b', 'feature-complete', 'HEAD~1'], { cwd: tempDir });
      await branchProc.exited;

      writeFileSync(join(tempDir, 'complete-test.txt'), 'feature');
      addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
      await addProc.exited;
      commitProc = Bun.spawn(['git', 'commit', '-m', 'Feature complete'], { cwd: tempDir });
      await commitProc.exited;

      // Go back and start merge
      const checkoutProc = Bun.spawn(['git', 'checkout', mainBranch], { cwd: tempDir });
      await checkoutProc.exited;

      const mergeProc = Bun.spawn(['git', 'merge', 'feature-complete'], {
        cwd: tempDir,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await mergeProc.exited;

      // Manually resolve conflict
      writeFileSync(join(tempDir, 'complete-test.txt'), 'resolved');
      addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
      await addProc.exited;

      // Complete the merge
      const result = await completeMergeAfterConflictResolution(tempDir);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.mergedCommit).toBeDefined();
    });
  });
});

describe('EpicManager Merge Operations', () => {
  let tempDir: string;
  let manager: EpicManager;

  beforeEach(async () => {
    // Create a temporary git repo for testing
    tempDir = join(tmpdir(), `orch-merge-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(join(tempDir, 'core'), { recursive: true });

    // Initialize git repo
    const initProc = Bun.spawn(['git', 'init'], { cwd: tempDir });
    await initProc.exited;
    const configProc1 = Bun.spawn(['git', 'config', 'user.email', 'test@test.com'], { cwd: tempDir });
    await configProc1.exited;
    const configProc2 = Bun.spawn(['git', 'config', 'user.name', 'Test'], { cwd: tempDir });
    await configProc2.exited;

    // Create initial commit
    writeFileSync(join(tempDir, 'README.md'), '# Test');
    const addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
    await addProc.exited;
    const commitProc = Bun.spawn(['git', 'commit', '-m', 'Initial commit'], { cwd: tempDir });
    await commitProc.exited;

    manager = new EpicManager(tempDir);
    await manager.initialize([{ name: 'core', path: 'core' }]);
    resetEventBus();
  });

  afterEach(async () => {
    // Clean up worktrees first
    const worktrees = await listWorktrees(tempDir);
    for (const wt of worktrees) {
      if (wt !== tempDir) {
        try {
          await removeWorktree(wt, true);
        } catch {
          // Ignore errors during cleanup
        }
      }
    }

    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('mergeWorktree', () => {
    test('throws for untracked worktree', async () => {
      await expect(manager.mergeWorktree('/nonexistent/path'))
        .rejects.toThrow('Worktree not tracked');
    });

    test('emits epic:worktree-merged on success', async () => {
      const ticket = createTicket({ id: 'T001', epic: 'core' });
      await manager.allocateWorktree(ticket, 'agent-1');

      // Create a second worktree to test merge
      const ticket2 = createTicket({ id: 'T002', epic: 'core' });
      const allocation = await manager.allocateWorktree(ticket2, 'agent-2');

      // Make a change in the worktree
      writeFileSync(join(allocation.worktreePath, 'test.txt'), 'test');
      let addProc = Bun.spawn(['git', 'add', '.'], { cwd: allocation.worktreePath });
      await addProc.exited;
      let commitProc = Bun.spawn(['git', 'commit', '-m', 'Test change'], { cwd: allocation.worktreePath });
      await commitProc.exited;

      // Track events
      const events: OrchEvent[] = [];
      getEventBus().subscribe('epic:worktree-merged', (event) => {
        events.push(event);
      });

      // Get main branch name
      const mainBranch = await getCurrentBranch(tempDir);

      // Merge the worktree
      const result = await manager.mergeWorktree(allocation.worktreePath, mainBranch);

      expect(result.success).toBe(true);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('epic:worktree-merged');
    });

    test('emits epic:conflict on merge conflict', async () => {
      const mainBranch = await getCurrentBranch(tempDir);

      // First, create a file that will be conflicted
      writeFileSync(join(tempDir, 'conflict-file.txt'), 'initial content');
      let addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
      await addProc.exited;
      let commitProc = Bun.spawn(['git', 'commit', '-m', 'Initial conflict file'], { cwd: tempDir });
      await commitProc.exited;

      // Allocate first worktree (uses main epic dir)
      const ticket1 = createTicket({ id: 'T001', epic: 'core' });
      await manager.allocateWorktree(ticket1, 'agent-1');

      // Allocate second worktree - this branches from current HEAD
      const ticket2 = createTicket({ id: 'T002', epic: 'core' });
      const allocation = await manager.allocateWorktree(ticket2, 'agent-2');

      // Make a change in the worktree first
      writeFileSync(join(allocation.worktreePath, 'conflict-file.txt'), 'worktree content');
      addProc = Bun.spawn(['git', 'add', '.'], { cwd: allocation.worktreePath });
      await addProc.exited;
      commitProc = Bun.spawn(['git', 'commit', '-m', 'Worktree conflict'], { cwd: allocation.worktreePath });
      await commitProc.exited;

      // Now create conflicting change on main
      writeFileSync(join(tempDir, 'conflict-file.txt'), 'main content');
      addProc = Bun.spawn(['git', 'add', '.'], { cwd: tempDir });
      await addProc.exited;
      commitProc = Bun.spawn(['git', 'commit', '-m', 'Main conflict'], { cwd: tempDir });
      await commitProc.exited;

      // Track events
      const events: OrchEvent[] = [];
      getEventBus().subscribe('epic:conflict', (event) => {
        events.push(event);
      });

      // Attempt merge
      const result = await manager.mergeWorktree(allocation.worktreePath, mainBranch);

      expect(result.success).toBe(false);
      expect(result.hasConflicts).toBe(true);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('epic:conflict');

      // Cleanup
      await abortMerge(tempDir);
    });
  });

  describe('cleanupWorktree', () => {
    test('removes worktree and updates tracking', async () => {
      // Create worktrees
      const ticket1 = createTicket({ id: 'T001', epic: 'core' });
      await manager.allocateWorktree(ticket1, 'agent-1');

      const ticket2 = createTicket({ id: 'T002', epic: 'core' });
      const allocation = await manager.allocateWorktree(ticket2, 'agent-2');

      expect(manager.getWorktreeByPath(allocation.worktreePath)).toBeDefined();

      // Cleanup the worktree
      await manager.cleanupWorktree(allocation.worktreePath);

      expect(manager.getWorktreeByPath(allocation.worktreePath)).toBeUndefined();
      expect(existsSync(allocation.worktreePath)).toBe(false);
    });
  });

  describe('getWorktreeByPath', () => {
    test('finds tracked worktree by path', async () => {
      const ticket = createTicket({ id: 'T001', epic: 'core' });
      const allocation = await manager.allocateWorktree(ticket, 'agent-1');

      const worktree = manager.getWorktreeByPath(allocation.worktreePath);
      expect(worktree).toBeDefined();
      expect(worktree?.ticketId).toBe('T001');
    });

    test('returns undefined for unknown path', () => {
      expect(manager.getWorktreeByPath('/unknown/path')).toBeUndefined();
    });
  });

  describe('getWorktreeByTicketId', () => {
    test('finds tracked worktree by ticket ID', async () => {
      const ticket = createTicket({ id: 'T001', epic: 'core' });
      await manager.allocateWorktree(ticket, 'agent-1');

      const worktree = manager.getWorktreeByTicketId('T001');
      expect(worktree).toBeDefined();
      expect(worktree?.agentId).toBe('agent-1');
    });

    test('returns undefined for unknown ticket ID', () => {
      expect(manager.getWorktreeByTicketId('UNKNOWN')).toBeUndefined();
    });
  });
});
