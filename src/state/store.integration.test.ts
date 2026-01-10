/**
 * Store Integration Tests
 *
 * Tests the full event -> state change -> UI update flow (T010)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Store } from './store';
import { EventBus } from '../core/events';
import type {
  PlanLoadedEvent,
  AgentSpawnedEvent,
  AgentProgressEvent,
  TicketStatusChangedEvent,
} from '../core/types';
import type { AppState } from './types';

describe('Store Integration', () => {
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

  test('integration: event -> state change -> UI update callback', () => {
    // This test verifies the complete flow:
    // 1. Event is published to EventBus
    // 2. Store receives event and updates state
    // 3. onChange callback is triggered (simulating UI re-render)

    let uiUpdateCount = 0;
    let lastState: AppState | null = null;

    // Register onChange callback (simulates UI component)
    store.onChange((state) => {
      uiUpdateCount++;
      lastState = state;
    });

    // Initial state should have no tickets
    expect(store.getState().tickets.length).toBe(0);

    // Step 1: Publish plan:loaded event
    const planLoadedEvent: PlanLoadedEvent = {
      type: 'plan:loaded',
      timestamp: new Date(),
      tickets: [
        {
          id: 'T001',
          title: 'First ticket',
          priority: 'P0',
          status: 'Todo',
          dependencies: [],
          acceptanceCriteria: ['Works correctly'],
          validationSteps: ['bun test'],
        },
        {
          id: 'T002',
          title: 'Second ticket',
          priority: 'P1',
          status: 'Todo',
          dependencies: ['T001'],
          acceptanceCriteria: ['Also works'],
          validationSteps: [],
          epic: 'core',
        },
      ],
      epics: [{ name: 'core', path: 'src/core' }],
    };

    eventBus.publish(planLoadedEvent);

    // Verify: State changed
    expect(store.getState().tickets.length).toBe(2);
    expect(store.getState().epics.length).toBe(1);

    // Verify: UI callback was triggered
    expect(uiUpdateCount).toBeGreaterThan(0);
    expect(lastState).not.toBeNull();
    expect(lastState!.tickets.length).toBe(2);

    // Step 2: Publish agent:spawned event
    const uiUpdateCountBefore = uiUpdateCount;
    const agentSpawnedEvent: AgentSpawnedEvent = {
      type: 'agent:spawned',
      timestamp: new Date(),
      agentId: 'agent-1',
      ticketId: 'T001',
    };

    eventBus.publish(agentSpawnedEvent);

    // Verify: Agent added to state
    expect(store.getState().agents.length).toBe(1);
    expect(store.getAgentById('agent-1')).toBeDefined();

    // Verify: Ticket assignee updated
    const ticket = store.getTicketById('t001');
    expect(ticket?.assignee).toBe('agent-1');

    // Verify: UI callback was triggered again
    expect(uiUpdateCount).toBeGreaterThan(uiUpdateCountBefore);

    // Step 3: Publish agent:progress event
    const progressBefore = uiUpdateCount;
    const progressEvent: AgentProgressEvent = {
      type: 'agent:progress',
      timestamp: new Date(),
      agentId: 'agent-1',
      ticketId: 'T001',
      progress: 75,
      lastAction: 'Running tests',
      tokensUsed: 5000,
    };

    eventBus.publish(progressEvent);

    // Verify: Agent progress updated
    expect(store.getAgentById('agent-1')?.progress).toBe(75);
    expect(store.getAgentById('agent-1')?.lastAction).toBe('Running tests');

    // Verify: Ticket progress updated
    expect(store.getTicketById('t001')?.progress).toBe(75);

    // Verify: UI callback was triggered
    expect(uiUpdateCount).toBeGreaterThan(progressBefore);

    // Step 4: Publish ticket:status-changed event
    const statusBefore = uiUpdateCount;
    const statusEvent: TicketStatusChangedEvent = {
      type: 'ticket:status-changed',
      timestamp: new Date(),
      ticketId: 'T001',
      previousStatus: 'Todo',
      newStatus: 'Review',
    };

    eventBus.publish(statusEvent);

    // Verify: Ticket status changed
    expect(store.getTicketById('t001')?.status).toBe('review');

    // Verify: UI callback was triggered
    expect(uiUpdateCount).toBeGreaterThan(statusBefore);

    // Final verification: logs accumulated
    expect(store.getState().logs.length).toBeGreaterThan(0);
  });

  test('integration: multiple rapid events are all processed', () => {
    let updateCount = 0;
    store.onChange(() => updateCount++);

    // Publish multiple events rapidly
    eventBus.publish({
      type: 'plan:loaded',
      timestamp: new Date(),
      tickets: [
        { id: 'T001', title: 'Task 1', priority: 'P1', status: 'Todo', dependencies: [], acceptanceCriteria: [], validationSteps: [] },
      ],
      epics: [],
    } as PlanLoadedEvent);

    eventBus.publish({
      type: 'agent:spawned',
      timestamp: new Date(),
      agentId: 'agent-1',
      ticketId: 'T001',
    } as AgentSpawnedEvent);

    for (let i = 10; i <= 100; i += 10) {
      eventBus.publish({
        type: 'agent:progress',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
        progress: i,
        lastAction: `Progress ${i}%`,
        tokensUsed: i * 100,
      } as AgentProgressEvent);
    }

    // All events should be processed
    expect(store.getAgentById('agent-1')?.progress).toBe(100);
    // Multiple UI updates should have occurred
    expect(updateCount).toBeGreaterThan(10);
  });

  test('integration: unsubscribe stops UI updates', () => {
    let updateCount = 0;
    const unsubscribe = store.onChange(() => updateCount++);

    // Initial event
    eventBus.publish({
      type: 'plan:loaded',
      timestamp: new Date(),
      tickets: [],
      epics: [],
    } as PlanLoadedEvent);

    const countAfterFirst = updateCount;
    expect(countAfterFirst).toBeGreaterThan(0);

    // Unsubscribe
    unsubscribe();

    // More events
    for (let i = 0; i < 5; i++) {
      eventBus.publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: `Log ${i}`,
      });
    }

    // Count should not have increased after unsubscribe
    expect(updateCount).toBe(countAfterFirst);
  });
});
