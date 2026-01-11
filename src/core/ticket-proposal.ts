/**
 * Ticket Proposal - AI-Assisted Ticket Creation
 *
 * Handles parsing AI-proposed tickets from chat responses and
 * creating them in PLAN.md via the TicketStore interface.
 *
 * Implements: T035
 */

import type { Ticket, TicketPriority, TicketStatus, Epic } from './types.js';

/**
 * A proposed ticket from AI conversation
 * Contains all ticket fields before creation
 */
export interface TicketProposal {
  /** Temporary ID for tracking in conversation (not the final T### ID) */
  tempId: string;
  title: string;
  description?: string;
  priority: TicketPriority;
  epic?: string;
  acceptanceCriteria: string[];
  validationSteps: string[];
  dependencies: string[];
  /** File paths mentioned that influenced epic assignment */
  mentionedPaths?: string[];
  /** Whether user has reviewed/edited this proposal */
  reviewed: boolean;
}

/**
 * Parse ticket proposals from AI response text
 *
 * Expects format like:
 * ```
 * ## Proposed Ticket: [Title]
 * - **Priority:** P1
 * - **Epic:** core
 * - **Description:** [description text]
 * - **Acceptance Criteria:**
 *   - criterion 1
 *   - criterion 2
 * - **Validation Steps:**
 *   - `bun run typecheck` passes
 * - **Dependencies:** T001, T002
 * ```
 */
export function parseTicketProposals(text: string): TicketProposal[] {
  const proposals: TicketProposal[] = [];

  // Split by proposal headers
  // Match: ## Proposed Ticket: Title  OR  ### Proposed Ticket: Title
  const proposalPattern = /^#{2,3}\s*Proposed Ticket:\s*(.+)$/gm;
  const matches: { title: string; startIndex: number }[] = [];

  let match;
  while ((match = proposalPattern.exec(text)) !== null) {
    matches.push({
      title: match[1].trim(),
      startIndex: match.index,
    });
  }

  // Process each proposal section
  for (let i = 0; i < matches.length; i++) {
    const proposalMatch = matches[i];
    const nextIndex = i + 1 < matches.length ? matches[i + 1].startIndex : text.length;
    const section = text.slice(proposalMatch.startIndex, nextIndex);

    const proposal = parseProposalSection(section, proposalMatch.title, i);
    if (proposal) {
      proposals.push(proposal);
    }
  }

  return proposals;
}

/**
 * Parse a single proposal section
 */
function parseProposalSection(section: string, title: string, index: number): TicketProposal | null {
  const lines = section.split('\n');

  // Parse priority
  const priorityMatch = section.match(/-\s*\*\*Priority:\*\*\s*(P[012])/i);
  const priority: TicketPriority = (priorityMatch?.[1] as TicketPriority) || 'P1';

  // Parse epic
  const epicMatch = section.match(/-\s*\*\*Epic:\*\*\s*([^\n]+)/i);
  const epic = epicMatch?.[1]?.trim() || undefined;

  // Parse description (scope)
  const descMatch = section.match(/-\s*\*\*(?:Description|Scope):\*\*\s*([^\n]+)/i);
  const description = descMatch?.[1]?.trim() || undefined;

  // Parse acceptance criteria (list items under the header)
  const acceptanceCriteria = parseListField(section, 'Acceptance Criteria');

  // Parse validation steps
  const validationSteps = parseListField(section, 'Validation Steps');

  // Parse dependencies
  const depsMatch = section.match(/-\s*\*\*Dependencies:\*\*\s*([^\n]+)/i);
  let dependencies: string[] = [];
  if (depsMatch?.[1]) {
    dependencies = depsMatch[1]
      .split(',')
      .map(d => d.trim())
      .filter(d => /^T\d+$/i.test(d))
      .map(d => d.toUpperCase());
  }

  // Look for mentioned file paths
  const mentionedPaths = extractFilePaths(section);

  return {
    tempId: `proposal-${index}`,
    title,
    description,
    priority,
    epic,
    acceptanceCriteria,
    validationSteps,
    dependencies,
    mentionedPaths,
    reviewed: false,
  };
}

/**
 * Parse a list field from the proposal section
 */
function parseListField(section: string, fieldName: string): string[] {
  const items: string[] = [];

  // Find the field header
  const pattern = new RegExp(`-\\s*\\*\\*${fieldName}:\\*\\*`, 'i');
  const match = section.match(pattern);
  if (!match) return items;

  // Get text after the header
  const afterHeader = section.slice(match.index! + match[0].length);
  const lines = afterHeader.split('\n');

  // Collect list items (lines starting with "  -")
  for (const line of lines) {
    // Stop at next field (line starting with "- **" at any position)
    if (/^-\s*\*\*\w+:\*\*/.test(line)) break;

    // Stop at blank line that isn't followed by more list items
    if (line.trim() === '') continue;

    // Stop if we hit a non-list line that's not indented (e.g., another section)
    if (line.trim() && !line.startsWith('  ') && !line.startsWith('\t')) break;

    // Match list items (with 2+ space indent)
    const itemMatch = line.match(/^\s{2,}-\s+(.+)$/);
    if (itemMatch) {
      items.push(itemMatch[1].trim());
    }
  }

  return items;
}

