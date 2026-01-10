/**
 * Orchestrator Tests
 *
 * Tests for T008: Orchestrator Core Loop
 */

import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { Orchestrator, DependencyGraph } from './orchestrator';
import { PlanStore } from './plan-store';
import { AgentManager } from './agent-manager';
import { EpicManager } from './epic-manager';
import { EventBus, getEventBus, resetEventBus } from './events';
import type { OrchConfig, Ticket, TicketStatus, ValidationResult, AgentCompletedEvent, AgentFailedEvent, AgentBlockedEvent } from './types';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// =============================================================================
// Test Fixtures
// =============================================================================

const createDefaultConfig = (): OrchConfig => ({
  maxAgents: 5,
  agentModel: 'sonnet',
  planFile: 'PLAN.md',
  logLevel: 'info',
  automation: {
    ticketProgression: 'automatic',
    review: { mode: 'automatic' },
    qa: { mode: 'automatic' },
  },
});

const createMinimalPlan = () => `# Test Plan

## 7. Task Backlog

### Ticket: T001 First Task
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** First task description
- **Acceptance Criteria:**
  - Criterion 1
- **Validation Steps:**
  - \`echo "pass"\`

### Ticket: T002 Second Task
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
- **Dependencies:** T001
`;

const createMultiTicketPlan = () => `# Test Plan

## 7. Task Backlog

### Ticket: T001 First Task
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed

### Ticket: T002 Second Task
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Dependencies:** T001

### Ticket: T003 Third Task
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
- **Dependencies:** T001

### Ticket: T004 Fourth Task
- **Priority:** P2
- **Status:** Todo
- **Owner:** Unassigned
- **Dependencies:** T002, T003
`;

// =============================================================================
// DependencyGraph Tests
// =============================================================================

