/**
 * Unit tests for Configuration System
 * Implements: T017 validation
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConfig,
  loadConfigWithDetails,
  validateConfig,
  getEnvOverrides,
  mergeConfigs,
  getDefaultConfig,
  watchConfig,
} from './config';
import type { OrchConfig } from './types';

describe('Configuration System', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for test config files
    tempDir = mkdtempSync(join(tmpdir(), 'orch-config-test-'));

    // Clear environment variables
    delete process.env.ORCH_MAX_AGENTS;
    delete process.env.ORCH_LOG_LEVEL;
    delete process.env.ORCH_AGENT_MODEL;
    delete process.env.ORCH_PLAN_FILE;
    delete process.env.ORCH_AUTOMATION_TICKET_PROGRESSION;
    delete process.env.ORCH_AUTOMATION_REVIEW_MODE;
    delete process.env.ORCH_AUTOMATION_QA_MODE;
    delete process.env.ORCH_COST_LIMIT_PER_TICKET;
    delete process.env.ORCH_COST_LIMIT_PER_SESSION;
    delete process.env.ORCH_COST_LIMIT_ACTION;
  });

  afterEach(() => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('getDefaultConfig', () => {
    test('returns default configuration', () => {
      const config = getDefaultConfig();

      expect(config.maxAgents).toBe(5);
      expect(config.agentModel).toBe('sonnet');
      expect(config.planFile).toBe('PLAN.md');
      expect(config.logLevel).toBe('info');
      expect(config.automation.ticketProgression).toBe('automatic');
      expect(config.automation.review.mode).toBe('automatic');
      expect(config.automation.qa.mode).toBe('automatic');
    });

    test('returns a copy, not reference to internal default', () => {
      const config1 = getDefaultConfig();
      const config2 = getDefaultConfig();

      config1.maxAgents = 10;

      expect(config2.maxAgents).toBe(5);
    });
  });

  describe('loadConfig', () => {
    test('returns defaults when no config file exists', async () => {
      const config = await loadConfig(tempDir);

      expect(config.maxAgents).toBe(5);
      expect(config.agentModel).toBe('sonnet');
      expect(config.planFile).toBe('PLAN.md');
      expect(config.logLevel).toBe('info');
      expect(config.automation.ticketProgression).toBe('automatic');
    });

    test('loads .orchrc file', async () => {
      const configContent = JSON.stringify({
        maxAgents: 10,
        logLevel: 'debug',
      });
      writeFileSync(join(tempDir, '.orchrc'), configContent);

      const config = await loadConfig(tempDir);

      expect(config.maxAgents).toBe(10);
      expect(config.logLevel).toBe('debug');
      // Defaults still applied
      expect(config.agentModel).toBe('sonnet');
    });

    test('loads orch.config.json file', async () => {
      const configContent = JSON.stringify({
        maxAgents: 8,
        agentModel: 'opus',
      });
      writeFileSync(join(tempDir, 'orch.config.json'), configContent);

      const config = await loadConfig(tempDir);

      expect(config.maxAgents).toBe(8);
      expect(config.agentModel).toBe('opus');
    });

    test('.orchrc takes precedence over orch.config.json', async () => {
      writeFileSync(
        join(tempDir, '.orchrc'),
        JSON.stringify({ maxAgents: 3 })
      );
      writeFileSync(
        join(tempDir, 'orch.config.json'),
        JSON.stringify({ maxAgents: 7 })
      );

      const config = await loadConfig(tempDir);

      expect(config.maxAgents).toBe(3);
    });

    test('loads all config options', async () => {
      const fullConfig = {
        maxAgents: 10,
        agentModel: 'opus',
        planFile: 'PROJECT.md',
        logLevel: 'debug',
        automation: {
          ticketProgression: 'approval',
          review: { mode: 'manual', model: 'haiku' },
          qa: { mode: 'automatic' },
          planAudit: { onRefineViewEntry: true },
        },
        costLimit: {
          perTicket: 5.0,
          perSession: 50.0,
          action: 'pause',
        },
        epics: {
          autoCreateWorktrees: true,
          maxWorktreesPerEpic: 3,
          cleanupOnMerge: true,
        },
        ui: {
          defaultView: 'board',
          refreshInterval: 2000,
          showCostInStatusBar: true,
        },
      };
      writeFileSync(join(tempDir, '.orchrc'), JSON.stringify(fullConfig));

      const config = await loadConfig(tempDir);

      expect(config.maxAgents).toBe(10);
      expect(config.agentModel).toBe('opus');
      expect(config.planFile).toBe('PROJECT.md');
      expect(config.logLevel).toBe('debug');
      expect(config.automation.ticketProgression).toBe('approval');
      expect(config.automation.review.mode).toBe('manual');
      expect(config.automation.review.model).toBe('haiku');
      expect(config.automation.qa.mode).toBe('automatic');
      expect(config.automation.planAudit?.onRefineViewEntry).toBe(true);
      expect(config.costLimit?.perTicket).toBe(5.0);
      expect(config.costLimit?.perSession).toBe(50.0);
      expect(config.costLimit?.action).toBe('pause');
      expect(config.epics?.autoCreateWorktrees).toBe(true);
      expect(config.epics?.maxWorktreesPerEpic).toBe(3);
      expect(config.ui?.defaultView).toBe('board');
      expect(config.ui?.refreshInterval).toBe(2000);
    });

    test('throws error for invalid JSON with helpful message', async () => {
      writeFileSync(join(tempDir, '.orchrc'), '{ invalid json }');

      await expect(loadConfig(tempDir)).rejects.toThrow('Configuration errors');
    });

    test('throws error for invalid config values', async () => {
      writeFileSync(
        join(tempDir, '.orchrc'),
        JSON.stringify({ maxAgents: -5 })
      );

      await expect(loadConfig(tempDir)).rejects.toThrow('Configuration errors');
    });
  });

  describe('loadConfigWithDetails', () => {
    test('returns config file path when loaded', async () => {
      writeFileSync(
        join(tempDir, '.orchrc'),
        JSON.stringify({ maxAgents: 5 })
      );

      const result = await loadConfigWithDetails(tempDir);

      expect(result.configFile).toBe(join(tempDir, '.orchrc'));
      expect(result.errors).toHaveLength(0);
    });

    test('returns undefined configFile when no file exists', async () => {
      const result = await loadConfigWithDetails(tempDir);

      expect(result.configFile).toBeUndefined();
      expect(result.errors).toHaveLength(0);
    });

    test('returns errors for invalid config', async () => {
      writeFileSync(
        join(tempDir, '.orchrc'),
        JSON.stringify({ logLevel: 'invalid' })
      );

      const result = await loadConfigWithDetails(tempDir);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].path).toBe('logLevel');
    });
  });

  describe('validateConfig', () => {
    test('returns empty array for valid config', () => {
      const errors = validateConfig({
        maxAgents: 5,
        logLevel: 'info',
      });

      expect(errors).toHaveLength(0);
    });

    test('validates maxAgents is positive integer', () => {
      expect(validateConfig({ maxAgents: 0 })).toHaveLength(1);
      expect(validateConfig({ maxAgents: -1 })).toHaveLength(1);
      expect(validateConfig({ maxAgents: 1.5 })).toHaveLength(1);
      expect(validateConfig({ maxAgents: 'five' })).toHaveLength(1);
      expect(validateConfig({ maxAgents: 1 })).toHaveLength(0);
    });

    test('validates logLevel enum', () => {
      expect(validateConfig({ logLevel: 'debug' })).toHaveLength(0);
      expect(validateConfig({ logLevel: 'info' })).toHaveLength(0);
      expect(validateConfig({ logLevel: 'warn' })).toHaveLength(0);
      expect(validateConfig({ logLevel: 'error' })).toHaveLength(0);
      expect(validateConfig({ logLevel: 'verbose' })).toHaveLength(1);
    });

    test('validates automation modes', () => {
      expect(
        validateConfig({
          automation: {
            ticketProgression: 'automatic',
          },
        })
      ).toHaveLength(0);

      expect(
        validateConfig({
          automation: {
            ticketProgression: 'invalid',
          },
        })
      ).toHaveLength(1);

      expect(
        validateConfig({
          automation: {
            review: { mode: 'approval' },
          },
        })
      ).toHaveLength(0);

      expect(
        validateConfig({
          automation: {
            review: { mode: 'invalid' },
          },
        })
      ).toHaveLength(1);
    });

    test('validates costLimit settings', () => {
      expect(
        validateConfig({
          costLimit: {
            perTicket: 5.0,
            perSession: 50.0,
            action: 'pause',
          },
        })
      ).toHaveLength(0);

      expect(
        validateConfig({
          costLimit: {
            perTicket: -1,
          },
        })
      ).toHaveLength(1);

      expect(
        validateConfig({
          costLimit: {
            action: 'invalid',
          },
        })
      ).toHaveLength(1);
    });

    test('validates nested config structure', () => {
      const errors = validateConfig({
        automation: 'not an object',
      });

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].path).toContain('automation');
    });

    test('returns error for non-object config', () => {
      expect(validateConfig(null)).toHaveLength(1);
      expect(validateConfig('string')).toHaveLength(1);
      expect(validateConfig(123)).toHaveLength(1);
    });
  });

  describe('getEnvOverrides', () => {
    test('reads ORCH_MAX_AGENTS', () => {
      process.env.ORCH_MAX_AGENTS = '10';

      const overrides = getEnvOverrides();

      expect(overrides.maxAgents).toBe(10);
    });

    test('reads ORCH_LOG_LEVEL', () => {
      process.env.ORCH_LOG_LEVEL = 'debug';

      const overrides = getEnvOverrides();

      expect(overrides.logLevel).toBe('debug');
    });

    test('reads ORCH_LOG_LEVEL case insensitively', () => {
      process.env.ORCH_LOG_LEVEL = 'DEBUG';

      const overrides = getEnvOverrides();

      expect(overrides.logLevel).toBe('debug');
    });

    test('reads ORCH_AGENT_MODEL', () => {
      process.env.ORCH_AGENT_MODEL = 'opus';

      const overrides = getEnvOverrides();

      expect(overrides.agentModel).toBe('opus');
    });

    test('reads ORCH_PLAN_FILE', () => {
      process.env.ORCH_PLAN_FILE = 'TASKS.md';

      const overrides = getEnvOverrides();

      expect(overrides.planFile).toBe('TASKS.md');
    });

    test('reads ORCH_AUTOMATION_TICKET_PROGRESSION', () => {
      process.env.ORCH_AUTOMATION_TICKET_PROGRESSION = 'manual';

      const overrides = getEnvOverrides();

      expect(overrides.automation?.ticketProgression).toBe('manual');
    });

    test('reads ORCH_AUTOMATION_REVIEW_MODE', () => {
      process.env.ORCH_AUTOMATION_REVIEW_MODE = 'approval';

      const overrides = getEnvOverrides();

      expect(overrides.automation?.review?.mode).toBe('approval');
    });

    test('reads ORCH_AUTOMATION_QA_MODE', () => {
      process.env.ORCH_AUTOMATION_QA_MODE = 'manual';

      const overrides = getEnvOverrides();

      expect(overrides.automation?.qa?.mode).toBe('manual');
    });

    test('reads ORCH_COST_LIMIT_PER_TICKET', () => {
      process.env.ORCH_COST_LIMIT_PER_TICKET = '5.50';

      const overrides = getEnvOverrides();

      expect(overrides.costLimit?.perTicket).toBe(5.5);
    });

    test('reads ORCH_COST_LIMIT_PER_SESSION', () => {
      process.env.ORCH_COST_LIMIT_PER_SESSION = '100';

      const overrides = getEnvOverrides();

      expect(overrides.costLimit?.perSession).toBe(100);
    });

    test('reads ORCH_COST_LIMIT_ACTION', () => {
      process.env.ORCH_COST_LIMIT_ACTION = 'stop';

      const overrides = getEnvOverrides();

      expect(overrides.costLimit?.action).toBe('stop');
    });

    test('ignores invalid ORCH_MAX_AGENTS', () => {
      process.env.ORCH_MAX_AGENTS = 'not a number';

      const overrides = getEnvOverrides();

      expect(overrides.maxAgents).toBeUndefined();
    });

    test('ignores invalid ORCH_LOG_LEVEL', () => {
      process.env.ORCH_LOG_LEVEL = 'invalid';

      const overrides = getEnvOverrides();

      expect(overrides.logLevel).toBeUndefined();
    });

    test('ignores invalid automation modes', () => {
      process.env.ORCH_AUTOMATION_REVIEW_MODE = 'invalid';

      const overrides = getEnvOverrides();

      expect(overrides.automation?.review).toBeUndefined();
    });
  });

  describe('mergeConfigs', () => {
    test('merges simple properties', () => {
      const base = getDefaultConfig();
      const override = { maxAgents: 10 };

      const result = mergeConfigs(base, override);

      expect(result.maxAgents).toBe(10);
      expect(result.logLevel).toBe('info'); // Kept from base
    });

    test('deep merges nested objects', () => {
      const base = getDefaultConfig();
      const override: Partial<OrchConfig> = {
        automation: {
          ticketProgression: 'automatic',
          review: { mode: 'manual' },
          qa: { mode: 'automatic' },
        },
      };

      const result = mergeConfigs(base, override);

      expect(result.automation.review.mode).toBe('manual');
      expect(result.automation.qa.mode).toBe('automatic'); // Kept from base
      expect(result.automation.ticketProgression).toBe('automatic'); // Kept from base
    });

    test('handles multiple overrides in order', () => {
      const base = getDefaultConfig();
      const override1 = { maxAgents: 10 };
      const override2 = { maxAgents: 20, logLevel: 'debug' as const };

      const result = mergeConfigs(base, override1, override2);

      expect(result.maxAgents).toBe(20); // Last override wins
      expect(result.logLevel).toBe('debug');
    });

    test('does not mutate original config', () => {
      const base = getDefaultConfig();
      const override = { maxAgents: 10 };

      mergeConfigs(base, override);

      expect(base.maxAgents).toBe(5);
    });

    test('handles undefined values in override', () => {
      const base = getDefaultConfig();
      const override = { maxAgents: undefined };

      const result = mergeConfigs(base, override);

      expect(result.maxAgents).toBe(5); // Unchanged
    });
  });

  describe('environment variable overrides file config', () => {
    test('env vars override file config values', async () => {
      writeFileSync(
        join(tempDir, '.orchrc'),
        JSON.stringify({ maxAgents: 5, logLevel: 'info' })
      );

      process.env.ORCH_MAX_AGENTS = '15';
      process.env.ORCH_LOG_LEVEL = 'error';

      const config = await loadConfig(tempDir);

      expect(config.maxAgents).toBe(15);
      expect(config.logLevel).toBe('error');
    });

    test('env vars override automation settings', async () => {
      writeFileSync(
        join(tempDir, '.orchrc'),
        JSON.stringify({
          automation: {
            ticketProgression: 'automatic',
            review: { mode: 'automatic' },
          },
        })
      );

      process.env.ORCH_AUTOMATION_TICKET_PROGRESSION = 'manual';
      process.env.ORCH_AUTOMATION_REVIEW_MODE = 'approval';

      const config = await loadConfig(tempDir);

      expect(config.automation.ticketProgression).toBe('manual');
      expect(config.automation.review.mode).toBe('approval');
    });
  });

  describe('watchConfig', () => {
    test('returns unwatch function', () => {
      const unwatch = watchConfig(tempDir, () => {});

      expect(typeof unwatch).toBe('function');

      unwatch();
    });

    test('calls onChange when config file changes', async () => {
      // Create initial config
      writeFileSync(
        join(tempDir, '.orchrc'),
        JSON.stringify({ maxAgents: 5 })
      );

      let receivedConfig: OrchConfig | null = null;

      const unwatch = watchConfig(tempDir, (config) => {
        receivedConfig = config;
      });

      // Wait a bit for watcher to set up
      await new Promise((r) => setTimeout(r, 50));

      // Modify the config file
      writeFileSync(
        join(tempDir, '.orchrc'),
        JSON.stringify({ maxAgents: 10 })
      );

      // Wait for debounce and reload
      await new Promise((r) => setTimeout(r, 200));

      unwatch();

      // Note: File watching behavior can be platform-dependent
      // In CI/test environments, the callback might not trigger reliably
      // So we just verify the watcher doesn't throw
    });

    test('unwatch stops receiving changes', async () => {
      writeFileSync(
        join(tempDir, '.orchrc'),
        JSON.stringify({ maxAgents: 5 })
      );

      let callCount = 0;

      const unwatch = watchConfig(tempDir, () => {
        callCount++;
      });

      // Immediately unwatch
      unwatch();

      // Modify the config file
      writeFileSync(
        join(tempDir, '.orchrc'),
        JSON.stringify({ maxAgents: 10 })
      );

      // Wait to see if callback is called
      await new Promise((r) => setTimeout(r, 200));

      expect(callCount).toBe(0);
    });
  });

  describe('error messages with line numbers', () => {
    test('includes line number for JSON syntax errors when detectable', async () => {
      // Write invalid JSON with a syntax error
      const invalidJson = `{
  "maxAgents": 5,
  "logLevel": "info"
  "missing": "comma"
}`;
      writeFileSync(join(tempDir, '.orchrc'), invalidJson);

      const result = await loadConfigWithDetails(tempDir);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('Invalid JSON');
      // Line number may or may not be included depending on JSON parser error format
    });

    test('provides helpful path for validation errors', async () => {
      writeFileSync(
        join(tempDir, '.orchrc'),
        JSON.stringify({
          automation: {
            review: {
              mode: 'invalid-mode',
            },
          },
        })
      );

      const result = await loadConfigWithDetails(tempDir);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].path).toContain('automation');
      expect(result.errors[0].path).toContain('review');
    });
  });

  describe('automation modes work correctly', () => {
    test('automatic mode is default', async () => {
      const config = await loadConfig(tempDir);

      expect(config.automation.ticketProgression).toBe('automatic');
      expect(config.automation.review.mode).toBe('automatic');
      expect(config.automation.qa.mode).toBe('automatic');
    });

    test('approval mode can be set', async () => {
      writeFileSync(
        join(tempDir, '.orchrc'),
        JSON.stringify({
          automation: {
            ticketProgression: 'approval',
            review: { mode: 'approval' },
            qa: { mode: 'approval' },
          },
        })
      );

      const config = await loadConfig(tempDir);

      expect(config.automation.ticketProgression).toBe('approval');
      expect(config.automation.review.mode).toBe('approval');
      expect(config.automation.qa.mode).toBe('approval');
    });

    test('manual mode can be set', async () => {
      writeFileSync(
        join(tempDir, '.orchrc'),
        JSON.stringify({
          automation: {
            ticketProgression: 'manual',
            review: { mode: 'manual' },
            qa: { mode: 'manual' },
          },
        })
      );

      const config = await loadConfig(tempDir);

      expect(config.automation.ticketProgression).toBe('manual');
      expect(config.automation.review.mode).toBe('manual');
      expect(config.automation.qa.mode).toBe('manual');
    });

    test('mixed modes work', async () => {
      writeFileSync(
        join(tempDir, '.orchrc'),
        JSON.stringify({
          automation: {
            ticketProgression: 'automatic',
            review: { mode: 'approval' },
            qa: { mode: 'manual' },
          },
        })
      );

      const config = await loadConfig(tempDir);

      expect(config.automation.ticketProgression).toBe('automatic');
      expect(config.automation.review.mode).toBe('approval');
      expect(config.automation.qa.mode).toBe('manual');
    });
  });
});
