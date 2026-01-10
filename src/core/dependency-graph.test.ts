/**
 * Unit tests for DependencyGraph
 * Implements: T004 validation
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { DependencyGraph } from './orchestrator';
import type { Ticket, TicketPriority, TicketStatus } from './types';

// Helper function to create a minimal ticket
function createTicket(
  id: string,
  deps: string[] = [],
  status: TicketStatus = 'Todo',
  priority: TicketPriority = 'P1'
): Ticket {
  return {
    id,
    title: `Ticket ${id}`,
    priority,
    status,
    dependencies: deps,
    acceptanceCriteria: [],
    validationSteps: [],
  };
}

describe('DependencyGraph', () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  describe('build', () => {
    test('builds graph from empty ticket array', () => {
      graph.build([]);
      expect(graph.getReadyTickets()).toEqual([]);
    });

    test('builds graph from tickets with no dependencies', () => {
      const tickets = [
        createTicket('T001'),
        createTicket('T002'),
        createTicket('T003'),
      ];
      graph.build(tickets);

      expect(graph.getDependencies('T001')).toEqual([]);
      expect(graph.getDependencies('T002')).toEqual([]);
      expect(graph.getDependencies('T003')).toEqual([]);
    });

    test('builds graph with dependencies correctly', () => {
      const tickets = [
        createTicket('T001'),
        createTicket('T002', ['T001']),
        createTicket('T003', ['T001', 'T002']),
      ];
      graph.build(tickets);

      expect(graph.getDependencies('T001')).toEqual([]);
      expect(graph.getDependencies('T002')).toEqual(['T001']);
      expect(graph.getDependencies('T003').sort()).toEqual(['T001', 'T002']);
    });

    test('builds reverse graph (dependents) correctly', () => {
      const tickets = [
        createTicket('T001'),
        createTicket('T002', ['T001']),
        createTicket('T003', ['T001']),
      ];
      graph.build(tickets);

      expect(graph.getDependents('T001').sort()).toEqual(['T002', 'T003']);
      expect(graph.getDependents('T002')).toEqual([]);
      expect(graph.getDependents('T003')).toEqual([]);
    });

    test('rebuilding graph clears previous data', () => {
      const tickets1 = [
        createTicket('T001'),
        createTicket('T002', ['T001']),
      ];
      graph.build(tickets1);

      const tickets2 = [
        createTicket('T003'),
        createTicket('T004', ['T003']),
      ];
      graph.build(tickets2);

      // Old tickets should be gone
      expect(graph.getTicket('T001')).toBeUndefined();
      expect(graph.getTicket('T002')).toBeUndefined();

      // New tickets should be present
      expect(graph.getTicket('T003')).toBeDefined();
      expect(graph.getTicket('T004')).toBeDefined();
    });
  });

  describe('getReadyTickets - linear dependencies', () => {
    test('linear deps A->B->C, only A ready initially', () => {
      // C depends on B, B depends on A
      const tickets = [
        createTicket('A', [], 'Todo'),
        createTicket('B', ['A'], 'Todo'),
        createTicket('C', ['B'], 'Todo'),
      ];
      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe('A');
    });

    test('linear deps: after A is Done, B becomes ready', () => {
      const tickets = [
        createTicket('A', [], 'Done'),
        createTicket('B', ['A'], 'Todo'),
        createTicket('C', ['B'], 'Todo'),
      ];
      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe('B');
    });

    test('linear deps: after A and B are Done, C becomes ready', () => {
      const tickets = [
        createTicket('A', [], 'Done'),
        createTicket('B', ['A'], 'Done'),
        createTicket('C', ['B'], 'Todo'),
      ];
      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe('C');
    });
  });

  describe('getReadyTickets - parallel dependencies', () => {
    test('multiple tickets with no deps are all ready', () => {
      const tickets = [
        createTicket('T001', [], 'Todo'),
        createTicket('T002', [], 'Todo'),
        createTicket('T003', [], 'Todo'),
      ];
      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready.length).toBe(3);
      expect(ready.map(t => t.id).sort()).toEqual(['T001', 'T002', 'T003']);
    });

    test('ticket with multiple deps waits for all', () => {
      // T003 depends on both T001 and T002
      const tickets = [
        createTicket('T001', [], 'Done'),
        createTicket('T002', [], 'Todo'),  // Not done yet
        createTicket('T003', ['T001', 'T002'], 'Todo'),
      ];
      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe('T002');  // Only T002 is ready
    });

    test('ticket with multiple deps becomes ready when all are Done', () => {
      const tickets = [
        createTicket('T001', [], 'Done'),
        createTicket('T002', [], 'Done'),
        createTicket('T003', ['T001', 'T002'], 'Todo'),
      ];
      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe('T003');
    });

    test('parallel independent chains', () => {
      // Chain 1: A -> B
      // Chain 2: C -> D
      // Both A and C should be ready
      const tickets = [
        createTicket('A', [], 'Todo'),
        createTicket('B', ['A'], 'Todo'),
        createTicket('C', [], 'Todo'),
        createTicket('D', ['C'], 'Todo'),
      ];
      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready.length).toBe(2);
      expect(ready.map(t => t.id).sort()).toEqual(['A', 'C']);
    });
  });

  describe('getReadyTickets - priority sorting', () => {
    test('ready tickets are sorted by priority (P0 first)', () => {
      const tickets = [
        createTicket('T001', [], 'Todo', 'P2'),
        createTicket('T002', [], 'Todo', 'P0'),
        createTicket('T003', [], 'Todo', 'P1'),
      ];
      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready.length).toBe(3);
      expect(ready[0].id).toBe('T002');  // P0
      expect(ready[1].id).toBe('T003');  // P1
      expect(ready[2].id).toBe('T001');  // P2
    });
  });

  describe('getReadyTickets - status filtering', () => {
    test('excludes InProgress tickets', () => {
      const tickets = [
        createTicket('T001', [], 'InProgress'),
        createTicket('T002', [], 'Todo'),
      ];
      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe('T002');
    });

    test('excludes Review tickets', () => {
      const tickets = [
        createTicket('T001', [], 'Review'),
        createTicket('T002', [], 'Todo'),
      ];
      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe('T002');
    });

    test('excludes Done tickets', () => {
      const tickets = [
        createTicket('T001', [], 'Done'),
        createTicket('T002', [], 'Todo'),
      ];
      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe('T002');
    });

    test('excludes Failed tickets', () => {
      const tickets = [
        createTicket('T001', [], 'Failed'),
        createTicket('T002', [], 'Todo'),
      ];
      graph.build(tickets);

      const ready = graph.getReadyTickets();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe('T002');
    });
  });

  describe('getBlockedBy', () => {
    test('returns empty array for ticket with no dependencies', () => {
      const tickets = [createTicket('T001')];
      graph.build(tickets);

      expect(graph.getBlockedBy('T001')).toEqual([]);
    });

    test('returns empty array for ticket with all deps Done', () => {
      const tickets = [
        createTicket('T001', [], 'Done'),
        createTicket('T002', ['T001'], 'Todo'),
      ];
      graph.build(tickets);

      expect(graph.getBlockedBy('T002')).toEqual([]);
    });

    test('returns blocking tickets that are not Done', () => {
      const tickets = [
        createTicket('T001', [], 'Todo'),
        createTicket('T002', ['T001'], 'Todo'),
      ];
      graph.build(tickets);

      const blocking = graph.getBlockedBy('T002');
      expect(blocking.length).toBe(1);
      expect(blocking[0].id).toBe('T001');
    });

    test('returns only non-Done dependencies', () => {
      const tickets = [
        createTicket('T001', [], 'Done'),
        createTicket('T002', [], 'InProgress'),
        createTicket('T003', ['T001', 'T002'], 'Todo'),
      ];
      graph.build(tickets);

      const blocking = graph.getBlockedBy('T003');
      expect(blocking.length).toBe(1);
      expect(blocking[0].id).toBe('T002');
    });

    test('returns empty array for unknown ticket', () => {
      const tickets = [createTicket('T001')];
      graph.build(tickets);

      expect(graph.getBlockedBy('UNKNOWN')).toEqual([]);
    });
  });

  describe('detectCycles', () => {
    test('returns empty array for acyclic graph', () => {
      const tickets = [
        createTicket('A', []),
        createTicket('B', ['A']),
        createTicket('C', ['B']),
      ];
      graph.build(tickets);

      expect(graph.detectCycles()).toEqual([]);
    });

    test('returns empty array for graph with no dependencies', () => {
      const tickets = [
        createTicket('A'),
        createTicket('B'),
        createTicket('C'),
      ];
      graph.build(tickets);

      expect(graph.detectCycles()).toEqual([]);
    });

    test('detects simple cycle A -> B -> A', () => {
      const tickets = [
        createTicket('A', ['B']),
        createTicket('B', ['A']),
      ];
      graph.build(tickets);

      const cycles = graph.detectCycles();
      expect(cycles.length).toBeGreaterThan(0);
      // The cycle should contain both A and B
      const cycleIds = cycles[0];
      expect(cycleIds).toContain('A');
      expect(cycleIds).toContain('B');
    });

    test('detects three-node cycle A -> B -> C -> A', () => {
      const tickets = [
        createTicket('A', ['C']),
        createTicket('B', ['A']),
        createTicket('C', ['B']),
      ];
      graph.build(tickets);

      const cycles = graph.detectCycles();
      expect(cycles.length).toBeGreaterThan(0);
    });

    test('detects self-cycle A -> A', () => {
      const tickets = [
        createTicket('A', ['A']),
      ];
      graph.build(tickets);

      const cycles = graph.detectCycles();
      expect(cycles.length).toBeGreaterThan(0);
      expect(cycles[0]).toContain('A');
    });

    test('detects cycle in larger graph', () => {
      // A -> B -> C (no cycle)
      // D -> E -> F -> D (cycle)
      const tickets = [
        createTicket('A', []),
        createTicket('B', ['A']),
        createTicket('C', ['B']),
        createTicket('D', ['F']),
        createTicket('E', ['D']),
        createTicket('F', ['E']),
      ];
      graph.build(tickets);

      const cycles = graph.detectCycles();
      expect(cycles.length).toBeGreaterThan(0);
    });
  });

  describe('areDependenciesMet', () => {
    test('returns true for ticket with no dependencies', () => {
      const tickets = [createTicket('T001')];
      graph.build(tickets);

      expect(graph.areDependenciesMet('T001', new Set())).toBe(true);
    });

    test('returns true when all dependencies are in done set', () => {
      const tickets = [
        createTicket('T001'),
        createTicket('T002', ['T001']),
      ];
      graph.build(tickets);

      expect(graph.areDependenciesMet('T002', new Set(['T001']))).toBe(true);
    });

    test('returns false when any dependency is missing from done set', () => {
      const tickets = [
        createTicket('T001'),
        createTicket('T002'),
        createTicket('T003', ['T001', 'T002']),
      ];
      graph.build(tickets);

      expect(graph.areDependenciesMet('T003', new Set(['T001']))).toBe(false);
    });

    test('returns true for unknown ticket (no dependencies)', () => {
      graph.build([]);
      expect(graph.areDependenciesMet('UNKNOWN', new Set())).toBe(true);
    });
  });

  describe('updateTicketStatus', () => {
    test('updates ticket status in the graph', () => {
      const tickets = [
        createTicket('T001', [], 'Todo'),
        createTicket('T002', ['T001'], 'Todo'),
      ];
      graph.build(tickets);

      // Initially T001 is ready
      let ready = graph.getReadyTickets();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe('T001');

      // Mark T001 as Done
      graph.updateTicketStatus('T001', 'Done');

      // Now T002 should be ready
      ready = graph.getReadyTickets();
      expect(ready.length).toBe(1);
      expect(ready[0].id).toBe('T002');
    });

    test('does nothing for unknown ticket', () => {
      const tickets = [createTicket('T001')];
      graph.build(tickets);

      // Should not throw
      graph.updateTicketStatus('UNKNOWN', 'Done');
      expect(graph.getTicket('T001')?.status).toBe('Todo');
    });
  });

  describe('getTopologicalOrder', () => {
    test('returns correct order for linear dependencies', () => {
      const tickets = [
        createTicket('A', []),
        createTicket('B', ['A']),
        createTicket('C', ['B']),
      ];
      graph.build(tickets);

      const order = graph.getTopologicalOrder();
      const aIndex = order.indexOf('A');
      const bIndex = order.indexOf('B');
      const cIndex = order.indexOf('C');

      expect(aIndex).toBeLessThan(bIndex);
      expect(bIndex).toBeLessThan(cIndex);
    });

    test('returns valid order for diamond dependencies', () => {
      //     A
      //    / \
      //   B   C
      //    \ /
      //     D
      const tickets = [
        createTicket('A', []),
        createTicket('B', ['A']),
        createTicket('C', ['A']),
        createTicket('D', ['B', 'C']),
      ];
      graph.build(tickets);

      const order = graph.getTopologicalOrder();
      const aIndex = order.indexOf('A');
      const bIndex = order.indexOf('B');
      const cIndex = order.indexOf('C');
      const dIndex = order.indexOf('D');

      expect(aIndex).toBeLessThan(bIndex);
      expect(aIndex).toBeLessThan(cIndex);
      expect(bIndex).toBeLessThan(dIndex);
      expect(cIndex).toBeLessThan(dIndex);
    });

    test('throws error for cyclic graph', () => {
      const tickets = [
        createTicket('A', ['B']),
        createTicket('B', ['A']),
      ];
      graph.build(tickets);

      expect(() => graph.getTopologicalOrder()).toThrow(
        /circular dependencies detected/i
      );
    });

    test('returns all nodes for graph with no dependencies', () => {
      const tickets = [
        createTicket('A'),
        createTicket('B'),
        createTicket('C'),
      ];
      graph.build(tickets);

      const order = graph.getTopologicalOrder();
      expect(order.length).toBe(3);
      expect(order.sort()).toEqual(['A', 'B', 'C']);
    });
  });

  describe('getTicket', () => {
    test('returns ticket by ID', () => {
      const tickets = [createTicket('T001')];
      graph.build(tickets);

      const ticket = graph.getTicket('T001');
      expect(ticket).toBeDefined();
      expect(ticket?.id).toBe('T001');
    });

    test('returns undefined for unknown ticket', () => {
      graph.build([]);
      expect(graph.getTicket('UNKNOWN')).toBeUndefined();
    });
  });

  describe('getDependencies', () => {
    test('returns direct dependencies', () => {
      const tickets = [
        createTicket('A'),
        createTicket('B', ['A']),
        createTicket('C', ['A', 'B']),
      ];
      graph.build(tickets);

      expect(graph.getDependencies('A')).toEqual([]);
      expect(graph.getDependencies('B')).toEqual(['A']);
      expect(graph.getDependencies('C').sort()).toEqual(['A', 'B']);
    });

    test('returns empty array for unknown ticket', () => {
      graph.build([]);
      expect(graph.getDependencies('UNKNOWN')).toEqual([]);
    });
  });

  describe('getDependents', () => {
    test('returns tickets that depend on given ticket', () => {
      const tickets = [
        createTicket('A'),
        createTicket('B', ['A']),
        createTicket('C', ['A']),
      ];
      graph.build(tickets);

      expect(graph.getDependents('A').sort()).toEqual(['B', 'C']);
      expect(graph.getDependents('B')).toEqual([]);
      expect(graph.getDependents('C')).toEqual([]);
    });

    test('returns empty array for unknown ticket', () => {
      graph.build([]);
      expect(graph.getDependents('UNKNOWN')).toEqual([]);
    });
  });
});
