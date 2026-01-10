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
  private allHandlers: Set<EventHandler>;
  private history: OrchEvent[];
  private maxHistory: number;

  constructor(maxHistory = 1000) {
    this.handlers = new Map();
    this.allHandlers = new Set();
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
    // Get or create the handler set for this event type
    let handlers = this.handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(type, handlers);
    }

    // Add the handler (cast to generic EventHandler for storage)
    const genericHandler = handler as EventHandler;
    handlers.add(genericHandler);

    // Return unsubscribe function
    return () => {
      const currentHandlers = this.handlers.get(type);
      if (currentHandlers) {
        currentHandlers.delete(genericHandler);
        // Clean up empty sets
        if (currentHandlers.size === 0) {
          this.handlers.delete(type);
        }
      }
    };
  }

  /**
   * Subscribe to all events
   * @returns Unsubscribe function
   */
  subscribeAll(handler: EventHandler): () => void {
    this.allHandlers.add(handler);

    // Return unsubscribe function
    return () => {
      this.allHandlers.delete(handler);
    };
  }

  /**
   * Publish an event to all subscribers
   * Handlers are called synchronously in subscription order
   */
  publish(event: OrchEvent): void {
    // Add to history (circular buffer - remove oldest if at max)
    if (this.history.length >= this.maxHistory) {
      this.history.shift();
    }
    this.history.push(event);

    // Call type-specific handlers first (in insertion order - Set maintains this)
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        handler(event);
      }
    }

    // Then call "all" handlers (in insertion order)
    for (const handler of this.allHandlers) {
      handler(event);
    }
  }

  /**
   * Get event history
   * @param filter Optional event type filter
   */
  getHistory(filter?: EventType): OrchEvent[] {
    if (filter) {
      return this.history.filter((event) => event.type === filter);
    }
    // Return a copy to prevent external mutation
    return [...this.history];
  }

  /**
   * Clear all handlers and history
   */
  clear(): void {
    this.handlers.clear();
    this.allHandlers.clear();
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
