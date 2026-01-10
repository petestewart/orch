/**
 * Epic Manager
 *
 * Manages epic directories and git worktrees for parallel agent work.
 *
 * Implements: T031, T032, T033
 */

import type { Epic, Worktree, Ticket, BaseEvent } from './types';
import { getEventBus } from './events';
import { join, resolve } from 'path';
import { existsSync } from 'fs';

export interface WorktreeAllocation {
  worktreePath: string;
  branch: string;
  isNew: boolean;
}

export interface EpicWorktreeCreatedEvent extends BaseEvent {
  type: 'epic:worktree-created';
  epicName: string;
  worktreePath: string;
  agentId: string;
  ticketId: string;
  branch: string;
}

export interface EpicWorktreeMergedEvent extends BaseEvent {
  type: 'epic:worktree-merged';
  epicName: string;
  worktreePath: string;
  ticketId: string;
  branch: string;
}

export interface EpicConflictEvent extends BaseEvent {
  type: 'epic:conflict';
  epicName: string;
  worktreePath: string;
  ticketId: string;
  conflictFiles: string[];
}

export class EpicManager {
  private projectRoot: string;
  private epics: Map<string, Epic> = new Map();
  private worktrees: Map<string, Worktree> = new Map();
  private epicAgentCounts: Map<string, number> = new Map();
  private maxWorktreesPerEpic: number;
  private autoCreateWorktrees: boolean;

  constructor(
    projectRoot: string,
    options?: {
      maxWorktreesPerEpic?: number;
      autoCreateWorktrees?: boolean;
    }
  ) {
    this.projectRoot = projectRoot;
    this.maxWorktreesPerEpic = options?.maxWorktreesPerEpic ?? 3;
    this.autoCreateWorktrees = options?.autoCreateWorktrees ?? true;
  }

  /**
   * Discover unique epics from tickets
   */
  discoverEpics(tickets: Ticket[]): Epic[] {
    const epicNames = new Set<string>();
    for (const ticket of tickets) {
      if (ticket.epic) {
        epicNames.add(ticket.epic);
      }
    }

    const epics: Epic[] = [];
    for (const name of epicNames) {
      // Default path is the epic name as a subdirectory
      // This can be overridden when initializing with explicit Epic objects
      epics.push({
        name,
        path: name,
      });
    }

    return epics;
  }

