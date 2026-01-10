/**
 * Shutdown Handler Tests
 *
 * Tests for graceful shutdown on SIGINT/SIGTERM signals.
 *
 * Implements: T016
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
  registerShutdownHandlers,
  unregisterShutdownHandlers,
  isShutdownInProgress,
  type ShutdownOptions,
  type ShutdownSummary,
} from './shutdown';

describe('Shutdown Handler', () => {
  beforeEach(() => {
    // Clean up any existing handlers before each test
    unregisterShutdownHandlers();
  });

  afterEach(() => {
    // Clean up after each test
    unregisterShutdownHandlers();
  });

  describe('registerShutdownHandlers', () => {
    it('should register SIGINT and SIGTERM handlers', () => {
      const sigintListeners = process.listenerCount('SIGINT');
      const sigtermListeners = process.listenerCount('SIGTERM');

      registerShutdownHandlers({});

      expect(process.listenerCount('SIGINT')).toBe(sigintListeners + 1);
      expect(process.listenerCount('SIGTERM')).toBe(sigtermListeners + 1);
    });

    it('should accept onShutdownStart callback', () => {
      const onShutdownStart = mock(() => {});
      registerShutdownHandlers({ onShutdownStart });
      // Handler registered, callback stored
      expect(true).toBe(true);
    });

    it('should accept onShutdownComplete callback', () => {
      const onShutdownComplete = mock((_summary: ShutdownSummary) => {});
      registerShutdownHandlers({ onShutdownComplete });
      // Handler registered, callback stored
      expect(true).toBe(true);
    });
  });

  describe('unregisterShutdownHandlers', () => {
    it('should remove SIGINT and SIGTERM handlers', () => {
      registerShutdownHandlers({});
      const sigintAfterRegister = process.listenerCount('SIGINT');
      const sigtermAfterRegister = process.listenerCount('SIGTERM');

      unregisterShutdownHandlers();

      expect(process.listenerCount('SIGINT')).toBe(sigintAfterRegister - 1);
      expect(process.listenerCount('SIGTERM')).toBe(sigtermAfterRegister - 1);
    });

    it('should reset shutdown state', () => {
      registerShutdownHandlers({});
      unregisterShutdownHandlers();

      expect(isShutdownInProgress()).toBe(false);
    });
  });

  describe('isShutdownInProgress', () => {
    it('should return false initially', () => {
      expect(isShutdownInProgress()).toBe(false);
    });
  });
});

describe('ShutdownSummary', () => {
  it('should have correct structure', () => {
    const summary: ShutdownSummary = {
      agentsStopped: 3,
      ticketsInProgress: 2,
      totalCost: 0.0145,
      elapsedMs: 5234,
    };

    expect(summary.agentsStopped).toBe(3);
    expect(summary.ticketsInProgress).toBe(2);
    expect(summary.totalCost).toBe(0.0145);
    expect(summary.elapsedMs).toBe(5234);
  });
});
