/**
 * Central Event Bus
 *
 * All components communicate through this event bus.
 * Implements: T001
 *
 * Usage:
 *   const bus = new EventBus();
 *   const unsub = bus.subscribe('agent:progress', (event) => { ... });
 *   bus.publish({ type: 'agent:progress', ... });
 *   unsub(); // Unsubscribe
 */

import type { OrchEvent, EventType } from './types';

type EventHandler<T extends OrchEvent = OrchEvent> = (event: T) => void;

export class EventBus {
  private handlers: Map<EventType, Set<EventHandler>>;
  private history: OrchEvent[];
  private maxHistory: number;

  constructor(maxHistory = 1000) {
    this.handlers = new Map();
    this.history = [];
    this.maxHistory = maxHistory;
  }

  /**
   * Subscribe to an event type
   * @returns Unsubscribe function
   */
  subscribe<T extends OrchEvent>(
    type: EventType,
    handler: EventHandler<T>
  ): () => void {
    // TODO: Implement - T001
    throw new Error('Not implemented');
  }

  /**
   * Subscribe to all events
   * @returns Unsubscribe function
   */
  subscribeAll(handler: EventHandler): () => void {
    // TODO: Implement - T001
    throw new Error('Not implemented');
  }

  /**
   * Publish an event to all subscribers
   * Handlers are called synchronously in subscription order
   */
  publish(event: OrchEvent): void {
    // TODO: Implement - T001
    throw new Error('Not implemented');
  }

  /**
   * Get event history
   * @param filter Optional event type filter
   */
  getHistory(filter?: EventType): OrchEvent[] {
    // TODO: Implement - T001
    throw new Error('Not implemented');
  }

  /**
   * Clear all handlers and history
   */
  clear(): void {
    this.handlers.clear();
    this.history = [];
  }
}

// Singleton instance
let instance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!instance) {
    instance = new EventBus();
  }
  return instance;
}

export function resetEventBus(): void {
  instance = null;
}
