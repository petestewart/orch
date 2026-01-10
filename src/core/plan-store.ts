/**
 * Plan Store - PLAN.md Parser and Writer
 *
 * Reads PLAN.md from filesystem, parses into structured data,
 * and writes updates back atomically.
 *
 * Implements: T002, T003, T037
 */

import type { Ticket, Epic, TicketPriority, TicketStatus } from './types';
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
    const file = Bun.file(this.planPath);
    const exists = await file.exists();

    if (!exists) {
      const error: ParseError = {
        line: 0,
        message: `Plan file not found: ${this.planPath}`,
      };
      getEventBus().publish({
        type: 'plan:error',
        timestamp: new Date(),
      });
      throw new Error(error.message);
    }

    const rawContent = await file.text();
    const lines = rawContent.split('\n');

    // Extract overview (content between ## 1. Overview and next ##)
    const overview = extractSection(lines, /^##\s*1\.\s*Overview/i, /^##\s*\d+\./);

    // Extract Definition of Done items
    const definitionOfDone = extractDefinitionOfDone(lines);

    // Parse tickets
    const ticketsResult = parseAllTickets(rawContent);
    if ('line' in ticketsResult && 'message' in ticketsResult) {
      getEventBus().publish({
        type: 'plan:error',
        timestamp: new Date(),
      });
      throw new Error(`Parse error at line ${ticketsResult.line}: ${ticketsResult.message}`);
    }

    // Parse epics (basic implementation - returns empty for now, T037 will expand)
    const epics = parseEpics(rawContent);

    this.plan = {
      overview,
      definitionOfDone,
      epics,
      tickets: ticketsResult as Ticket[],
      rawContent,
    };

    getEventBus().publish({
      type: 'plan:loaded',
      timestamp: new Date(),
      tickets: this.plan.tickets,
      epics: this.plan.epics,
    });

    return this.plan;
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
    const plan = this.getPlan();
    const ticket = this.getTicket(ticketId);

    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    const previousStatus = ticket.status;
    if (previousStatus === status) {
      return; // No change needed
    }

    // Format status for display (InProgress -> In Progress)
    const displayStatus = formatStatusForDisplay(status);

    // Find and replace the status field in the raw content
    // Pattern matches: - **Status:** <value>
    const statusPattern = new RegExp(
      `(###\\s*Ticket:\\s*${ticketId}[\\s\\S]*?-\\s*\\*\\*Status:\\*\\*)\\s*[^\\n]+`,
      'm'
    );

    const updatedContent = plan.rawContent.replace(statusPattern, `$1 ${displayStatus}`);

    if (updatedContent === plan.rawContent) {
      throw new Error(`Could not find Status field for ticket ${ticketId}`);
    }

    // Write atomically (temp file + rename)
    await this.writeAtomically(updatedContent);

    // Update internal state
    ticket.status = status;
    plan.rawContent = updatedContent;

    // Emit events
    getEventBus().publish({
      type: 'ticket:status-changed',
      timestamp: new Date(),
      ticketId,
      previousStatus,
      newStatus: status,
      reason,
    });

    getEventBus().publish({
      type: 'plan:updated',
      timestamp: new Date(),
    });
  }

  /**
   * Update a ticket's owner
   */
  async updateTicketOwner(ticketId: string, owner: string): Promise<void> {
    const plan = this.getPlan();
    const ticket = this.getTicket(ticketId);

    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    const displayOwner = owner || 'Unassigned';

    // Find and replace the owner field in the raw content
    // Pattern matches: - **Owner:** <value>
    const ownerPattern = new RegExp(
      `(###\\s*Ticket:\\s*${ticketId}[\\s\\S]*?-\\s*\\*\\*Owner:\\*\\*)\\s*[^\\n]+`,
      'm'
    );

    const updatedContent = plan.rawContent.replace(ownerPattern, `$1 ${displayOwner}`);

    if (updatedContent === plan.rawContent) {
      throw new Error(`Could not find Owner field for ticket ${ticketId}`);
    }

    // Write atomically (temp file + rename)
    await this.writeAtomically(updatedContent);

    // Update internal state
    ticket.owner = owner || undefined;
    plan.rawContent = updatedContent;

    // Emit plan:updated event
    getEventBus().publish({
      type: 'plan:updated',
      timestamp: new Date(),
    });
  }

  /**
   * Add feedback/notes to a ticket
   */
  async addTicketFeedback(ticketId: string, feedback: string): Promise<void> {
    const plan = this.getPlan();
    const ticket = this.getTicket(ticketId);

    if (!ticket) {
      throw new Error(`Ticket not found: ${ticketId}`);
    }

    // Check if Notes field exists for this ticket
    const notesPattern = new RegExp(
      `(###\\s*Ticket:\\s*${ticketId}[\\s\\S]*?-\\s*\\*\\*Notes:\\*\\*)([^\\n]*)`,
      'm'
    );

    let updatedContent: string;
    const notesMatch = plan.rawContent.match(notesPattern);

    if (notesMatch) {
      // Notes field exists - append to existing notes
      const existingNotes = notesMatch[2].trim();
      const separator = existingNotes ? '\n  - ' : ' ';
      updatedContent = plan.rawContent.replace(
        notesPattern,
        `$1${existingNotes}${separator}${feedback}`
      );
    } else {
      // Notes field doesn't exist - add it after the last field before the next ticket or end
      // Find the ticket section and add Notes field
      const ticketSectionPattern = new RegExp(
        `(###\\s*Ticket:\\s*${ticketId}[\\s\\S]*?)(?=###\\s*Ticket:|## \\d+\\.|$)`,
        'm'
      );

      const ticketMatch = plan.rawContent.match(ticketSectionPattern);
      if (ticketMatch) {
        const ticketSection = ticketMatch[1];
        const newNotesLine = `- **Notes:** ${feedback}\n`;
        // Insert before the last newline of the section
        const insertedSection = ticketSection.trimEnd() + '\n' + newNotesLine + '\n';
        updatedContent = plan.rawContent.replace(ticketSectionPattern, insertedSection);
      } else {
        throw new Error(`Could not find ticket section for ${ticketId}`);
      }
    }

    // Write atomically (temp file + rename)
    await this.writeAtomically(updatedContent);

    // Update internal state
    ticket.notes = ticket.notes ? `${ticket.notes}\n${feedback}` : feedback;
    plan.rawContent = updatedContent;

    // Emit plan:updated event
    getEventBus().publish({
      type: 'plan:updated',
      timestamp: new Date(),
    });
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

  /**
   * Write content to PLAN.md atomically using temp file + rename
   */
  private async writeAtomically(content: string): Promise<void> {
    const tempPath = `${this.planPath}.tmp`;

    // Write to temp file
    await Bun.write(tempPath, content);

    // Rename atomically
    const fs = await import('fs/promises');
    await fs.rename(tempPath, this.planPath);
  }
}