  /**
   * Validate that epic directories exist
   */
  async validateEpicDirectories(epics: Epic[]): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    for (const epic of epics) {
      const fullPath = resolve(this.projectRoot, epic.path);
      if (!existsSync(fullPath)) {
        errors.push(`Epic directory not found: ${epic.name} (${fullPath})`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Initialize with epics from plan
   */
  async initialize(epics: Epic[]): Promise<void> {
    // Store epics
    this.epics.clear();
    for (const epic of epics) {
      this.epics.set(epic.name, epic);
      this.epicAgentCounts.set(epic.name, 0);
    }

    // Validate paths exist
    const validation = await this.validateEpicDirectories(epics);
    if (!validation.valid) {
      // Log warnings but don't throw - epics may be created during work
      for (const error of validation.errors) {
        console.warn(`Warning: ${error}`);
      }
    }

    // Check for existing worktrees
    const existingWorktrees = await listWorktrees(this.projectRoot);
    // Parse existing worktrees and track them if they match our pattern
    for (const wtPath of existingWorktrees) {
      // Skip the main worktree
      if (wtPath === this.projectRoot) continue;

      // Check if it matches our naming pattern: {epic}-worktree-{agent-id}
      const pathParts = wtPath.split('/');
      const dirName = pathParts[pathParts.length - 1];
      const match = dirName.match(/^(.+)-worktree-(.+)$/);
      if (match) {
        const [, epicName, agentId] = match;
        if (this.epics.has(epicName)) {
          // Track this worktree (we don't have ticket info from just the filesystem)
          const count = this.epicAgentCounts.get(epicName) || 0;
          this.epicAgentCounts.set(epicName, count + 1);
        }
      }
    }
  }

  /**
   * Get epic by name
   */
  getEpic(name: string): Epic | undefined {
    return this.epics.get(name);
  }

  /**
   * Get all epics
   */
  getAllEpics(): Epic[] {
    return Array.from(this.epics.values());
  }

  /**
   * Allocate a working directory for an agent on a ticket
   * Creates worktree if needed
   */
  async allocateWorktree(
    ticket: Ticket,
    agentId: string
  ): Promise<WorktreeAllocation> {
    const epicName = ticket.epic;

    // If no epic specified, use project root
    if (!epicName) {
      return {
        worktreePath: this.projectRoot,
        branch: 'main',
        isNew: false,
      };
    }

    const epic = this.epics.get(epicName);
    if (!epic) {
      throw new Error(`Epic not found: ${epicName}`);
    }

    const currentCount = this.epicAgentCounts.get(epicName) || 0;

    // If no agents in this epic yet, use the main epic directory
    if (currentCount === 0) {
      this.epicAgentCounts.set(epicName, 1);

      // Track this allocation (no separate worktree, using main dir)
      const worktree: Worktree = {
        path: resolve(this.projectRoot, epic.path),
        epicName,
        agentId,
        ticketId: ticket.id,
        branch: `ticket/${ticket.id}`,
        createdAt: new Date(),
      };
      this.worktrees.set(agentId, worktree);

      return {
        worktreePath: resolve(this.projectRoot, epic.path),
        branch: `ticket/${ticket.id}`,
        isNew: false,
      };
    }

    // If we have agents and auto-create is disabled, throw
    if (!this.autoCreateWorktrees) {
      throw new Error(`Epic ${epicName} already has an active agent and worktree auto-creation is disabled`);
    }

    // Check worktree limit
    if (currentCount >= this.maxWorktreesPerEpic) {
      throw new Error(`Epic ${epicName} has reached maximum worktrees (${this.maxWorktreesPerEpic})`);
    }

    // Create a new worktree
    const worktreePath = resolve(this.projectRoot, `${epicName}-worktree-${agentId}`);
    const branch = `ticket/${ticket.id}`;

    await createWorktree(this.projectRoot, worktreePath, branch);

    // Track the new worktree
    this.epicAgentCounts.set(epicName, currentCount + 1);
    const worktree: Worktree = {
      path: worktreePath,
      epicName,
      agentId,
      ticketId: ticket.id,
      branch,
      createdAt: new Date(),
    };
    this.worktrees.set(agentId, worktree);

    // Emit event
    const eventBus = getEventBus();
    eventBus.publish({
      type: 'epic:worktree-created',
      timestamp: new Date(),
      epicName,
      worktreePath,
      agentId,
      ticketId: ticket.id,
      branch,
    } as EpicWorktreeCreatedEvent);

    return {
      worktreePath,
      branch,
      isNew: true,
    };
  }

  /**
   * Release a worktree after agent completes
   */
  async releaseWorktree(agentId: string): Promise<void> {
    const worktree = this.worktrees.get(agentId);
    if (!worktree) {
      // Agent may not have had a worktree (e.g., worked in project root)
      return;
    }

    // Decrement epic agent count
    const currentCount = this.epicAgentCounts.get(worktree.epicName) || 0;
    if (currentCount > 0) {
      this.epicAgentCounts.set(worktree.epicName, currentCount - 1);
    }

    // Remove from active worktrees
    this.worktrees.delete(agentId);

    // Note: We don't delete the worktree here - that's handled by cleanupWorktree
    // or mergeWorktree which are part of T032
  }

  /**
   * Merge a completed worktree back to epic main branch
   */
  async mergeWorktree(worktreePath: string): Promise<MergeResult> {
    // TODO: Implement - T032
    // - Get worktree info
    // - Attempt git merge
    // - If conflict, emit epic:conflict
    // - If success, emit epic:worktree-merged
    // - Optionally cleanup worktree
    throw new Error('Not implemented');
  }

  /**
   * Clean up a worktree
   */
  async cleanupWorktree(worktreePath: string): Promise<void> {
    // TODO: Implement - T032
    // - git worktree remove
    // - Delete from tracking
    throw new Error('Not implemented');
  }

  /**
   * Clean up all stale worktrees
   */
  async cleanupStaleWorktrees(): Promise<void> {
    // TODO: Implement - T032
    // - Find worktrees with no active agent
    // - That are older than threshold
    // - Clean them up
    throw new Error('Not implemented');
  }

  /**
   * Get active worktrees for an epic
   */
  getWorktreesForEpic(epicName: string): Worktree[] {
    return Array.from(this.worktrees.values())
      .filter(w => w.epicName === epicName);
  }

  /**
   * Get worktree for an agent
   */
  getWorktreeForAgent(agentId: string): Worktree | undefined {
    return Array.from(this.worktrees.values())
      .find(w => w.agentId === agentId);
  }

  /**
   * Check if epic can accept more agents
   */
  canAcceptAgent(epicName: string): boolean {
    const count = this.epicAgentCounts.get(epicName) || 0;
    const epic = this.epics.get(epicName);
    if (!epic) return false;

    // If at main dir, can create worktree
    if (count === 0) return true;

    // If auto-create disabled, can't add more
    if (!this.autoCreateWorktrees) return count === 0;

    // Check worktree limit
    return count < this.maxWorktreesPerEpic;
  }
}

// =============================================================================
// Git operations
// =============================================================================

export interface MergeResult {
  success: boolean;
  hasConflicts: boolean;
  conflictFiles?: string[];
  mergedCommit?: string;
}

/**
 * Create a new git worktree
 */
export async function createWorktree(
  repoPath: string,
  worktreePath: string,
  branch: string
): Promise<void> {
  const proc = Bun.spawn(['git', 'worktree', 'add', '-b', branch, worktreePath], {
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to create worktree: ${stderr}`);
  }
}

/**
 * Remove a git worktree
 */
export async function removeWorktree(worktreePath: string): Promise<void> {
  // TODO: Implement - T032
  // - git worktree remove {path}
  throw new Error('Not implemented');
}

/**
 * List all worktrees in a repo
 */
export async function listWorktrees(repoPath: string): Promise<string[]> {
  const proc = Bun.spawn(['git', 'worktree', 'list', '--porcelain'], {
    cwd: repoPath,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    // Not a git repo or other git error - return empty array
    // This allows ORCH to work in non-git directories
    return [];
  }

  const stdout = await new Response(proc.stdout).text();

  // Parse porcelain output - each worktree starts with "worktree <path>"
  const worktrees: string[] = [];
  const lines = stdout.split('\n');

  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      worktrees.push(line.substring('worktree '.length));
    }
  }

  return worktrees;
}

/**
 * Merge a branch into main
 */
export async function mergeBranch(
  repoPath: string,
  branchName: string
): Promise<MergeResult> {
  // TODO: Implement - T032
  // - git checkout main
  // - git merge {branch}
  // - Check for conflicts
  throw new Error('Not implemented');
}

/**
 * Get git diff for a ticket branch
 */
export async function getTicketDiff(
  worktreePath: string,
  baseBranch?: string
): Promise<string> {
  // TODO: Implement - T026 (for review agent)
  // - git diff {base}..HEAD
  throw new Error('Not implemented');
}