/**
 * Extract file paths from text
 * Looks for patterns like: src/core/file.ts, ./path/to/file, /absolute/path
 */
function extractFilePaths(text: string): string[] {
  const paths: string[] = [];

  // Match common file path patterns
  const pathPatterns = [
    // Relative paths: src/core/file.ts, ./file.ts
    /(?:^|\s|`)((?:\.\/|src\/|lib\/|app\/)[a-zA-Z0-9_\-/.]+\.[a-zA-Z0-9]+)/g,
    // Quoted paths
    /['"`]([a-zA-Z0-9_\-/.]+\.[a-zA-Z0-9]+)['"`]/g,
  ];

  for (const pattern of pathPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const path = match[1].trim();
      if (!paths.includes(path)) {
        paths.push(path);
      }
    }
  }

  return paths;
}

/**
 * Auto-assign epic based on file paths mentioned
 *
 * Matches file paths against epic paths to determine best epic
 */
export function autoAssignEpic(
  proposal: TicketProposal,
  epics: Epic[]
): string | undefined {
  if (!proposal.mentionedPaths || proposal.mentionedPaths.length === 0) {
    return undefined;
  }

  // Count matches per epic
  const epicMatches = new Map<string, number>();

  for (const filePath of proposal.mentionedPaths) {
    for (const epic of epics) {
      if (epic.path && filePath.startsWith(epic.path)) {
        const count = epicMatches.get(epic.name) || 0;
        epicMatches.set(epic.name, count + 1);
      }
    }
  }

  // Find epic with most matches
  let bestEpic: string | undefined;
  let maxMatches = 0;

  for (const [epicName, count] of epicMatches) {
    if (count > maxMatches) {
      maxMatches = count;
      bestEpic = epicName;
    }
  }

  return bestEpic;
}

/**
 * Convert a TicketProposal to ticket creation data (Omit<Ticket, 'id'>)
 */
export function proposalToTicket(proposal: TicketProposal): Omit<Ticket, 'id'> {
  return {
    title: proposal.title,
    description: proposal.description,
    priority: proposal.priority,
    status: 'Todo' as TicketStatus,
    epic: proposal.epic,
    owner: undefined,
    dependencies: proposal.dependencies,
    acceptanceCriteria: proposal.acceptanceCriteria,
    validationSteps: proposal.validationSteps,
    notes: undefined,
  };
}

/**
 * Format a proposal for display/editing
 */
export function formatProposalForDisplay(proposal: TicketProposal): string {
  const lines: string[] = [];

  lines.push(`## Proposed Ticket: ${proposal.title}`);
  lines.push(`- **Priority:** ${proposal.priority}`);

  if (proposal.epic) {
    lines.push(`- **Epic:** ${proposal.epic}`);
  }

  if (proposal.description) {
    lines.push(`- **Description:** ${proposal.description}`);
  }

  if (proposal.acceptanceCriteria.length > 0) {
    lines.push(`- **Acceptance Criteria:**`);
    for (const criterion of proposal.acceptanceCriteria) {
      lines.push(`  - ${criterion}`);
    }
  }

  if (proposal.validationSteps.length > 0) {
    lines.push(`- **Validation Steps:**`);
    for (const step of proposal.validationSteps) {
      lines.push(`  - ${step}`);
    }
  }

  if (proposal.dependencies.length > 0) {
    lines.push(`- **Dependencies:** ${proposal.dependencies.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Generate a prompt for the AI to create ticket proposals
 */
export function generateTicketCreationPrompt(
  userRequest: string,
  existingTickets: Ticket[],
  epics: Epic[]
): string {
  const epicList = epics.length > 0
    ? epics.map(e => `- ${e.name}: ${e.path}${e.description ? ` - ${e.description}` : ''}`).join('\n')
    : '(No epics defined)';

  const existingIds = existingTickets.map(t => t.id).join(', ');

  return `You are helping create well-structured tickets for a project plan.

## Available Epics
${epicList}

## Existing Tickets
${existingIds || '(No existing tickets)'}

## User Request
${userRequest}

## Instructions
Based on the user's request, propose one or more tickets. For each ticket, use this format:

## Proposed Ticket: [Clear, actionable title]
- **Priority:** P0|P1|P2 (P0=critical, P1=high, P2=medium)
- **Epic:** [epic name from list above, or omit if uncertain]
- **Description:** [Brief scope description]
- **Acceptance Criteria:**
  - [Measurable criterion 1]
  - [Measurable criterion 2]
- **Validation Steps:**
  - [Command or test to verify, e.g., \`bun run typecheck\` passes]
- **Dependencies:** [comma-separated ticket IDs if any, e.g., T001, T002]

Guidelines:
- Keep tickets small and focused (1-2 days of work)
- Acceptance criteria should be testable
- Assign to the most relevant epic based on file paths involved
- Include dependencies only for tickets that must complete first
- Suggest breaking large tasks into multiple tickets`;
}

/**
 * Check if text contains ticket proposals
 */
export function containsProposals(text: string): boolean {
  return /#{2,3}\s*Proposed Ticket:/i.test(text);
}