// =============================================================================
// Parser utilities
// =============================================================================

/**
 * Extract a section from lines between a start pattern and end pattern
 */
function extractSection(lines: string[], startPattern: RegExp, endPattern: RegExp): string {
  let inSection = false;
  let sectionLines: string[] = [];

  for (const line of lines) {
    if (startPattern.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && endPattern.test(line)) {
      break;
    }
    if (inSection) {
      sectionLines.push(line);
    }
  }

  return sectionLines.join('\n').trim();
}

/**
 * Extract Definition of Done items
 */
function extractDefinitionOfDone(lines: string[]): string[] {
  const items: string[] = [];
  let inDoDSection = false;

  for (const line of lines) {
    if (/^##\s*\d+\.\s*Definition of Done/i.test(line)) {
      inDoDSection = true;
      continue;
    }
    if (inDoDSection && /^##\s*\d+\./.test(line)) {
      break;
    }
    if (inDoDSection) {
      // Match checkbox items: - [ ] text or - [x] text
      const match = line.match(/^-\s*\[[ x]\]\s*(.+)$/);
      if (match) {
        items.push(match[1].trim());
      }
    }
  }

  return items;
}

/**
 * Find the line number where a ticket starts in the original content
 */
function findTicketLineNumber(content: string, ticketId: string): number {
  const lines = content.split('\n');
  const pattern = new RegExp(`^###\\s*Ticket:\\s*${ticketId}\\b`, 'i');

  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i + 1; // 1-based line numbers
    }
  }
  return 0;
}

/**
 * Parse all tickets from the full markdown content
 */
function parseAllTickets(content: string): Ticket[] | ParseError {
  const tickets: Ticket[] = [];

  // Split by ticket headers: ### Ticket: TXXX Title
  const ticketPattern = /^###\s*Ticket:\s*(T\d+)\s+(.+)$/gm;
  const ticketMatches: { id: string; title: string; startIndex: number }[] = [];

  let match;
  while ((match = ticketPattern.exec(content)) !== null) {
    ticketMatches.push({
      id: match[1],
      title: match[2].trim(),
      startIndex: match.index,
    });
  }

  // Process each ticket section
  for (let i = 0; i < ticketMatches.length; i++) {
    const ticketMatch = ticketMatches[i];
    const nextIndex = i + 1 < ticketMatches.length
      ? ticketMatches[i + 1].startIndex
      : content.length;

    const ticketSection = content.slice(ticketMatch.startIndex, nextIndex);
    const lineNumber = findTicketLineNumber(content, ticketMatch.id);

    const result = parseTicket(ticketSection, lineNumber);
    if ('line' in result && 'message' in result) {
      return result;
    }
    tickets.push(result);
  }

  return tickets;
}

