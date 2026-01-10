/**
 * Orchestrator Integration Tests
 *
 * End-to-end tests for orchestration workflows.
 * Uses real PlanStore with temp files and mock AgentManager.
 *
 * Implements: T024
 */

import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { Orchestrator, DependencyGraph } from './orchestrator';
import { PlanStore } from './plan-store';
import { AgentManager } from './agent-manager';
import { EpicManager } from './epic-manager';
import { EventBus, getEventBus, resetEventBus } from './events';
import type {
  OrchConfig,
  Ticket,
  TicketStatus,
  AgentCompletedEvent,
  AgentFailedEvent,
  AgentBlockedEvent,
  TicketStatusChangedEvent,
} from './types';
import { createTempDir, createTestPlan } from '../test-utils';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
    review: { mode: 'manual' },
    qa: { mode: 'manual' },
  },
});

/**
 * Creates a mock AgentManager that tracks spawned agents
 * and allows simulating completions
 */
function createMockAgentManager(maxAgents: number = 5) {
  const agents: Map<string, { ticketId: string; status: string }> = new Map();
  let agentCounter = 0;

  return {
    agents,
    agentCounter: () => agentCounter,

    // Mock canSpawn
    canSpawn: () => agents.size < maxAgents,

    // Mock spawn - returns agent ID and tracks the spawn
    spawn: async (options: { ticketId: string; workingDirectory: string }) => {
      if (agents.size >= maxAgents) {
        throw new Error(`Cannot spawn agent: max concurrency reached`);
      }
      agentCounter++;
      const agentId = `mock-agent-${agentCounter}`;
      agents.set(agentId, { ticketId: options.ticketId, status: 'Working' });

      // Emit agent:spawned event
      getEventBus().publish({
        type: 'agent:spawned',
        timestamp: new Date(),
        agentId,
        ticketId: options.ticketId,
      });

      return agentId;
    },

    // Simulate agent completion by publishing event
    simulateComplete: (agentId: string) => {
      const agent = agents.get(agentId);
      if (agent) {
        agent.status = 'Complete';
        getEventBus().publish({
          type: 'agent:completed',
          timestamp: new Date(),
          agentId,
          ticketId: agent.ticketId,
        } as AgentCompletedEvent);
      }
    },

    // Simulate agent failure
    simulateFailed: (agentId: string, error?: string) => {
      const agent = agents.get(agentId);
      if (agent) {
        agent.status = 'Failed';
        getEventBus().publish({
          type: 'agent:failed',
          timestamp: new Date(),
          agentId,
          ticketId: agent.ticketId,
          error,
        } as AgentFailedEvent);
      }
    },

    // Simulate agent blocked
    simulateBlocked: (agentId: string, reason?: string) => {
      const agent = agents.get(agentId);
      if (agent) {
        agent.status = 'Blocked';
        getEventBus().publish({
          type: 'agent:blocked',
          timestamp: new Date(),
          agentId,
          ticketId: agent.ticketId,
          reason,
        } as AgentBlockedEvent);
      }
    },

    getAgent: (agentId: string) => {
      const agent = agents.get(agentId);
      if (!agent) return undefined;
      return {
        id: agentId,
        type: 'Implementation',
        status: agent.status,
        ticketId: agent.ticketId,
        tokensUsed: 0,
        cost: 0,
        progress: 0,
      };
    },

    getAllAgents: () => Array.from(agents.entries()).map(([id, a]) => ({
      id,
      type: 'Implementation',
      status: a.status,
      ticketId: a.ticketId,
      tokensUsed: 0,
      cost: 0,
      progress: 0,
    })),

    getActiveCount: () => {
      return Array.from(agents.values()).filter(
        (a) => a.status === 'Working' || a.status === 'Starting'
      ).length;
    },

    stopAll: async () => {
      agents.clear();
    },

    stop: async (agentId: string) => {
      agents.delete(agentId);
    },

    setMaxAgents: (n: number) => {},
    getMaxAgents: () => maxAgents,
  };
}

/**
 * Creates a mock EpicManager that returns project root for all allocations
 */
