/**
 * Tests for ticket-proposal.ts (T035: AI-Assisted Ticket Creation)
 */

import { describe, expect, test } from 'bun:test';
import {
  parseTicketProposals,
  autoAssignEpic,
  proposalToTicket,
  formatProposalForDisplay,
  containsProposals,
  generateTicketCreationPrompt,
  type TicketProposal,
} from './ticket-proposal.js';
import type { Epic, Ticket } from './types.js';

describe('parseTicketProposals', () => {
  test('parses a single ticket proposal', () => {
    const text = `## Proposed Ticket: Add User Authentication
- **Priority:** P1
- **Epic:** auth
- **Description:** Implement user login and registration
- **Acceptance Criteria:**
  - User can register with email/password
  - User can login with valid credentials
  - Invalid credentials show error message
- **Validation Steps:**
  - \`bun run typecheck\` passes
  - \`bun test\` passes
- **Dependencies:** T001, T002`;

    const proposals = parseTicketProposals(text);

    expect(proposals.length).toBe(1);
    expect(proposals[0].title).toBe('Add User Authentication');
    expect(proposals[0].priority).toBe('P1');
    expect(proposals[0].epic).toBe('auth');
    expect(proposals[0].description).toBe('Implement user login and registration');
    expect(proposals[0].acceptanceCriteria).toEqual([
      'User can register with email/password',
      'User can login with valid credentials',
      'Invalid credentials show error message',
    ]);
    expect(proposals[0].validationSteps).toEqual([
      '`bun run typecheck` passes',
      '`bun test` passes',
    ]);
    expect(proposals[0].dependencies).toEqual(['T001', 'T002']);
    expect(proposals[0].reviewed).toBe(false);
  });

  test('parses multiple ticket proposals', () => {
    const text = `## Proposed Ticket: Part 1 - Core
- **Priority:** P0
- **Epic:** core
- **Description:** Core implementation
- **Acceptance Criteria:**
  - Core feature works
- **Validation Steps:**
  - \`bun test\` passes

## Proposed Ticket: Part 2 - Integration
- **Priority:** P1
- **Epic:** core
- **Description:** Integration with existing systems
- **Acceptance Criteria:**
  - Integration complete
- **Validation Steps:**
  - \`bun test\` passes
- **Dependencies:** T010`;

    const proposals = parseTicketProposals(text);

    expect(proposals.length).toBe(2);
    expect(proposals[0].title).toBe('Part 1 - Core');
    expect(proposals[0].priority).toBe('P0');
    expect(proposals[1].title).toBe('Part 2 - Integration');
    expect(proposals[1].priority).toBe('P1');
    expect(proposals[1].dependencies).toEqual(['T010']);
  });

  test('handles ### headers', () => {
    const text = `### Proposed Ticket: Feature X
- **Priority:** P2
- **Acceptance Criteria:**
  - Works as expected`;

    const proposals = parseTicketProposals(text);

    expect(proposals.length).toBe(1);
    expect(proposals[0].title).toBe('Feature X');
    expect(proposals[0].priority).toBe('P2');
  });

  test('extracts file paths from text', () => {
    const text = `## Proposed Ticket: Update Auth Module
- **Priority:** P1
- **Description:** Update src/core/auth.ts and src/utils/validators.ts
- **Acceptance Criteria:**
  - Changes to src/core/auth.ts are complete`;

    const proposals = parseTicketProposals(text);

    expect(proposals[0].mentionedPaths).toBeDefined();
    expect(proposals[0].mentionedPaths).toContain('src/core/auth.ts');
    expect(proposals[0].mentionedPaths).toContain('src/utils/validators.ts');
  });

  test('defaults priority to P1 when not specified', () => {
    const text = `## Proposed Ticket: Simple Task
- **Description:** Do something`;

    const proposals = parseTicketProposals(text);

    expect(proposals[0].priority).toBe('P1');
  });

  test('handles missing optional fields', () => {
    const text = `## Proposed Ticket: Minimal Ticket
- **Priority:** P2`;

    const proposals = parseTicketProposals(text);

    expect(proposals.length).toBe(1);
    expect(proposals[0].title).toBe('Minimal Ticket');
    expect(proposals[0].epic).toBeUndefined();
    expect(proposals[0].description).toBeUndefined();
    expect(proposals[0].acceptanceCriteria).toEqual([]);
    expect(proposals[0].validationSteps).toEqual([]);
    expect(proposals[0].dependencies).toEqual([]);
  });
});