/**
 * Parse a field value from a line
 * Handles both single-line and multi-line (list) formats
 */
function parseField(lines: string[], fieldName: string, startLine: number): { value: string | string[] | null; endIndex: number } {
  const fieldPattern = new RegExp(`^-\\s*\\*\\*${fieldName}:\\*\\*\\s*(.*)$`, 'i');

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(fieldPattern);
    if (match) {
      const inlineValue = match[1].trim();

      // Check if this is a list field (next lines start with "  - ")
      const listItems: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s{2,}-\s+/.test(lines[j])) {
        const itemMatch = lines[j].match(/^\s{2,}-\s+(.+)$/);
        if (itemMatch) {
          listItems.push(itemMatch[1].trim());
        }
        j++;
      }

      if (listItems.length > 0) {
        return { value: listItems, endIndex: j };
      }

      // Return inline value or null if empty
      return { value: inlineValue || null, endIndex: i + 1 };
    }
  }

  return { value: null, endIndex: -1 };
}

/**
 * Validate priority value
 */
function isValidPriority(value: string): value is TicketPriority {
  return ['P0', 'P1', 'P2'].includes(value);
}

/**
 * Normalize status value (handles "In Progress" -> "InProgress")
 */
function normalizeStatus(value: string): string {
  // Map common variations to canonical form
  const statusMap: Record<string, TicketStatus> = {
    'todo': 'Todo',
    'inprogress': 'InProgress',
    'in progress': 'InProgress',
    'review': 'Review',
    'qa': 'QA',
    'done': 'Done',
    'failed': 'Failed',
  };

  const normalized = statusMap[value.toLowerCase()];
  return normalized ?? value;
}

/**
 * Format status for display in PLAN.md (InProgress -> "In Progress")
 */
function formatStatusForDisplay(status: TicketStatus): string {
  const displayMap: Record<TicketStatus, string> = {
    'Todo': 'Todo',
    'InProgress': 'In Progress',
    'Review': 'Review',
    'QA': 'QA',
    'Done': 'Done',
    'Failed': 'Failed',
  };
  return displayMap[status];
}

/**
 * Validate status value
 */
function isValidStatus(value: string): value is TicketStatus {
  return ['Todo', 'InProgress', 'Review', 'QA', 'Done', 'Failed'].includes(value);
}

/**
 * Parse a single ticket from markdown text
 * @param markdown - The markdown section for this ticket (starting with ### Ticket:)
 * @param startLineNumber - The line number in the original file where this ticket starts
 */