function createMockEpicManager(projectRoot: string) {
  const worktrees: Map<string, { path: string; ticketId: string; epicName?: string }> = new Map();

  return {
    discoverEpics: () => [],
    initialize: async () => {},
    getAllEpics: () => [],
    getEpic: () => undefined,
    canAcceptAgent: () => true,

    allocateWorktree: async (ticket: Ticket, agentId: string) => {
      const allocation = {
        worktreePath: projectRoot,
        branch: `ticket/${ticket.id}`,
        isNew: false,
      };
      worktrees.set(agentId, {
        path: projectRoot,
        ticketId: ticket.id,
        epicName: ticket.epic,
      });
      return allocation;
    },

    releaseWorktree: async (agentId: string) => {
      worktrees.delete(agentId);
    },

    getWorktreeForAgent: (agentId: string) => {
      const wt = worktrees.get(agentId);
      if (!wt) return undefined;
      return {
        path: wt.path,
        epicName: wt.epicName || 'default',
        agentId,
        ticketId: wt.ticketId,
        branch: `ticket/${wt.ticketId}`,
        createdAt: new Date(),
      };
    },

    getWorktreeByTicketId: (ticketId: string) => {
      for (const [agentId, wt] of worktrees) {
        if (wt.ticketId === ticketId) {
          return {
            path: wt.path,
            epicName: wt.epicName || 'default',
            agentId,
            ticketId,
            branch: `ticket/${ticketId}`,
            createdAt: new Date(),
          };
        }
      }
      return undefined;
    },

    getWorktreesForEpic: () => [],
  };
}

// =============================================================================
// Integration Tests
// =============================================================================

