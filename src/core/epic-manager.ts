/**
 * Epic Manager
 *
 * Manages epic directories and git worktrees for parallel agent work.
 *
 * Implements: T031, T032, T033
 */

import type { Epic, Worktree, Ticket } from './types';
import { getEventBus } from './events';

export interface WorktreeAllocation {
  worktreePath: string;
  branch: string;
  isNew: boolean;
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
   * Initialize with epics from plan
   */
  async initialize(epics: Epic[]): Promise<void> {
    // TODO: Implement - T031
    // - Store epics
    // - Validate paths exist
    // - Check git status of each epic
    throw new Error('Not implemented');
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
    // TODO: Implement - T031, T033
    // - Get epic for ticket
    // - Check if epic has active agents
    // - If yes and autoCreate enabled, create new worktree
    // - If no, use main epic directory
    // - Track allocation
    // - Emit epic:worktree-created if new
    throw new Error('Not implemented');
  }

  /**
   * Release a worktree after agent completes
   */
  async releaseWorktree(agentId: string): Promise<void> {
    // TODO: Implement - T031
    // - Find worktree for agent
    // - Decrement epic agent count
    // - Mark worktree as available (don't delete yet)
    throw new Error('Not implemented');
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
  // TODO: Implement - T031
  // - git worktree add -b {branch} {path}
  throw new Error('Not implemented');
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
  // TODO: Implement - T031
  // - git worktree list --porcelain
  throw new Error('Not implemented');
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