describe('containsProposals', () => {
  test('returns true when proposals are present', () => {
    expect(containsProposals('## Proposed Ticket: Something')).toBe(true);
    expect(containsProposals('### Proposed Ticket: Something')).toBe(true);
  });

  test('returns false when no proposals', () => {
    expect(containsProposals('Just some regular text')).toBe(false);
    expect(containsProposals('## Regular Heading')).toBe(false);
  });
});

describe('autoAssignEpic', () => {
  const epics: Epic[] = [
    { name: 'core', path: 'src/core', description: 'Core module' },
    { name: 'ui', path: 'src/views', description: 'UI components' },
    { name: 'utils', path: 'src/utils', description: 'Utilities' },
  ];

  test('assigns epic based on file paths', () => {
    const proposal: TicketProposal = {
      tempId: 'test-1',
      title: 'Test',
      priority: 'P1',
      acceptanceCriteria: [],
      validationSteps: [],
      dependencies: [],
      mentionedPaths: ['src/core/events.ts', 'src/core/types.ts'],
      reviewed: false,
    };

    const assigned = autoAssignEpic(proposal, epics);
    expect(assigned).toBe('core');
  });

  test('assigns epic with most path matches', () => {
    const proposal: TicketProposal = {
      tempId: 'test-2',
      title: 'Test',
      priority: 'P1',
      acceptanceCriteria: [],
      validationSteps: [],
      dependencies: [],
      mentionedPaths: ['src/core/events.ts', 'src/views/App.ts', 'src/views/Home.ts'],
      reviewed: false,
    };

    const assigned = autoAssignEpic(proposal, epics);
    expect(assigned).toBe('ui'); // ui has 2 matches, core has 1
  });

  test('returns undefined when no paths match', () => {
    const proposal: TicketProposal = {
      tempId: 'test-3',
      title: 'Test',
      priority: 'P1',
      acceptanceCriteria: [],
      validationSteps: [],
      dependencies: [],
      mentionedPaths: ['external/lib.ts'],
      reviewed: false,
    };

    const assigned = autoAssignEpic(proposal, epics);
    expect(assigned).toBeUndefined();
  });

  test('returns undefined when no paths mentioned', () => {
    const proposal: TicketProposal = {
      tempId: 'test-4',
      title: 'Test',
      priority: 'P1',
      acceptanceCriteria: [],
      validationSteps: [],
      dependencies: [],
      reviewed: false,
    };

    const assigned = autoAssignEpic(proposal, epics);
    expect(assigned).toBeUndefined();
  });
});

describe('proposalToTicket', () => {
  test('converts proposal to ticket data', () => {
    const proposal: TicketProposal = {
      tempId: 'temp-1',
      title: 'Add Feature X',
      description: 'Implement feature X with all requirements',
      priority: 'P1',
      epic: 'core',
      acceptanceCriteria: ['Works correctly', 'Tests pass'],
      validationSteps: ['bun test', 'bun typecheck'],
      dependencies: ['T001', 'T002'],
      reviewed: true,
    };

    const ticket = proposalToTicket(proposal);

    expect(ticket.title).toBe('Add Feature X');
    expect(ticket.description).toBe('Implement feature X with all requirements');
    expect(ticket.priority).toBe('P1');
    expect(ticket.status).toBe('Todo');
    expect(ticket.epic).toBe('core');
    expect(ticket.owner).toBeUndefined();
    expect(ticket.dependencies).toEqual(['T001', 'T002']);
    expect(ticket.acceptanceCriteria).toEqual(['Works correctly', 'Tests pass']);
    expect(ticket.validationSteps).toEqual(['bun test', 'bun typecheck']);
  });

  test('handles minimal proposal', () => {
    const proposal: TicketProposal = {
      tempId: 'temp-2',
      title: 'Simple Task',
      priority: 'P2',
      acceptanceCriteria: [],
      validationSteps: [],
      dependencies: [],
      reviewed: false,
    };

    const ticket = proposalToTicket(proposal);

    expect(ticket.title).toBe('Simple Task');
    expect(ticket.priority).toBe('P2');
    expect(ticket.status).toBe('Todo');
    expect(ticket.dependencies).toEqual([]);
    expect(ticket.acceptanceCriteria).toEqual([]);
  });
});