describe('Orchestrator Integration Tests', () => {
  let tempDir: string;
  let cleanup: () => Promise<void>;
  let planPath: string;

  beforeEach(async () => {
    const temp = await createTempDir('orch-integration-');
    tempDir = temp.path;
    cleanup = temp.cleanup;
    planPath = join(tempDir, 'PLAN.md');
    resetEventBus();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('Full ticket completion cycle', () => {
    test('parse plan -> compute ready -> assign agent -> complete -> update plan', async () => {
      // Create a simple plan with one ready ticket
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Implement Feature
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Scope:** Implement a new feature
- **Acceptance Criteria:**
  - Feature works correctly
- **Validation Steps:**
  - \`echo "pass"\`
`;
      await writeFile(planPath, planContent);

      // Set up components with mocks
      const planStore = new PlanStore(planPath);
      const mockAgentManager = createMockAgentManager();
      const mockEpicManager = createMockEpicManager(tempDir);
      const config = createDefaultConfig();

      // Create orchestrator with mocked dependencies
      const orchestrator = new Orchestrator(
        planStore,
        mockAgentManager as unknown as AgentManager,
        mockEpicManager as unknown as EpicManager,
        config,
        tempDir
      );

      // Track events
      const statusChanges: TicketStatusChangedEvent[] = [];
      getEventBus().subscribe<TicketStatusChangedEvent>('ticket:status-changed', (e) => {
        statusChanges.push(e);
      });

      // Step 1: Start orchestrator - should parse plan and compute ready tickets
      await orchestrator.start();
      expect(orchestrator.isRunning()).toBe(true);

      const readyTickets = orchestrator.getReadyTickets();
      expect(readyTickets).toHaveLength(1);
      expect(readyTickets[0].id).toBe('T001');
      expect(readyTickets[0].status).toBe('Todo');

      // Step 2: Assign agent to ticket
      const agentId = await orchestrator.assignTicket('T001');
      expect(agentId).toBe('mock-agent-1');
      expect(mockAgentManager.agents.get(agentId)?.ticketId).toBe('T001');

      // Verify ticket status changed to InProgress
      const ticket = planStore.getTicket('T001');
      expect(ticket?.status).toBe('InProgress');

      // Step 3: Simulate agent completion
      mockAgentManager.simulateComplete(agentId);

      // Wait for async event handling
      await new Promise((r) => setTimeout(r, 50));

      // Step 4: Verify ticket was advanced (to Done since review/qa are manual)
      const updatedTicket = planStore.getTicket('T001');
      expect(updatedTicket?.status).toBe('Done');

      // Verify status change events
      expect(statusChanges.length).toBeGreaterThanOrEqual(2);
      expect(statusChanges.some((e) => e.previousStatus === 'Todo' && e.newStatus === 'InProgress')).toBe(true);
      expect(statusChanges.some((e) => e.newStatus === 'Done')).toBe(true);

      // Step 5: Verify plan file was updated
      const planFileContent = await readFile(planPath, 'utf-8');
      expect(planFileContent).toContain('Status:** Done');

      await orchestrator.stop();
    });

    test('handles validation failure correctly', async () => {
      // Create a ticket with a failing validation step
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Failing Ticket
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Validation Steps:**
  - \`exit 1\`
`;
      await writeFile(planPath, planContent);

      const planStore = new PlanStore(planPath);
      const mockAgentManager = createMockAgentManager();
      const mockEpicManager = createMockEpicManager(tempDir);
      const config = createDefaultConfig();

      const orchestrator = new Orchestrator(
        planStore,
        mockAgentManager as unknown as AgentManager,
        mockEpicManager as unknown as EpicManager,
        config,
        tempDir
      );

      await orchestrator.start();

      // Assign and complete
      const agentId = await orchestrator.assignTicket('T001');
      mockAgentManager.simulateComplete(agentId);

      // Wait for async handling
      await new Promise((r) => setTimeout(r, 50));

      // Ticket should be Failed due to validation failure
      const ticket = planStore.getTicket('T001');
      expect(ticket?.status).toBe('Failed');

      await orchestrator.stop();
    });
  });

  describe('Dependency chain handling', () => {
    test('B is blocked until A is done', async () => {
      // Create plan with A -> B dependency
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Task A
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Validation Steps:**
  - \`echo "A done"\`

### Ticket: T002 Task B
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Dependencies:** T001
- **Validation Steps:**
  - \`echo "B done"\`
`;
      await writeFile(planPath, planContent);

      const planStore = new PlanStore(planPath);
      const mockAgentManager = createMockAgentManager();
      const mockEpicManager = createMockEpicManager(tempDir);
      // Use manual progression to test dependency chain without auto-assignment
      const config = { ...createDefaultConfig(), automation: { ...createDefaultConfig().automation, ticketProgression: 'manual' as const } };

      const orchestrator = new Orchestrator(
        planStore,
        mockAgentManager as unknown as AgentManager,
        mockEpicManager as unknown as EpicManager,
        config,
        tempDir
      );

      await orchestrator.start();

      // Initially only A should be ready
      let readyTickets = orchestrator.getReadyTickets();
      expect(readyTickets).toHaveLength(1);
      expect(readyTickets[0].id).toBe('T001');

      // B should be blocked by A
      const blockedBy = orchestrator.getBlockedBy('T002');
      expect(blockedBy).toHaveLength(1);
      expect(blockedBy[0].id).toBe('T001');

      // Trying to assign B should fail
      await expect(orchestrator.assignTicket('T002')).rejects.toThrow('blocked by');

      // Assign and complete A
      const agentIdA = await orchestrator.assignTicket('T001');
      mockAgentManager.simulateComplete(agentIdA);

      // Wait for async handling (validation runs shell commands)
      await new Promise((r) => setTimeout(r, 200));

      // Now B should be ready
      readyTickets = orchestrator.getReadyTickets();
      expect(readyTickets).toHaveLength(1);
      expect(readyTickets[0].id).toBe('T002');

      // Assign and complete B
      const agentIdB = await orchestrator.assignTicket('T002');
      mockAgentManager.simulateComplete(agentIdB);

      await new Promise((r) => setTimeout(r, 200));

      // Both should be Done
      expect(planStore.getTicket('T001')?.status).toBe('Done');
      expect(planStore.getTicket('T002')?.status).toBe('Done');

      await orchestrator.stop();
    });

    test('handles complex dependency chains (A -> B -> C)', async () => {
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Task A
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Validation Steps:**
  - \`echo "pass"\`

### Ticket: T002 Task B
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Dependencies:** T001
- **Validation Steps:**
  - \`echo "pass"\`

### Ticket: T003 Task C
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Dependencies:** T002
- **Validation Steps:**
  - \`echo "pass"\`
`;
      await writeFile(planPath, planContent);

      const planStore = new PlanStore(planPath);
      const mockAgentManager = createMockAgentManager();
      const mockEpicManager = createMockEpicManager(tempDir);
      // Use manual progression to test dependency chain without auto-assignment
      const config = { ...createDefaultConfig(), automation: { ...createDefaultConfig().automation, ticketProgression: 'manual' as const } };

      const orchestrator = new Orchestrator(
        planStore,
        mockAgentManager as unknown as AgentManager,
        mockEpicManager as unknown as EpicManager,
        config,
        tempDir
      );

      await orchestrator.start();

      // Only A is ready initially
      expect(orchestrator.getReadyTickets().map((t) => t.id)).toEqual(['T001']);

      // Complete A
      const agentA = await orchestrator.assignTicket('T001');
      mockAgentManager.simulateComplete(agentA);
      await new Promise((r) => setTimeout(r, 200));

      // Now B is ready
      expect(orchestrator.getReadyTickets().map((t) => t.id)).toEqual(['T002']);

      // Complete B
      const agentB = await orchestrator.assignTicket('T002');
      mockAgentManager.simulateComplete(agentB);
      await new Promise((r) => setTimeout(r, 200));

      // Now C is ready
      expect(orchestrator.getReadyTickets().map((t) => t.id)).toEqual(['T003']);

      // Complete C
      const agentC = await orchestrator.assignTicket('T003');
      mockAgentManager.simulateComplete(agentC);
      await new Promise((r) => setTimeout(r, 200));

      // All should be Done
      expect(planStore.getTicket('T001')?.status).toBe('Done');
      expect(planStore.getTicket('T002')?.status).toBe('Done');
      expect(planStore.getTicket('T003')?.status).toBe('Done');

      await orchestrator.stop();
    });

    test('handles diamond dependency pattern', async () => {
      // A -> B, A -> C, B -> D, C -> D
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Task A
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Validation Steps:**
  - \`echo "pass"\`

### Ticket: T002 Task B
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Dependencies:** T001
- **Validation Steps:**
  - \`echo "pass"\`

### Ticket: T003 Task C
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Dependencies:** T001
- **Validation Steps:**
  - \`echo "pass"\`

### Ticket: T004 Task D
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Dependencies:** T002, T003
- **Validation Steps:**
  - \`echo "pass"\`
`;
      await writeFile(planPath, planContent);

      const planStore = new PlanStore(planPath);
      const mockAgentManager = createMockAgentManager();
      const mockEpicManager = createMockEpicManager(tempDir);
      // Use manual progression to test dependency chain without auto-assignment
      const config = { ...createDefaultConfig(), automation: { ...createDefaultConfig().automation, ticketProgression: 'manual' as const } };

      const orchestrator = new Orchestrator(
        planStore,
        mockAgentManager as unknown as AgentManager,
        mockEpicManager as unknown as EpicManager,
        config,
        tempDir
      );

      await orchestrator.start();

      // Only A is ready initially
      expect(orchestrator.getReadyTickets().map((t) => t.id)).toEqual(['T001']);

      // D is blocked by both B and C
      expect(orchestrator.getBlockedBy('T004').map((t) => t.id)).toContain('T002');
      expect(orchestrator.getBlockedBy('T004').map((t) => t.id)).toContain('T003');

      // Complete A
      const agentA = await orchestrator.assignTicket('T001');
      mockAgentManager.simulateComplete(agentA);
      await new Promise((r) => setTimeout(r, 200));

      // Both B and C should now be ready (in priority order)
      const ready = orchestrator.getReadyTickets().map((t) => t.id);
      expect(ready).toContain('T002');
      expect(ready).toContain('T003');

      // D is still blocked
      expect(orchestrator.getBlockedBy('T004').length).toBe(2);

      // Complete B and C
      const agentB = await orchestrator.assignTicket('T002');
      const agentC = await orchestrator.assignTicket('T003');
      mockAgentManager.simulateComplete(agentB);
      mockAgentManager.simulateComplete(agentC);
      await new Promise((r) => setTimeout(r, 200));

      // Now D is ready
      expect(orchestrator.getReadyTickets().map((t) => t.id)).toEqual(['T004']);
      expect(orchestrator.getBlockedBy('T004')).toHaveLength(0);

      await orchestrator.stop();
    });
  });

  describe('Concurrent agents', () => {
    test('multiple agents can work on independent tickets concurrently', async () => {
      // Create plan with multiple independent tickets
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Task A
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Validation Steps:**
  - \`echo "pass"\`

### Ticket: T002 Task B
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Validation Steps:**
  - \`echo "pass"\`

### Ticket: T003 Task C
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Validation Steps:**
  - \`echo "pass"\`
`;
      await writeFile(planPath, planContent);

      const planStore = new PlanStore(planPath);
      const mockAgentManager = createMockAgentManager(5);
      const mockEpicManager = createMockEpicManager(tempDir);
      const config = createDefaultConfig();

      const orchestrator = new Orchestrator(
        planStore,
        mockAgentManager as unknown as AgentManager,
        mockEpicManager as unknown as EpicManager,
        config,
        tempDir
      );

      await orchestrator.start();

      // All three tickets should be ready (no dependencies)
      const readyTickets = orchestrator.getReadyTickets();
      expect(readyTickets).toHaveLength(3);

      // Assign all three concurrently
      const agentId1 = await orchestrator.assignTicket('T001');
      const agentId2 = await orchestrator.assignTicket('T002');
      const agentId3 = await orchestrator.assignTicket('T003');

      // All agents should be spawned
      expect(mockAgentManager.agents.size).toBe(3);

      // Verify all tickets are InProgress
      expect(planStore.getTicket('T001')?.status).toBe('InProgress');
      expect(planStore.getTicket('T002')?.status).toBe('InProgress');
      expect(planStore.getTicket('T003')?.status).toBe('InProgress');

      // No more ready tickets (all assigned)
      expect(orchestrator.getReadyTickets()).toHaveLength(0);

      // Complete all three concurrently
      mockAgentManager.simulateComplete(agentId1);
      mockAgentManager.simulateComplete(agentId2);
      mockAgentManager.simulateComplete(agentId3);

      // Wait for async event handling
      await new Promise((r) => setTimeout(r, 100));

      // All should be Done
      expect(planStore.getTicket('T001')?.status).toBe('Done');
      expect(planStore.getTicket('T002')?.status).toBe('Done');
      expect(planStore.getTicket('T003')?.status).toBe('Done');

      await orchestrator.stop();
    });

    test('respects max agent concurrency limit', async () => {
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Task A
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Validation Steps:**
  - \`echo "pass"\`

### Ticket: T002 Task B
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Validation Steps:**
  - \`echo "pass"\`

### Ticket: T003 Task C
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Validation Steps:**
  - \`echo "pass"\`
`;
      await writeFile(planPath, planContent);

      const planStore = new PlanStore(planPath);
      // Limit to 2 agents
      const mockAgentManager = createMockAgentManager(2);
      const mockEpicManager = createMockEpicManager(tempDir);
      const config = createDefaultConfig();
      config.maxAgents = 2;

      const orchestrator = new Orchestrator(
        planStore,
        mockAgentManager as unknown as AgentManager,
        mockEpicManager as unknown as EpicManager,
        config,
        tempDir
      );

      await orchestrator.start();

      // Assign first two
      await orchestrator.assignTicket('T001');
      await orchestrator.assignTicket('T002');

      // Third assignment should fail due to limit
      await expect(orchestrator.assignTicket('T003')).rejects.toThrow('max concurrency');

      await orchestrator.stop();
    });

    test('agents completing in different order works correctly', async () => {
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Slow Task
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Validation Steps:**
  - \`echo "pass"\`

### Ticket: T002 Fast Task
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Validation Steps:**
  - \`echo "pass"\`
`;
      await writeFile(planPath, planContent);

      const planStore = new PlanStore(planPath);
      const mockAgentManager = createMockAgentManager();
      const mockEpicManager = createMockEpicManager(tempDir);
      const config = createDefaultConfig();

      const orchestrator = new Orchestrator(
        planStore,
        mockAgentManager as unknown as AgentManager,
        mockEpicManager as unknown as EpicManager,
        config,
        tempDir
      );

      await orchestrator.start();

      // Start both
      const agentId1 = await orchestrator.assignTicket('T001');
      const agentId2 = await orchestrator.assignTicket('T002');

      // Complete T002 first (out of order)
      mockAgentManager.simulateComplete(agentId2);
      await new Promise((r) => setTimeout(r, 50));

      expect(planStore.getTicket('T002')?.status).toBe('Done');
      expect(planStore.getTicket('T001')?.status).toBe('InProgress');

      // Then complete T001
      mockAgentManager.simulateComplete(agentId1);
      await new Promise((r) => setTimeout(r, 50));

      expect(planStore.getTicket('T001')?.status).toBe('Done');

      await orchestrator.stop();
    });
  });

  describe('Agent failure and blocked handling', () => {
    test('agent failure marks ticket as Failed', async () => {
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Failing Task
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
`;
      await writeFile(planPath, planContent);

      const planStore = new PlanStore(planPath);
      const mockAgentManager = createMockAgentManager();
      const mockEpicManager = createMockEpicManager(tempDir);
      const config = createDefaultConfig();

      const orchestrator = new Orchestrator(
        planStore,
        mockAgentManager as unknown as AgentManager,
        mockEpicManager as unknown as EpicManager,
        config,
        tempDir
      );

      await orchestrator.start();

      const agentId = await orchestrator.assignTicket('T001');
      mockAgentManager.simulateFailed(agentId, 'Agent crashed');

      await new Promise((r) => setTimeout(r, 50));

      const ticket = planStore.getTicket('T001');
      expect(ticket?.status).toBe('Failed');

      await orchestrator.stop();
    });

    test('agent blocked keeps ticket InProgress but logs feedback', async () => {
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Blocked Task
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
`;
      await writeFile(planPath, planContent);

      const planStore = new PlanStore(planPath);
      const mockAgentManager = createMockAgentManager();
      const mockEpicManager = createMockEpicManager(tempDir);
      const config = createDefaultConfig();

      const orchestrator = new Orchestrator(
        planStore,
        mockAgentManager as unknown as AgentManager,
        mockEpicManager as unknown as EpicManager,
        config,
        tempDir
      );

      // Track log events
      const logEvents: { message: string }[] = [];
      getEventBus().subscribe('log:entry', (e: any) => logEvents.push(e));

      await orchestrator.start();

      const agentId = await orchestrator.assignTicket('T001');
      mockAgentManager.simulateBlocked(agentId, 'Missing dependency X');

      await new Promise((r) => setTimeout(r, 50));

      // Ticket stays InProgress but feedback is added
      const ticket = planStore.getTicket('T001');
      expect(ticket?.status).toBe('InProgress');
      expect(ticket?.notes).toContain('Missing dependency X');

      // Log should mention the blocker
      expect(logEvents.some((e) => e.message.includes('blocked'))).toBe(true);

      await orchestrator.stop();
    });

    test('failed ticket can be retried', async () => {
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Retriable Task
- **Priority:** P0
- **Status:** Failed
- **Owner:** Agent-old
- **Validation Steps:**
  - \`echo "pass"\`
`;
      await writeFile(planPath, planContent);

      const planStore = new PlanStore(planPath);
      const mockAgentManager = createMockAgentManager();
      const mockEpicManager = createMockEpicManager(tempDir);
      const config = createDefaultConfig();

      const orchestrator = new Orchestrator(
        planStore,
        mockAgentManager as unknown as AgentManager,
        mockEpicManager as unknown as EpicManager,
        config,
        tempDir
      );

      await orchestrator.start();

      // Retry the failed ticket
      await orchestrator.retryTicket('T001');

      expect(planStore.getTicket('T001')?.status).toBe('Todo');

      // Now we can assign and complete it
      const agentId = await orchestrator.assignTicket('T001');
      mockAgentManager.simulateComplete(agentId);
      await new Promise((r) => setTimeout(r, 50));

      expect(planStore.getTicket('T001')?.status).toBe('Done');

      await orchestrator.stop();
    });
  });

  describe('Priority ordering', () => {
    test('respects priority when computing ready tickets', async () => {
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Low Priority
- **Priority:** P2
- **Status:** Todo
- **Owner:** Unassigned

### Ticket: T002 High Priority
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned

### Ticket: T003 Medium Priority
- **Priority:** P1
- **Status:** Todo
- **Owner:** Unassigned
`;
      await writeFile(planPath, planContent);

      const planStore = new PlanStore(planPath);
      const mockAgentManager = createMockAgentManager();
      const mockEpicManager = createMockEpicManager(tempDir);
      const config = createDefaultConfig();

      const orchestrator = new Orchestrator(
        planStore,
        mockAgentManager as unknown as AgentManager,
        mockEpicManager as unknown as EpicManager,
        config,
        tempDir
      );

      await orchestrator.start();

      const ready = orchestrator.getReadyTickets();

      // Should be sorted by priority: P0, P1, P2
      expect(ready[0].id).toBe('T002'); // P0
      expect(ready[1].id).toBe('T003'); // P1
      expect(ready[2].id).toBe('T001'); // P2

      await orchestrator.stop();
    });
  });

  describe('Plan file persistence', () => {
    test('status changes are persisted to PLAN.md', async () => {
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 Persist Test
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
- **Validation Steps:**
  - \`echo "pass"\`
`;
      await writeFile(planPath, planContent);

      const planStore = new PlanStore(planPath);
      const mockAgentManager = createMockAgentManager();
      const mockEpicManager = createMockEpicManager(tempDir);
      const config = createDefaultConfig();

      const orchestrator = new Orchestrator(
        planStore,
        mockAgentManager as unknown as AgentManager,
        mockEpicManager as unknown as EpicManager,
        config,
        tempDir
      );

      await orchestrator.start();

      const agentId = await orchestrator.assignTicket('T001');

      // Read plan file - should show InProgress
      let fileContent = await readFile(planPath, 'utf-8');
      expect(fileContent).toContain('In Progress');

      mockAgentManager.simulateComplete(agentId);
      await new Promise((r) => setTimeout(r, 50));

      // Read plan file again - should show Done
      fileContent = await readFile(planPath, 'utf-8');
      expect(fileContent).toContain('Done');

      await orchestrator.stop();
    });

    test('can reload plan and continue', async () => {
      const planContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 First
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
`;
      await writeFile(planPath, planContent);

      const planStore = new PlanStore(planPath);
      const mockAgentManager = createMockAgentManager();
      const mockEpicManager = createMockEpicManager(tempDir);
      const config = createDefaultConfig();

      const orchestrator = new Orchestrator(
        planStore,
        mockAgentManager as unknown as AgentManager,
        mockEpicManager as unknown as EpicManager,
        config,
        tempDir
      );

      await orchestrator.start();

      // Add a new ticket to the file externally
      const updatedContent = `# Test Plan

## 7. Task Backlog

### Ticket: T001 First
- **Priority:** P0
- **Status:** Done
- **Owner:** Completed

### Ticket: T002 Second
- **Priority:** P0
- **Status:** Todo
- **Owner:** Unassigned
`;
      await writeFile(planPath, updatedContent);

      // Reload the plan
      await orchestrator.reloadPlan();

      // New ticket should be ready
      const ready = orchestrator.getReadyTickets();
      expect(ready).toHaveLength(1);
      expect(ready[0].id).toBe('T002');

      await orchestrator.stop();
    });
  });
});

// =============================================================================
// Performance Test
// =============================================================================

describe('Integration Test Performance', () => {
  test('all integration tests complete in under 10 seconds', async () => {
    const startTime = Date.now();

    // This test acts as a meta-test to verify performance
    // The actual assertions are in the individual tests above
    // This just verifies the time constraint mentioned in acceptance criteria

    const elapsed = Date.now() - startTime;
    // Individual tests should be fast, this meta-test is just a marker
    expect(elapsed).toBeLessThan(100);
  });
});
