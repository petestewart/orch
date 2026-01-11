/**
 * Store Tests
 *
 * Tests for the event-driven state store (T010)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Store } from './store';
import { EventBus } from '../core/events';
import type {
  Ticket as CoreTicket,
  Epic as CoreEpic,
  PlanLoadedEvent,
  TicketStatusChangedEvent,
  AgentSpawnedEvent,
  AgentProgressEvent,
  AgentCompletedEvent,
  AgentFailedEvent,
  AgentBlockedEvent,
  AgentStoppedEvent,
  LogEntryEvent,
} from '../core/types';

describe('Store', () => {
  let eventBus: EventBus;
  let store: Store;

  beforeEach(() => {
    eventBus = new EventBus();
    store = new Store(eventBus);
  });

  afterEach(() => {
    store.destroy();
    eventBus.clear();
  });

  describe('initialization', () => {
    test('should initialize with empty state', () => {
      const state = store.getState();
      expect(state.epics).toEqual([]);
      expect(state.tickets).toEqual([]);
      expect(state.agents).toEqual([]);
      expect(state.logs).toEqual([]);
      expect(state.currentView).toBe('kanban');
    });

    test('should provide getState() for UI reads', () => {
      const state = store.getState();
      expect(state).toBeDefined();
      expect(typeof state).toBe('object');
    });
  });

  describe('plan:loaded event', () => {
    const mockCoreTickets: CoreTicket[] = [
      {
        id: 'T001',
        title: 'Setup project',
        priority: 'P0',
        status: 'Done',
        dependencies: [],
        acceptanceCriteria: ['Project initialized'],
        validationSteps: ['bun test'],
      },
      {
        id: 'T002',
        title: 'Add feature',
        priority: 'P1',
        status: 'Todo',
        dependencies: ['T001'],
        acceptanceCriteria: ['Feature works'],
        validationSteps: [],
        epic: 'core',
      },
      {
        id: 'T003',
        title: 'In progress task',
        priority: 'P2',
        status: 'InProgress',
        dependencies: [],
        acceptanceCriteria: [],
        validationSteps: [],
        epic: 'core',
        owner: 'agent-1',
      },
    ];

    const mockCoreEpics: CoreEpic[] = [
      { name: 'core', path: 'src/core', description: 'Core functionality' },
    ];

    test('should populate tickets from plan:loaded event', () => {
      const event: PlanLoadedEvent = {
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: mockCoreTickets,
        epics: mockCoreEpics,
      };

      eventBus.publish(event);

      const state = store.getState();
      expect(state.tickets.length).toBe(3);
    });

    test('should map core ticket status to UI status', () => {
      const event: PlanLoadedEvent = {
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: mockCoreTickets,
        epics: mockCoreEpics,
      };

      eventBus.publish(event);

      const state = store.getState();
      const ticket1 = state.tickets.find(t => t.id === 't001');
      const ticket2 = state.tickets.find(t => t.id === 't002');
      const ticket3 = state.tickets.find(t => t.id === 't003');

      expect(ticket1?.status).toBe('done');
      expect(ticket2?.status).toBe('backlog');
      expect(ticket3?.status).toBe('in_progress');
    });

    test('should map core priority to UI priority', () => {
      const event: PlanLoadedEvent = {
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: mockCoreTickets,
        epics: mockCoreEpics,
      };

      eventBus.publish(event);

      const state = store.getState();
      const ticket1 = state.tickets.find(t => t.id === 't001');
      const ticket2 = state.tickets.find(t => t.id === 't002');

      // P0 maps to P1
      expect(ticket1?.priority).toBe('P1');
      expect(ticket2?.priority).toBe('P1');
    });

    test('should populate epics from plan:loaded event', () => {
      const event: PlanLoadedEvent = {
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: mockCoreTickets,
        epics: mockCoreEpics,
      };

      eventBus.publish(event);

      const state = store.getState();
      expect(state.epics.length).toBe(1);
      expect(state.epics[0].name).toBe('core');
    });

    test('should compute blocks relationships', () => {
      const event: PlanLoadedEvent = {
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: mockCoreTickets,
        epics: mockCoreEpics,
      };

      eventBus.publish(event);

      const state = store.getState();
      const ticket1 = state.tickets.find(t => t.id === 't001');
      const ticket2 = state.tickets.find(t => t.id === 't002');

      // T001 should block T002
      expect(ticket1?.blocks).toContain('t002');
      // T002 should be blocked by T001
      expect(ticket2?.blockedBy).toContain('t001');
    });

    test('should select all epics by default', () => {
      const event: PlanLoadedEvent = {
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: mockCoreTickets,
        epics: mockCoreEpics,
      };

      eventBus.publish(event);

      const state = store.getState();
      expect(state.selectedEpicIds.length).toBe(1);
    });

    test('should add log entry for plan loaded', () => {
      const event: PlanLoadedEvent = {
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: mockCoreTickets,
        epics: mockCoreEpics,
      };

      eventBus.publish(event);

      const state = store.getState();
      expect(state.logs.length).toBeGreaterThan(0);
      expect(state.logs[0].message).toContain('Plan loaded');
    });
  });

  describe('ticket:status-changed event', () => {
    beforeEach(() => {
      // Load initial plan
      const event: PlanLoadedEvent = {
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: [
          {
            id: 'T001',
            title: 'Test ticket',
            priority: 'P1',
            status: 'Todo',
            dependencies: [],
            acceptanceCriteria: [],
            validationSteps: [],
          },
        ],
        epics: [],
      };
      eventBus.publish(event);
    });

    test('should update ticket status', () => {
      const event: TicketStatusChangedEvent = {
        type: 'ticket:status-changed',
        timestamp: new Date(),
        ticketId: 'T001',
        previousStatus: 'Todo',
        newStatus: 'InProgress',
      };

      eventBus.publish(event);

      const ticket = store.getTicketById('t001');
      expect(ticket?.status).toBe('in_progress');
    });

    test('should update progress when status changes to Done', () => {
      const event: TicketStatusChangedEvent = {
        type: 'ticket:status-changed',
        timestamp: new Date(),
        ticketId: 'T001',
        previousStatus: 'Todo',
        newStatus: 'Done',
      };

      eventBus.publish(event);

      const ticket = store.getTicketById('t001');
      expect(ticket?.progress).toBe(100);
    });

    test('should add log entry for status change', () => {
      const initialLogCount = store.getState().logs.length;

      const event: TicketStatusChangedEvent = {
        type: 'ticket:status-changed',
        timestamp: new Date(),
        ticketId: 'T001',
        previousStatus: 'Todo',
        newStatus: 'InProgress',
      };

      eventBus.publish(event);

      expect(store.getState().logs.length).toBeGreaterThan(initialLogCount);
    });
  });

  describe('agent:spawned event', () => {
    beforeEach(() => {
      const event: PlanLoadedEvent = {
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: [
          {
            id: 'T001',
            title: 'Test ticket',
            priority: 'P1',
            status: 'Todo',
            dependencies: [],
            acceptanceCriteria: [],
            validationSteps: [],
          },
        ],
        epics: [],
      };
      eventBus.publish(event);
    });

    test('should add new agent to state', () => {
      const event: AgentSpawnedEvent = {
        type: 'agent:spawned',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
      };

      eventBus.publish(event);

      const state = store.getState();
      expect(state.agents.length).toBe(1);
      expect(state.agents[0].id).toBe('agent-1');
    });

    test('should update ticket assignee', () => {
      const event: AgentSpawnedEvent = {
        type: 'agent:spawned',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
      };

      eventBus.publish(event);

      const ticket = store.getTicketById('t001');
      expect(ticket?.assignee).toBe('agent-1');
    });

    test('should set agent status to working', () => {
      const event: AgentSpawnedEvent = {
        type: 'agent:spawned',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
      };

      eventBus.publish(event);

      const agent = store.getAgentById('agent-1');
      expect(agent?.status).toBe('working');
    });
  });

  describe('agent:progress event', () => {
    beforeEach(() => {
      // Setup: load plan and spawn agent
      eventBus.publish({
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: [
          {
            id: 'T001',
            title: 'Test ticket',
            priority: 'P1',
            status: 'InProgress',
            dependencies: [],
            acceptanceCriteria: [],
            validationSteps: [],
          },
        ],
        epics: [],
      } as PlanLoadedEvent);

      eventBus.publish({
        type: 'agent:spawned',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
      } as AgentSpawnedEvent);
    });

    test('should update agent progress', () => {
      const event: AgentProgressEvent = {
        type: 'agent:progress',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
        progress: 50,
        lastAction: 'Reading files',
        tokensUsed: 1000,
        inputTokens: 800,
        outputTokens: 200,
        cost: 0.0054,
      };

      eventBus.publish(event);

      const agent = store.getAgentById('agent-1');
      expect(agent?.progress).toBe(50);
    });

    test('should update agent lastAction', () => {
      const event: AgentProgressEvent = {
        type: 'agent:progress',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
        progress: 50,
        lastAction: 'Writing tests',
        tokensUsed: 1000,
        inputTokens: 800,
        outputTokens: 200,
        cost: 0.0054,
      };

      eventBus.publish(event);

      const agent = store.getAgentById('agent-1');
      expect(agent?.lastAction).toBe('Writing tests');
    });

    test('should update ticket progress', () => {
      const event: AgentProgressEvent = {
        type: 'agent:progress',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
        progress: 75,
        lastAction: 'Running tests',
        tokensUsed: 2000,
        inputTokens: 1600,
        outputTokens: 400,
        cost: 0.0108,
      };

      eventBus.publish(event);

      const ticket = store.getTicketById('t001');
      expect(ticket?.progress).toBe(75);
    });
  });

  describe('agent:completed event', () => {
    beforeEach(() => {
      eventBus.publish({
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: [{ id: 'T001', title: 'Test', priority: 'P1', status: 'InProgress', dependencies: [], acceptanceCriteria: [], validationSteps: [] }],
        epics: [],
      } as PlanLoadedEvent);

      eventBus.publish({
        type: 'agent:spawned',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
      } as AgentSpawnedEvent);
    });

    test('should set agent status to idle after completion', () => {
      const event: AgentCompletedEvent = {
        type: 'agent:completed',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
      };

      eventBus.publish(event);

      const agent = store.getAgentById('agent-1');
      expect(agent?.status).toBe('idle');
      expect(agent?.progress).toBe(100);
    });
  });

  describe('agent:failed event', () => {
    beforeEach(() => {
      eventBus.publish({
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: [{ id: 'T001', title: 'Test', priority: 'P1', status: 'InProgress', dependencies: [], acceptanceCriteria: [], validationSteps: [] }],
        epics: [],
      } as PlanLoadedEvent);

      eventBus.publish({
        type: 'agent:spawned',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
      } as AgentSpawnedEvent);
    });

    test('should set agent status to idle after failure', () => {
      const event: AgentFailedEvent = {
        type: 'agent:failed',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
        error: 'Test error',
      };

      eventBus.publish(event);

      const agent = store.getAgentById('agent-1');
      expect(agent?.status).toBe('idle');
    });

    test('should add error log entry', () => {
      const initialLogCount = store.getState().logs.length;

      const event: AgentFailedEvent = {
        type: 'agent:failed',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
        error: 'Test error',
      };

      eventBus.publish(event);

      const logs = store.getState().logs;
      const errorLog = logs.find(l => l.level === 'ERROR');
      expect(errorLog).toBeDefined();
      expect(errorLog?.message).toContain('failed');
    });
  });

  describe('agent:blocked event', () => {
    beforeEach(() => {
      eventBus.publish({
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: [{ id: 'T001', title: 'Test', priority: 'P1', status: 'InProgress', dependencies: [], acceptanceCriteria: [], validationSteps: [] }],
        epics: [],
      } as PlanLoadedEvent);

      eventBus.publish({
        type: 'agent:spawned',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
      } as AgentSpawnedEvent);
    });

    test('should set agent status to waiting when blocked', () => {
      const event: AgentBlockedEvent = {
        type: 'agent:blocked',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
        reason: 'Missing dependency',
      };

      eventBus.publish(event);

      const agent = store.getAgentById('agent-1');
      expect(agent?.status).toBe('waiting');
    });
  });

  describe('log:entry event', () => {
    test('should add log entry to state', () => {
      const event: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'Test log message',
        agentId: 'agent-1',
        ticketId: 'T001',
      };

      eventBus.publish(event);

      const logs = store.getState().logs;
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].message).toBe('Test log message');
    });

    test('should map log levels correctly', () => {
      const levels: Array<{ core: LogEntryEvent['level']; expected: 'INFO' | 'WARN' | 'ERROR' | 'EVENT' }> = [
        { core: 'debug', expected: 'INFO' },
        { core: 'info', expected: 'INFO' },
        { core: 'warn', expected: 'WARN' },
        { core: 'error', expected: 'ERROR' },
        { core: 'event', expected: 'EVENT' },
      ];

      for (const { core, expected } of levels) {
        eventBus.publish({
          type: 'log:entry',
          timestamp: new Date(),
          level: core,
          message: `Test ${core}`,
        } as LogEntryEvent);

        const logs = store.getState().logs;
        expect(logs[0].level).toBe(expected);
      }
    });

    test('should limit log size to 100 entries', () => {
      // Add 110 log entries
      for (let i = 0; i < 110; i++) {
        eventBus.publish({
          type: 'log:entry',
          timestamp: new Date(),
          level: 'info',
          message: `Log entry ${i}`,
        } as LogEntryEvent);
      }

      const logs = store.getState().logs;
      expect(logs.length).toBeLessThanOrEqual(100);
    });
  });

  describe('onChange callback', () => {
    test('should call onChange when state changes', () => {
      let callCount = 0;
      store.onChange(() => {
        callCount++;
      });

      eventBus.publish({
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: [],
        epics: [],
      } as PlanLoadedEvent);

      expect(callCount).toBeGreaterThan(0);
    });

    test('should return unsubscribe function', () => {
      let callCount = 0;
      const unsubscribe = store.onChange(() => {
        callCount++;
      });

      eventBus.publish({
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: [],
        epics: [],
      } as PlanLoadedEvent);

      const countAfterFirst = callCount;

      unsubscribe();

      eventBus.publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'Test',
      } as LogEntryEvent);

      // Should not have increased after unsubscribe
      expect(callCount).toBe(countAfterFirst);
    });
  });

  describe('UI state setters', () => {
    test('setCurrentView should update view and notify', () => {
      let notified = false;
      store.onChange(() => {
        notified = true;
      });

      store.setCurrentView('agents');

      expect(store.getState().currentView).toBe('agents');
      expect(notified).toBe(true);
    });

    test('setSelectedTicket should update selectedTicketId', () => {
      store.setSelectedTicket('t001');
      expect(store.getState().selectedTicketId).toBe('t001');
    });

    test('setViewingTicketId should update viewingTicketId', () => {
      store.setViewingTicketId('t001');
      expect(store.getState().viewingTicketId).toBe('t001');
    });

    test('setTicketViewTab should update ticketViewTab', () => {
      store.setTicketViewTab('session');
      expect(store.getState().ticketViewTab).toBe('session');
    });
  });

  describe('getTicketsByStatus', () => {
    beforeEach(() => {
      eventBus.publish({
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: [
          { id: 'T001', title: 'Done 1', priority: 'P1', status: 'Done', dependencies: [], acceptanceCriteria: [], validationSteps: [], epic: 'core' },
          { id: 'T002', title: 'Todo 1', priority: 'P1', status: 'Todo', dependencies: [], acceptanceCriteria: [], validationSteps: [], epic: 'core' },
          { id: 'T003', title: 'Todo 2', priority: 'P1', status: 'Todo', dependencies: [], acceptanceCriteria: [], validationSteps: [], epic: 'other' },
        ],
        epics: [
          { name: 'core', path: 'src/core' },
          { name: 'other', path: 'src/other' },
        ],
      } as PlanLoadedEvent);
    });

    test('should filter tickets by status', () => {
      const todoTickets = store.getTicketsByStatus('backlog');
      expect(todoTickets.length).toBe(2);
    });

    test('should filter by selected epics', () => {
      // Deselect 'other' epic
      const state = store.getState();
      state.selectedEpicIds = ['core'];

      const todoTickets = store.getTicketsByStatus('backlog');
      expect(todoTickets.length).toBe(1);
      expect(todoTickets[0].id).toBe('t002');
    });
  });

  describe('destroy', () => {
    test('should unsubscribe from all events', () => {
      store.destroy();

      let callCount = 0;
      store.onChange(() => {
        callCount++;
      });

      eventBus.publish({
        type: 'plan:loaded',
        timestamp: new Date(),
        tickets: [],
        epics: [],
      } as PlanLoadedEvent);

      // onChange callback was added after destroy, but events shouldn't trigger
      // since internal subscriptions were cleared
      // The new callback should still work if added after destroy
      expect(callCount).toBe(0);
    });
  });
});