describe('formatProposalForDisplay', () => {
  test('formats proposal with all fields', () => {
    const proposal: TicketProposal = {
      tempId: 'temp-1',
      title: 'Test Feature',
      description: 'Implement test feature',
      priority: 'P1',
      epic: 'core',
      acceptanceCriteria: ['AC1', 'AC2'],
      validationSteps: ['VS1'],
      dependencies: ['T001'],
      reviewed: false,
    };

    const formatted = formatProposalForDisplay(proposal);

    expect(formatted).toContain('## Proposed Ticket: Test Feature');
    expect(formatted).toContain('- **Priority:** P1');
    expect(formatted).toContain('- **Epic:** core');
    expect(formatted).toContain('- **Description:** Implement test feature');
    expect(formatted).toContain('- **Acceptance Criteria:**');
    expect(formatted).toContain('  - AC1');
    expect(formatted).toContain('  - AC2');
    expect(formatted).toContain('- **Validation Steps:**');
    expect(formatted).toContain('  - VS1');
    expect(formatted).toContain('- **Dependencies:** T001');
  });

  test('omits missing optional fields', () => {
    const proposal: TicketProposal = {
      tempId: 'temp-2',
      title: 'Minimal',
      priority: 'P2',
      acceptanceCriteria: [],
      validationSteps: [],
      dependencies: [],
      reviewed: false,
    };

    const formatted = formatProposalForDisplay(proposal);

    expect(formatted).toContain('## Proposed Ticket: Minimal');
    expect(formatted).toContain('- **Priority:** P2');
    expect(formatted).not.toContain('Epic');
    expect(formatted).not.toContain('Description');
    expect(formatted).not.toContain('Acceptance Criteria');
    expect(formatted).not.toContain('Dependencies');
  });
});

describe('generateTicketCreationPrompt', () => {
  test('generates prompt with epics and existing tickets', () => {
    const epics: Epic[] = [
      { name: 'core', path: 'src/core', description: 'Core functionality' },
      { name: 'ui', path: 'src/ui', description: 'UI components' },
    ];

    const tickets: Ticket[] = [
      {
        id: 'T001',
        title: 'First',
        priority: 'P0',
        status: 'Done',
        dependencies: [],
        acceptanceCriteria: [],
        validationSteps: [],
      },
      {
        id: 'T002',
        title: 'Second',
        priority: 'P1',
        status: 'Todo',
        dependencies: ['T001'],
        acceptanceCriteria: [],
        validationSteps: [],
      },
    ];

    const prompt = generateTicketCreationPrompt('Add a new feature', tickets, epics);

    expect(prompt).toContain('core: src/core');
    expect(prompt).toContain('ui: src/ui');
    expect(prompt).toContain('T001, T002');
    expect(prompt).toContain('Add a new feature');
    expect(prompt).toContain('## Proposed Ticket:');
  });

  test('handles empty epics and tickets', () => {
    const prompt = generateTicketCreationPrompt('Do something', [], []);

    expect(prompt).toContain('(No epics defined)');
    expect(prompt).toContain('(No existing tickets)');
    expect(prompt).toContain('Do something');
  });
});