export function parseTicket(markdown: string, startLineNumber: number = 1): Ticket | ParseError {
  const lines = markdown.split('\n');

  // Parse header: ### Ticket: TXXX Title
  const headerMatch = lines[0]?.match(/^###\s*Ticket:\s*(T\d+)\s+(.+)$/);
  if (!headerMatch) {
    return {
      line: startLineNumber,
      message: 'Invalid ticket header format. Expected: ### Ticket: TXXX Title',
    };
  }

  const id = headerMatch[1];
  const title = headerMatch[2].trim();

  // Parse priority (required)
  const priorityResult = parseField(lines, 'Priority', startLineNumber);
  if (!priorityResult.value || typeof priorityResult.value !== 'string') {
    return {
      line: startLineNumber,
      message: `Ticket ${id}: Missing required field 'Priority'`,
    };
  }
  if (!isValidPriority(priorityResult.value)) {
    return {
      line: startLineNumber,
      message: `Ticket ${id}: Invalid priority '${priorityResult.value}'. Must be P0, P1, or P2`,
    };
  }
  const priority = priorityResult.value;

  // Parse status (required)
  const statusResult = parseField(lines, 'Status', startLineNumber);
  if (!statusResult.value || typeof statusResult.value !== 'string') {
    return {
      line: startLineNumber,
      message: `Ticket ${id}: Missing required field 'Status'`,
    };
  }
  const normalizedStatusValue = normalizeStatus(statusResult.value);
  if (!isValidStatus(normalizedStatusValue)) {
    return {
      line: startLineNumber,
      message: `Ticket ${id}: Invalid status '${statusResult.value}'. Must be Todo, InProgress (or 'In Progress'), Review, QA, Done, or Failed`,
    };
  }
  const status = normalizedStatusValue;

  // Parse owner (optional)
  const ownerResult = parseField(lines, 'Owner', startLineNumber);
  const owner = (ownerResult.value && typeof ownerResult.value === 'string' && ownerResult.value !== 'Unassigned')
    ? ownerResult.value
    : undefined;

  // Parse scope/description (optional)
  const scopeResult = parseField(lines, 'Scope', startLineNumber);
  const description = (scopeResult.value && typeof scopeResult.value === 'string')
    ? scopeResult.value
    : undefined;

  // Parse acceptance criteria (optional, but usually present)
  const acResult = parseField(lines, 'Acceptance Criteria', startLineNumber);
  const acceptanceCriteria = Array.isArray(acResult.value) ? acResult.value : [];

  // Parse validation steps (optional)
  const vsResult = parseField(lines, 'Validation Steps', startLineNumber);
  const validationSteps = Array.isArray(vsResult.value) ? vsResult.value : [];

  // Parse notes (optional)
  const notesResult = parseField(lines, 'Notes', startLineNumber);
  let notes: string | undefined;
  if (notesResult.value) {
    if (Array.isArray(notesResult.value)) {
      notes = notesResult.value.join('\n');
    } else {
      notes = notesResult.value;
    }
  }

  // Parse dependencies (optional)
  const depsResult = parseField(lines, 'Dependencies', startLineNumber);
  let dependencies: string[] = [];
  if (depsResult.value && typeof depsResult.value === 'string') {
    // Parse comma-separated ticket IDs: T001, T002, etc.
    dependencies = depsResult.value
      .split(',')
      .map(d => d.trim())
      .filter(d => /^T\d+$/.test(d));
  }

  // Parse epic (optional - for T037)
  const epicResult = parseField(lines, 'Epic', startLineNumber);
  const epic = (epicResult.value && typeof epicResult.value === 'string')
    ? epicResult.value
    : undefined;

  return {
    id,
    title,
    description,
    priority,
    status,
    epic,
    owner,
    dependencies,
    acceptanceCriteria,
    validationSteps,
    notes,
  };
}

/**
 * Parse epic definitions from markdown
 * Basic implementation for T002 - T037 will expand this
 */
export function parseEpics(markdown: string): Epic[] {
  // Basic implementation - return empty array
  // T037 will implement full epic parsing
  return [];
}

/**
 * Serialize a ticket back to markdown
 */
export function serializeTicket(ticket: Ticket): string {
  const lines: string[] = [];

  // Header
  lines.push(`### Ticket: ${ticket.id} ${ticket.title}`);

  // Priority (required)
  lines.push(`- **Priority:** ${ticket.priority}`);

  // Status (required)
  lines.push(`- **Status:** ${formatStatusForDisplay(ticket.status)}`);

  // Owner (optional)
  lines.push(`- **Owner:** ${ticket.owner || 'Unassigned'}`);

  // Epic (optional)
  if (ticket.epic) {
    lines.push(`- **Epic:** ${ticket.epic}`);
  }

  // Scope/Description (optional)
  if (ticket.description) {
    lines.push(`- **Scope:** ${ticket.description}`);
  }

  // Acceptance Criteria (optional)
  if (ticket.acceptanceCriteria.length > 0) {
    lines.push('- **Acceptance Criteria:**');
    for (const criterion of ticket.acceptanceCriteria) {
      lines.push(`  - ${criterion}`);
    }
  }

  // Validation Steps (optional)
  if (ticket.validationSteps.length > 0) {
    lines.push('- **Validation Steps:**');
    for (const step of ticket.validationSteps) {
      lines.push(`  - ${step}`);
    }
  }

  // Dependencies (optional)
  if (ticket.dependencies.length > 0) {
    lines.push(`- **Dependencies:** ${ticket.dependencies.join(', ')}`);
  }

  // Notes (optional)
  if (ticket.notes) {
    lines.push(`- **Notes:** ${ticket.notes}`);
  }

  return lines.join('\n');
}

/**
 * Validate plan structure and detect issues
 */
export function validatePlan(plan: ParsedPlan): ParseError[] {
  const errors: ParseError[] = [];

  // Check for duplicate ticket IDs
  const seenIds = new Set<string>();
  for (const ticket of plan.tickets) {
    if (seenIds.has(ticket.id)) {
      errors.push({
        line: 0,
        message: `Duplicate ticket ID: ${ticket.id}`,
      });
    }
    seenIds.add(ticket.id);
  }

  // Check for invalid dependencies (references to non-existent tickets)
  const allIds = new Set(plan.tickets.map(t => t.id));
  for (const ticket of plan.tickets) {
    for (const dep of ticket.dependencies) {
      if (!allIds.has(dep)) {
        errors.push({
          line: 0,
          message: `Ticket ${ticket.id} has invalid dependency: ${dep} (ticket not found)`,
        });
      }
    }
  }

  // Note: Circular dependency detection will be implemented in T004

  return errors;
}
