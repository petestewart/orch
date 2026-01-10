/**
 * Plan Store - PLAN.md Parser and Writer
 *
 * Reads PLAN.md from filesystem, parses into structured data,
 * and writes updates back atomically.
 *
 * Implements: T002, T003, T037
 */

import type { Ticket, Epic } from './types';
import { getEventBus } from './events';

export interface ParsedPlan {
  overview: string;
  definitionOfDone: string[];
  epics: Epic[];
  tickets: Ticket[];
  rawContent: string;
}

export interface ParseError {
  line: number;
  message: string;
}

export class PlanStore {
  private planPath: string;
  private plan: ParsedPlan | null = null;
  private watcher: unknown = null;

  constructor(planPath: string) {
    this.planPath = planPath;
  }

  /**
   * Load and parse PLAN.md
   * Emits 'plan:loaded' on success, 'plan:error' on failure
   */
  async load(): Promise<ParsedPlan> {
    // TODO: Implement - T002
    // - Read file from this.planPath
    // - Parse markdown into structured data
    // - Extract epics section (T037)
    // - Extract tickets with all fields
    // - Emit plan:loaded event
    throw new Error('Not implemented');
  }

  /**
   * Get current plan (throws if not loaded)
   */
  getPlan(): ParsedPlan {
    if (!this.plan) {
      throw new Error('Plan not loaded. Call load() first.');
    }
    return this.plan;
  }

  /**
   * Get all tickets
   */
  getTickets(): Ticket[] {
    return this.getPlan().tickets;
  }

  /**
   * Get ticket by ID
   */
  getTicket(id: string): Ticket | undefined {
    return this.getTickets().find(t => t.id === id);
  }

  /**
   * Get all epics
   */
  getEpics(): Epic[] {
    return this.getPlan().epics;
  }

  /**
   * Update a ticket's status
   * Writes to PLAN.md atomically and emits 'plan:updated'
   */
  async updateTicketStatus(
    ticketId: string,
    status: Ticket['status'],
    reason?: string
  ): Promise<void> {
    // TODO: Implement - T003
    // - Find ticket in plan
    // - Update status field
    // - Write to temp file, then rename (atomic)
    // - Emit plan:updated and ticket:status-changed events
    throw new Error('Not implemented');
  }

  /**
   * Update a ticket's owner
   */
  async updateTicketOwner(ticketId: string, owner: string): Promise<void> {
    // TODO: Implement - T003
    throw new Error('Not implemented');
  }

  /**
   * Add feedback/notes to a ticket
   */
  async addTicketFeedback(ticketId: string, feedback: string): Promise<void> {
    // TODO: Implement - T003
    throw new Error('Not implemented');
  }

  /**
   * Create a new ticket
   */
  async createTicket(ticket: Omit<Ticket, 'id'>): Promise<Ticket> {
    // TODO: Implement - T035
    // - Generate next ticket ID
    // - Add to plan
    // - Write to file
    throw new Error('Not implemented');
  }

  /**
   * Start watching PLAN.md for external changes
   */
  startWatching(): void {
    // TODO: Implement - T003
    // - Use fs.watch or chokidar
    // - On change, reload and emit plan:updated
    throw new Error('Not implemented');
  }

  /**
   * Stop watching
   */
  stopWatching(): void {
    // TODO: Implement
    this.watcher = null;
  }
}

// =============================================================================
// Parser utilities
// =============================================================================

/**
 * Parse a single ticket from markdown text
 */
export function parseTicket(markdown: string): Ticket | ParseError {
  // TODO: Implement - T002
  throw new Error('Not implemented');
}

/**
 * Parse epic definitions from markdown
 */
export function parseEpics(markdown: string): Epic[] {
  // TODO: Implement - T037
  throw new Error('Not implemented');
}

/**
 * Serialize a ticket back to markdown
 */
export function serializeTicket(ticket: Ticket): string {
  // TODO: Implement - T003
  throw new Error('Not implemented');
}

/**
 * Validate plan structure and detect issues
 */
export function validatePlan(plan: ParsedPlan): ParseError[] {
  // TODO: Implement - T002
  // - Check for duplicate ticket IDs
  // - Check for invalid dependencies
  // - Check for circular dependencies (T004)
  throw new Error('Not implemented');
}