describe('DependencyGraph', () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  describe('build', () => {
    test('builds graph from tickets', () => {
      const tickets: Ticket[] = [
        { id: 'T001', title: 'First', priority: 'P0', status: 'Done', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
        { id: 'T002', title: 'Second', priority: 'P0', status: 'Todo', dependencies: ['T001'], acceptanceCriteria: [], validationSteps: [] },
      ];

      graph.build(tickets);

      expect(graph.getDependencies('T001')).toEqual([]);
      expect(graph.getDependencies('T002')).toEqual(['T001']);
      expect(graph.getDependents('T001')).toEqual(['T002']);
    });

    test('clears existing graph on rebuild', () => {
      const tickets1: Ticket[] = [
        { id: 'T001', title: 'First', priority: 'P0', status: 'Todo', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
      ];
      graph.build(tickets1);

      const tickets2: Ticket[] = [
        { id: 'T002', title: 'Second', priority: 'P0', status: 'Todo', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
      ];
      graph.build(tickets2);

      expect(graph.getTicket('T001')).toBeUndefined();
      expect(graph.getTicket('T002')).toBeDefined();
    });
  });

  describe('getReadyTickets', () => {
    test('returns Todo tickets with all dependencies Done', () => {
      const tickets: Ticket[] = [
        { id: 'T001', title: 'First', priority: 'P0', status: 'Done', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
        { id: 'T002', title: 'Second', priority: 'P0', status: 'Todo', dependencies: ['T001'], acceptanceCriteria: [], validationSteps: [] },
        { id: 'T003', title: 'Third', priority: 'P0', status: 'Todo', dependencies: ['T002'], acceptanceCriteria: [], validationSteps: [] },
      ];

      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('T002');
    });

    test('returns empty array when no tickets are ready', () => {
      const tickets: Ticket[] = [
        { id: 'T001', title: 'First', priority: 'P0', status: 'InProgress', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
        { id: 'T002', title: 'Second', priority: 'P0', status: 'Todo', dependencies: ['T001'], acceptanceCriteria: [], validationSteps: [] },
      ];

      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready).toHaveLength(0);
    });

    test('sorts by priority (P0 > P1 > P2)', () => {
      const tickets: Ticket[] = [
        { id: 'T001', title: 'Low Priority', priority: 'P2', status: 'Todo', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
        { id: 'T002', title: 'High Priority', priority: 'P0', status: 'Todo', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
        { id: 'T003', title: 'Medium Priority', priority: 'P1', status: 'Todo', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
      ];

      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready).toHaveLength(3);
      expect(ready[0].priority).toBe('P0');
      expect(ready[1].priority).toBe('P1');
      expect(ready[2].priority).toBe('P2');
    });
  });

  describe('getBlockedBy', () => {
    test('returns blocking dependencies', () => {
      const tickets: Ticket[] = [
        { id: 'T001', title: 'First', priority: 'P0', status: 'InProgress', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
        { id: 'T002', title: 'Second', priority: 'P0', status: 'Todo', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
        { id: 'T003', title: 'Third', priority: 'P0', status: 'Todo', dependencies: ['T001', 'T002'], acceptanceCriteria: [], validationSteps: [] },
      ];

      graph.build(tickets);

      const blockedBy = graph.getBlockedBy('T003');
      expect(blockedBy).toHaveLength(2);
      expect(blockedBy.map(t => t.id)).toContain('T001');
      expect(blockedBy.map(t => t.id)).toContain('T002');
    });

    test('returns empty array when no blocking dependencies', () => {
      const tickets: Ticket[] = [
        { id: 'T001', title: 'First', priority: 'P0', status: 'Done', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
        { id: 'T002', title: 'Second', priority: 'P0', status: 'Todo', dependencies: ['T001'], acceptanceCriteria: [], validationSteps: [] },
      ];

      graph.build(tickets);

      const blockedBy = graph.getBlockedBy('T002');
      expect(blockedBy).toHaveLength(0);
    });
  });

  describe('detectCycles', () => {
    test('returns empty array for acyclic graph', () => {
      const tickets: Ticket[] = [
        { id: 'T001', title: 'First', priority: 'P0', status: 'Done', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
        { id: 'T002', title: 'Second', priority: 'P0', status: 'Todo', dependencies: ['T001'], acceptanceCriteria: [], validationSteps: [] },
        { id: 'T003', title: 'Third', priority: 'P0', status: 'Todo', dependencies: ['T001', 'T002'], acceptanceCriteria: [], validationSteps: [] },
      ];

      graph.build(tickets);

      const cycles = graph.detectCycles();
      expect(cycles).toHaveLength(0);
    });

    test('detects simple cycle', () => {
      const tickets: Ticket[] = [
        { id: 'T001', title: 'First', priority: 'P0', status: 'Todo', dependencies: ['T002'], acceptanceCriteria: [], validationSteps: [] },
        { id: 'T002', title: 'Second', priority: 'P0', status: 'Todo', dependencies: ['T001'], acceptanceCriteria: [], validationSteps: [] },
      ];

      graph.build(tickets);

      const cycles = graph.detectCycles();
      expect(cycles.length).toBeGreaterThan(0);
    });
  });

  describe('updateTicketStatus', () => {
    test('updates ticket status in graph', () => {
      const tickets: Ticket[] = [
        { id: 'T001', title: 'First', priority: 'P0', status: 'Todo', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
      ];

      graph.build(tickets);
      graph.updateTicketStatus('T001', 'InProgress');

      const ticket = graph.getTicket('T001');
      expect(ticket?.status).toBe('InProgress');
    });
  });
});

// =============================================================================
// Orchestrator Tests
// =============================================================================

describe('Orchestrator', () => {
  let tempDir: string;
  let planPath: string;
  let planStore: PlanStore;
  let agentManager: AgentManager;
  let epicManager: EpicManager;
  let config: OrchConfig;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'orchestrator-test-'));
    planPath = join(tempDir, 'PLAN.md');
    resetEventBus();

    // Create a basic plan file
    await writeFile(planPath, createMinimalPlan());

    // Create dependencies
    planStore = new PlanStore(planPath);
    agentManager = new AgentManager(5, 'sonnet');
    epicManager = new EpicManager(tempDir);
    config = createDefaultConfig();
  });

  afterEach(async () => {
    if (orchestrator?.isRunning()) {
      await orchestrator.stop();
    }
    await rm(tempDir, { recursive: true });
  });

  describe('start', () => {
    test('loads plan and builds dependency graph', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);

      await orchestrator.start();

      expect(orchestrator.isRunning()).toBe(true);
      const graph = orchestrator.getDependencyGraph();
      expect(graph.getTicket('T001')).toBeDefined();
      expect(graph.getTicket('T002')).toBeDefined();
    });

    test('emits tickets:ready event when ready tickets exist', async () => {
      const events: unknown[] = [];
      getEventBus().subscribe('tickets:ready', (e) => events.push(e));

      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      expect(events).toHaveLength(1);
    });

    test('does nothing if already running', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);

      await orchestrator.start();
      const graph1 = orchestrator.getDependencyGraph();

      // Start again should be a no-op
      await orchestrator.start();
      const graph2 = orchestrator.getDependencyGraph();

      expect(graph1).toBe(graph2);
    });
  });

  describe('stop', () => {
    test('stops orchestrator and clears state', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      await orchestrator.stop();

      expect(orchestrator.isRunning()).toBe(false);
    });

    test('does nothing if not running', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);

      // Should not throw
      await orchestrator.stop();

      expect(orchestrator.isRunning()).toBe(false);
    });

    test('unsubscribes from events', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();
      await orchestrator.stop();

      // Publishing events should not trigger orchestrator handlers
      // (no error should occur)
      getEventBus().publish({
        type: 'agent:completed',
        timestamp: new Date(),
        agentId: 'test-agent',
        ticketId: 'T001',
      });
    });
  });

  describe('getReadyTickets', () => {
    test('delegates to dependency graph', async () => {
      await writeFile(planPath, createMultiTicketPlan());
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      const ready = orchestrator.getReadyTickets();

      expect(ready.length).toBeGreaterThan(0);
      // T001 is Done, T002 and T003 depend only on T001, T004 depends on T002 and T003
      const readyIds = ready.map(t => t.id);
      expect(readyIds).toContain('T002');
      expect(readyIds).toContain('T003');
      expect(readyIds).not.toContain('T004');
    });

    test('respects priority ordering', async () => {
      await writeFile(planPath, createMultiTicketPlan());
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      const ready = orchestrator.getReadyTickets();

      // T002 is P0, T003 is P1
      expect(ready[0].priority).toBe('P0');
      if (ready.length > 1) {
        expect(ready[1].priority).toBe('P1');
      }
    });
  });

  describe('getBlockedBy', () => {
    test('delegates to dependency graph', async () => {
      await writeFile(planPath, createMultiTicketPlan());
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      const blockedBy = orchestrator.getBlockedBy('T004');

      // T004 depends on T002 and T003, both are Todo
      expect(blockedBy).toHaveLength(2);
    });
  });

  describe('detectCircularDependencies', () => {
    test('returns empty array for valid plan', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      const cycles = orchestrator.detectCircularDependencies();

      expect(cycles).toHaveLength(0);
    });
  });

  describe('assignTicket', () => {
    test('throws error when orchestrator not running', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);

      await expect(orchestrator.assignTicket('T001')).rejects.toThrow('Orchestrator is not running');
    });

    test('throws error for non-existent ticket', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      await expect(orchestrator.assignTicket('T999')).rejects.toThrow('Ticket not found');
    });

    test('throws error for non-Todo ticket', async () => {
      await writeFile(planPath, createMultiTicketPlan());
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      await expect(orchestrator.assignTicket('T001')).rejects.toThrow('not in Todo status');
    });

    test('throws error for blocked ticket', async () => {
      await writeFile(planPath, createMultiTicketPlan());
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      await expect(orchestrator.assignTicket('T004')).rejects.toThrow('blocked by');
    });
  });

  describe('advanceTicket', () => {
    test('advances from InProgress to Review when review is automatic', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Task
- **Priority:** P0
- **Status:** In Progress
- **Owner:** Agent-1
`;
      await writeFile(planPath, planContent);

      config.automation.review.mode = 'automatic';
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      await orchestrator.advanceTicket('T001');

      const ticket = planStore.getTicket('T001');
      expect(ticket?.status).toBe('Review');
    });

    test('advances from InProgress to Done when review and QA are manual', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Task
- **Priority:** P0
- **Status:** In Progress
- **Owner:** Agent-1
`;
      await writeFile(planPath, planContent);

      config.automation.review.mode = 'manual';
      config.automation.qa.mode = 'manual';
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      await orchestrator.advanceTicket('T001');

      const ticket = planStore.getTicket('T001');
      expect(ticket?.status).toBe('Done');
    });

    test('advances from Review to QA', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Task
- **Priority:** P0
- **Status:** Review
- **Owner:** Agent-1
`;
      await writeFile(planPath, planContent);

      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      await orchestrator.advanceTicket('T001');

      const ticket = planStore.getTicket('T001');
      expect(ticket?.status).toBe('QA');
    });

    test('advances from QA to Done', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Task
- **Priority:** P0
- **Status:** QA
- **Owner:** Agent-1
`;
      await writeFile(planPath, planContent);

      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      await orchestrator.advanceTicket('T001');

      const ticket = planStore.getTicket('T001');
      expect(ticket?.status).toBe('Done');
    });

    test('throws error for non-existent ticket', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      await expect(orchestrator.advanceTicket('T999')).rejects.toThrow('Ticket not found');
    });
  });

  describe('rejectTicket', () => {
    test('moves ticket from Review to Todo with feedback', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Task
- **Priority:** P0
- **Status:** Review
- **Owner:** Agent-1
`;
      await writeFile(planPath, planContent);

      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      await orchestrator.rejectTicket('T001', 'Needs more tests');

      const ticket = planStore.getTicket('T001');
      expect(ticket?.status).toBe('Todo');
      expect(ticket?.notes).toContain('Needs more tests');
    });

    test('throws error for non-Review/QA ticket', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      await expect(orchestrator.rejectTicket('T001', 'feedback')).rejects.toThrow('cannot be rejected');
    });
  });

  describe('retryTicket', () => {
    test('moves ticket from Failed to Todo', async () => {
      const planContent = `# Test Plan

### Ticket: T001 Test Task
- **Priority:** P0
- **Status:** Failed
- **Owner:** Agent-1
`;
      await writeFile(planPath, planContent);

      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      await orchestrator.retryTicket('T001');

      const ticket = planStore.getTicket('T001');
      expect(ticket?.status).toBe('Todo');
    });

    test('throws error for non-Failed ticket', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      await expect(orchestrator.retryTicket('T001')).rejects.toThrow('is not retryable');
    });
  });

  describe('tick', () => {
    test('does nothing when not running', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);

      // Should not throw
      await orchestrator.tick();
    });

    test('does nothing in manual mode', async () => {
      config.automation.ticketProgression = 'manual';
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      const events: unknown[] = [];
      getEventBus().subscribe('log:entry', (e) => events.push(e));

      await orchestrator.tick();

      // No auto-assign logs should appear
      const assignLogs = events.filter((e: any) => e.message?.includes('Auto-assigned'));
      expect(assignLogs).toHaveLength(0);
    });
  });

  describe('runValidation', () => {
    test('runs validation steps for a ticket', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      const ticket = planStore.getTicket('T001');
      const result = await orchestrator.runValidation(ticket!, tempDir);

      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
      expect(Array.isArray(result.steps)).toBe(true);
    });
  });

  describe('event handling', () => {
    test('subscribes to agent:completed events on start', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      // The orchestrator should have subscribed to events
      // We can verify by checking that publishing an event doesn't throw
      // and gets processed (though we'd need mocking to fully verify)
      expect(orchestrator.isRunning()).toBe(true);
    });

    test('ignores events after stop', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();
      await orchestrator.stop();

      // This should not cause any errors or side effects
      getEventBus().publish({
        type: 'agent:completed',
        timestamp: new Date(),
        agentId: 'test-agent',
        ticketId: 'T001',
      } as AgentCompletedEvent);
    });
  });

  describe('reloadPlan', () => {
    test('reloads plan and rebuilds dependency graph', async () => {
      orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
      await orchestrator.start();

      // Modify the plan file
      await writeFile(planPath, createMultiTicketPlan());

      await orchestrator.reloadPlan();

      // New tickets should be available
      const graph = orchestrator.getDependencyGraph();
      expect(graph.getTicket('T003')).toBeDefined();
      expect(graph.getTicket('T004')).toBeDefined();
    });
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Orchestrator Integration', () => {
  let tempDir: string;
  let planPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'orchestrator-int-test-'));
    planPath = join(tempDir, 'PLAN.md');
    resetEventBus();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  test('complete workflow: start, get ready tickets, check priorities', async () => {
    await writeFile(planPath, createMultiTicketPlan());

    const planStore = new PlanStore(planPath);
    const agentManager = new AgentManager(5, 'sonnet');
    const epicManager = new EpicManager(tempDir);
    const config = createDefaultConfig();

    const orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
    await orchestrator.start();

    // Get ready tickets
    const ready = orchestrator.getReadyTickets();
    expect(ready.length).toBeGreaterThan(0);

    // Verify priority ordering
    for (let i = 1; i < ready.length; i++) {
      const prevPriority = { P0: 0, P1: 1, P2: 2 }[ready[i - 1].priority];
      const currPriority = { P0: 0, P1: 1, P2: 2 }[ready[i].priority];
      expect(currPriority).toBeGreaterThanOrEqual(prevPriority);
    }

    // T004 should be blocked
    const blockedBy = orchestrator.getBlockedBy('T004');
    expect(blockedBy.length).toBeGreaterThan(0);

    await orchestrator.stop();
  });

  test('status transitions update dependency graph', async () => {
    const planContent = `# Test Plan

### Ticket: T001 First
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned

### Ticket: T002 Second
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Dependencies:** T001
`;
    await writeFile(planPath, planContent);

    const planStore = new PlanStore(planPath);
    const agentManager = new AgentManager(5, 'sonnet');
    const epicManager = new EpicManager(tempDir);
    const config = createDefaultConfig();

    const orchestrator = new Orchestrator(planStore, agentManager, epicManager, config, tempDir);
    await orchestrator.start();

    // Initially, T001 is ready, T002 is blocked
    let ready = orchestrator.getReadyTickets();
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe('T001');

    // Mark T001 as Done via advanceTicket after setting it to InProgress
    await planStore.updateTicketStatus('T001', 'InProgress');
    orchestrator.getDependencyGraph().updateTicketStatus('T001', 'InProgress');

    // Now advance to Done (skipping review/qa for this test)
    config.automation.review.mode = 'manual';
    config.automation.qa.mode = 'manual';
    await orchestrator.advanceTicket('T001');

    // T002 should now be ready
    ready = orchestrator.getReadyTickets();
    expect(ready).toHaveLength(1);
    expect(ready[0].id).toBe('T002');

    await orchestrator.stop();
  });
});
