/**
 * Unit tests for EventBus
 * Implements: T001 validation
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { EventBus, getEventBus, resetEventBus } from './events';
import type { OrchEvent, LogEntryEvent, AgentProgressEvent } from './types';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('subscribe', () => {
    test('returns an unsubscribe function', () => {
      const handler = () => {};
      const unsubscribe = bus.subscribe('log:entry', handler);
      expect(typeof unsubscribe).toBe('function');
    });

    test('handler receives published events of subscribed type', () => {
      const received: OrchEvent[] = [];
      bus.subscribe('log:entry', (event) => {
        received.push(event);
      });

      const event: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'test message',
      };
      bus.publish(event);

      expect(received.length).toBe(1);
      expect(received[0]).toBe(event);
    });

    test('handler does not receive events of different types', () => {
      const received: OrchEvent[] = [];
      bus.subscribe('log:entry', (event) => {
        received.push(event);
      });

      const event: AgentProgressEvent = {
        type: 'agent:progress',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
        progress: 50,
        lastAction: 'Reading files',
        tokensUsed: 1000,
      };
      bus.publish(event);

      expect(received.length).toBe(0);
    });
  });

  describe('unsubscribe', () => {
    test('handler stops receiving events after unsubscribe', () => {
      const received: OrchEvent[] = [];
      const unsubscribe = bus.subscribe('log:entry', (event) => {
        received.push(event);
      });

      const event1: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'first',
      };
      bus.publish(event1);
      expect(received.length).toBe(1);

      // Unsubscribe
      unsubscribe();

      const event2: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'second',
      };
      bus.publish(event2);

      // Should still be 1 - didn't receive second event
      expect(received.length).toBe(1);
    });

    test('unsubscribing one handler does not affect others', () => {
      const received1: OrchEvent[] = [];
      const received2: OrchEvent[] = [];

      const unsub1 = bus.subscribe('log:entry', (event) => {
        received1.push(event);
      });
      bus.subscribe('log:entry', (event) => {
        received2.push(event);
      });

      // First event - both receive
      const event1: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'first',
      };
      bus.publish(event1);
      expect(received1.length).toBe(1);
      expect(received2.length).toBe(1);

      // Unsubscribe first handler
      unsub1();

      // Second event - only second handler receives
      const event2: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'second',
      };
      bus.publish(event2);
      expect(received1.length).toBe(1);
      expect(received2.length).toBe(2);
    });
  });

  describe('publish', () => {
    test('calls handlers synchronously in subscription order', () => {
      const callOrder: number[] = [];

      bus.subscribe('log:entry', () => {
        callOrder.push(1);
      });
      bus.subscribe('log:entry', () => {
        callOrder.push(2);
      });
      bus.subscribe('log:entry', () => {
        callOrder.push(3);
      });

      const event: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'test',
      };
      bus.publish(event);

      expect(callOrder).toEqual([1, 2, 3]);
    });

    test('multiple handlers receive the same event', () => {
      let count = 0;
      bus.subscribe('log:entry', () => count++);
      bus.subscribe('log:entry', () => count++);

      const event: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'test',
      };
      bus.publish(event);

      expect(count).toBe(2);
    });
  });

  describe('subscribeAll', () => {
    test('receives events of all types', () => {
      const received: OrchEvent[] = [];
      bus.subscribeAll((event) => {
        received.push(event);
      });

      const logEvent: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'log test',
      };
      bus.publish(logEvent);

      const progressEvent: AgentProgressEvent = {
        type: 'agent:progress',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
        progress: 50,
        lastAction: 'Working',
        tokensUsed: 500,
      };
      bus.publish(progressEvent);

      expect(received.length).toBe(2);
      expect(received[0].type).toBe('log:entry');
      expect(received[1].type).toBe('agent:progress');
    });

    test('returns unsubscribe function that works', () => {
      const received: OrchEvent[] = [];
      const unsub = bus.subscribeAll((event) => {
        received.push(event);
      });

      const event1: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'first',
      };
      bus.publish(event1);
      expect(received.length).toBe(1);

      unsub();

      const event2: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'second',
      };
      bus.publish(event2);
      expect(received.length).toBe(1);
    });
  });

  describe('getHistory', () => {
    test('returns all published events', () => {
      const event1: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'first',
      };
      const event2: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'second',
      };
      bus.publish(event1);
      bus.publish(event2);

      const history = bus.getHistory();
      expect(history.length).toBe(2);
      expect(history[0]).toBe(event1);
      expect(history[1]).toBe(event2);
    });

    test('filters by event type when specified', () => {
      const logEvent: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'log',
      };
      const progressEvent: AgentProgressEvent = {
        type: 'agent:progress',
        timestamp: new Date(),
        agentId: 'agent-1',
        ticketId: 'T001',
        progress: 50,
        lastAction: 'Working',
        tokensUsed: 500,
      };
      bus.publish(logEvent);
      bus.publish(progressEvent);

      const logHistory = bus.getHistory('log:entry');
      expect(logHistory.length).toBe(1);
      expect(logHistory[0].type).toBe('log:entry');

      const progressHistory = bus.getHistory('agent:progress');
      expect(progressHistory.length).toBe(1);
      expect(progressHistory[0].type).toBe('agent:progress');
    });

    test('returns empty array when no events match filter', () => {
      const logEvent: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'log',
      };
      bus.publish(logEvent);

      const history = bus.getHistory('agent:progress');
      expect(history.length).toBe(0);
    });

    test('returns copy of history (not mutable reference)', () => {
      const event: LogEntryEvent = {
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'test',
      };
      bus.publish(event);

      const history = bus.getHistory();
      history.push(event); // mutate the returned array

      // Original history should be unaffected
      expect(bus.getHistory().length).toBe(1);
    });
  });

  describe('event history limits', () => {
    test('respects maxHistory limit', () => {
      const smallBus = new EventBus(3);

      for (let i = 0; i < 5; i++) {
        smallBus.publish({
          type: 'log:entry',
          timestamp: new Date(),
          level: 'info',
          message: `event-${i}`,
        } as LogEntryEvent);
      }

      const history = smallBus.getHistory();
      expect(history.length).toBe(3);
      // Should have kept the last 3 events
      expect((history[0] as LogEntryEvent).message).toBe('event-2');
      expect((history[1] as LogEntryEvent).message).toBe('event-3');
      expect((history[2] as LogEntryEvent).message).toBe('event-4');
    });

    test('defaults to 1000 events max', () => {
      const defaultBus = new EventBus();

      for (let i = 0; i < 1005; i++) {
        defaultBus.publish({
          type: 'log:entry',
          timestamp: new Date(),
          level: 'info',
          message: `event-${i}`,
        } as LogEntryEvent);
      }

      expect(defaultBus.getHistory().length).toBe(1000);
    });
  });

  describe('clear', () => {
    test('clears all handlers and history', () => {
      const received: OrchEvent[] = [];
      bus.subscribe('log:entry', (event) => received.push(event));
      bus.subscribeAll((event) => received.push(event));

      bus.publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'before clear',
      } as LogEntryEvent);

      bus.clear();

      // History should be empty
      expect(bus.getHistory().length).toBe(0);

      // Handlers should be removed
      bus.publish({
        type: 'log:entry',
        timestamp: new Date(),
        level: 'info',
        message: 'after clear',
      } as LogEntryEvent);

      // Only 2 events from before clear (1 from subscribe + 1 from subscribeAll)
      expect(received.length).toBe(2);
    });
  });

  describe('singleton', () => {
    beforeEach(() => {
      resetEventBus();
    });

    test('getEventBus returns same instance', () => {
      const bus1 = getEventBus();
      const bus2 = getEventBus();
      expect(bus1).toBe(bus2);
    });

    test('resetEventBus creates new instance on next getEventBus', () => {
      const bus1 = getEventBus();
      resetEventBus();
      const bus2 = getEventBus();
      expect(bus1).not.toBe(bus2);
    });
  });
});
