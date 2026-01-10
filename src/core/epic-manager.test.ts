/**
 * Unit tests for EpicManager
 * Implements: T031 validation
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { EpicManager, createWorktree, listWorktrees } from './epic-manager';
import { resetEventBus, getEventBus } from './events';
import type { Ticket, Epic, OrchEvent } from './types';
import { mkdirSync, rmSync, existsSync } from 'fs';
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
});
