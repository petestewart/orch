/**
 * Plan Audit - Automated Plan Analysis
 *
 * Identifies gaps, staleness, and inaccuracies in the project plan
 * by comparing against PRD.md and analyzing the codebase.
 *
 * Implements: T038
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import type {
  Ticket,
  AuditFinding,
  AuditResult,
  AuditFindingSeverity,
  AuditAction,
  OrchConfig,
} from './types';
import type { ParsedPlan } from './plan-store';
import { getEventBus } from './events';

export interface AuditOptions {
  /** Path to the project root */
  projectPath: string;
  /** The parsed plan */
  plan: ParsedPlan;
  /** Optional path to PRD file (defaults to PRD.md in project root) */
  prdPath?: string;
  /** Configuration */
  config?: OrchConfig;
  /** Progress callback */
  onProgress?: (phase: AuditPhase, progress: number) => void;
}

export type AuditPhase =
  | 'loading'
  | 'prd-comparison'
  | 'codebase-analysis'
  | 'dependency-check'
  | 'complete';

/**
 * Run a full plan audit
 */
export async function runPlanAudit(options: AuditOptions): Promise<AuditResult> {
  const { projectPath, plan, prdPath, onProgress } = options;
  const findings: AuditFinding[] = [];

  // Phase 1: Load PRD if available
  onProgress?.('loading', 0);
  const prdContent = loadPRD(projectPath, prdPath);

  // Phase 2: PRD comparison (if PRD exists)
  onProgress?.('prd-comparison', 20);
  if (prdContent) {
    const prdFindings = comparePlanToPRD(plan, prdContent);
    findings.push(...prdFindings);
  }

  // Phase 3: Codebase analysis
  onProgress?.('codebase-analysis', 40);
  const codebaseFindings = await analyzeCodebaseCoverage(projectPath, plan);
  findings.push(...codebaseFindings);

  // Phase 4: Dependency and staleness check
  onProgress?.('dependency-check', 70);
  const dependencyFindings = checkDependencies(plan);
  findings.push(...dependencyFindings);

  const stalenessFindings = checkStaleness(plan);
  findings.push(...stalenessFindings);

  const orphanedFindings = await checkOrphanedTickets(projectPath, plan);
  findings.push(...orphanedFindings);

  // Phase 5: Complete
  onProgress?.('complete', 100);

  // Build result summary
  const summary = {
    errors: findings.filter(f => f.severity === 'error').length,
    warnings: findings.filter(f => f.severity === 'warning').length,
    infos: findings.filter(f => f.severity === 'info').length,
  };

  const result: AuditResult = {
    findings,
    summary,
    auditedAt: new Date(),
  };

  // Emit log event
  getEventBus().publish({
    type: 'log:entry',
    timestamp: new Date(),
    level: 'info',
    message: `Plan audit complete: ${summary.errors} errors, ${summary.warnings} warnings, ${summary.infos} info`,
  });

  return result;
}

/**
 * Load PRD file content
 */
function loadPRD(projectPath: string, customPath?: string): string | null {
  const prdPath = customPath || join(projectPath, 'PRD.md');

  if (!existsSync(prdPath)) {
    return null;
  }

  try {
    return readFileSync(prdPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Compare plan tickets against PRD requirements
 */
export function comparePlanToPRD(plan: ParsedPlan, prdContent: string): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // Extract requirements from PRD
  const requirements = extractPRDRequirements(prdContent);

  // Check each requirement for coverage
  for (const req of requirements) {
    const coveringTickets = findTicketsCoveringRequirement(plan.tickets, req);

    if (coveringTickets.length === 0) {
      findings.push({
        severity: 'warning',
        category: 'coverage',
        message: `PRD requirement not covered by any ticket: "${req.text.substring(0, 100)}${req.text.length > 100 ? '...' : ''}"`,
        suggestedAction: 'create',
        suggestedTicket: {
          title: `Implement: ${req.text.substring(0, 50)}${req.text.length > 50 ? '...' : ''}`,
          description: req.text,
          priority: req.priority || 'P1',
          acceptanceCriteria: [req.text],
          validationSteps: [],
          dependencies: [],
        },
      });
    }
  }

  return findings;
}

interface PRDRequirement {
  id?: string;
  text: string;
  priority?: 'P0' | 'P1' | 'P2';
  section?: string;
}

/**
 * Extract requirements from PRD markdown content
 */
export function extractPRDRequirements(prdContent: string): PRDRequirement[] {
  const requirements: PRDRequirement[] = [];

  // Look for requirement tables (ID | Requirement | Priority format)
  const tableRowPattern = /^\|\s*([\w-]+)\s*\|\s*(.+?)\s*\|\s*(P[012])\s*\|/gm;
  let match;
  while ((match = tableRowPattern.exec(prdContent)) !== null) {
    const id = match[1].trim();
    const text = match[2].trim();
    const priority = match[3].trim() as 'P0' | 'P1' | 'P2';

    // Skip header rows
    if (id.toLowerCase() === 'id' || text.toLowerCase() === 'requirement') {
      continue;
    }

    requirements.push({ id, text, priority });
  }

  // Look for numbered requirements (1. ..., 2. ..., etc.)
  const numberedPattern = /^\d+\.\s+(.+)$/gm;
  while ((match = numberedPattern.exec(prdContent)) !== null) {
    const text = match[1].trim();
    // Skip if it looks like a section header
    if (text.length < 200 && !text.includes('---')) {
      requirements.push({ text });
    }
  }

  // Look for bullet point requirements with keywords
  const bulletPattern = /^[-*]\s+(?:System\s+)?(?:shall|must|should|can)\s+(.+)$/gim;
  while ((match = bulletPattern.exec(prdContent)) !== null) {
    const text = match[1].trim();
    requirements.push({ text: `System shall ${text}` });
  }

  // Deduplicate by text similarity
  return deduplicateRequirements(requirements);
}

/**
 * Remove duplicate or very similar requirements
 */
function deduplicateRequirements(requirements: PRDRequirement[]): PRDRequirement[] {
  const unique: PRDRequirement[] = [];
  const seen = new Set<string>();

  for (const req of requirements) {
    // Normalize text for comparison
    const normalized = req.text.toLowerCase().replace(/\s+/g, ' ').trim();

    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(req);
    }
  }

  return unique;
}

/**
 * Find tickets that might cover a given requirement
 */
function findTicketsCoveringRequirement(tickets: Ticket[], requirement: PRDRequirement): Ticket[] {
  const reqWords = extractKeywords(requirement.text);

  return tickets.filter(ticket => {
    // Check title
    const titleWords = extractKeywords(ticket.title);
    const titleMatch = calculateWordOverlap(reqWords, titleWords);

    // Check description
    const descWords = ticket.description ? extractKeywords(ticket.description) : [];
    const descMatch = calculateWordOverlap(reqWords, descWords);

    // Check acceptance criteria
    const acWords = ticket.acceptanceCriteria.flatMap(ac => extractKeywords(ac));
    const acMatch = calculateWordOverlap(reqWords, acWords);

    // Consider covered if there's significant overlap
    return titleMatch > 0.3 || descMatch > 0.4 || acMatch > 0.5;
  });
}

/**
 * Extract meaningful keywords from text
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of',
    'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'or', 'and',
    'but', 'if', 'then', 'that', 'this', 'it', 'its', 'which', 'who',
    'when', 'where', 'what', 'how', 'all', 'each', 'every', 'any', 'some',
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
}

/**
 * Calculate overlap ratio between two word sets
 */
function calculateWordOverlap(set1: string[], set2: string[]): number {
  if (set1.length === 0 || set2.length === 0) return 0;

  const set2Set = new Set(set2);
  const matches = set1.filter(word => set2Set.has(word)).length;

  return matches / set1.length;
}

/**
 * Analyze codebase for coverage gaps
 */
export async function analyzeCodebaseCoverage(
  projectPath: string,
  plan: ParsedPlan
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // Get list of source files
  const sourceFiles = await getSourceFiles(projectPath);

  // Check for common patterns that might indicate missing tickets
  const patterns = [
    { pattern: /TODO:|FIXME:|HACK:|XXX:/gi, type: 'todo', severity: 'info' as AuditFindingSeverity },
    { pattern: /throw new Error\(['"].*not implemented/gi, type: 'not-implemented', severity: 'warning' as AuditFindingSeverity },
    { pattern: /\/\/\s*@todo\b/gi, type: 'todo-annotation', severity: 'info' as AuditFindingSeverity },
  ];

  for (const file of sourceFiles) {
    try {
      const content = readFileSync(file, 'utf-8');
      const relativePath = relative(projectPath, file);

      for (const { pattern, type, severity } of patterns) {
        const matches = content.match(pattern);
        if (matches) {
          for (const match of matches) {
            // Check if there's already a ticket for this
            const hasTicket = plan.tickets.some(t =>
              t.description?.includes(relativePath) ||
              t.acceptanceCriteria.some(ac => ac.includes(relativePath))
            );

            if (!hasTicket) {
              findings.push({
                severity,
                category: 'coverage',
                message: `Untracked ${type} in ${relativePath}: "${match}"`,
                suggestedAction: 'create',
                suggestedTicket: {
                  title: `Address ${type.toUpperCase()} in ${relativePath}`,
                  description: `Found ${type} comment in file that may need a dedicated ticket`,
                  priority: severity === 'warning' ? 'P1' : 'P2',
                  acceptanceCriteria: [`${type.toUpperCase()} comment removed from ${relativePath}`],
                  validationSteps: [],
                  dependencies: [],
                },
              });
            }
          }
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // Limit findings to avoid overwhelming the UI
  const maxFindings = 20;
  if (findings.length > maxFindings) {
    const truncatedCount = findings.length - maxFindings;
    const truncated = findings.slice(0, maxFindings);
    truncated.push({
      severity: 'info',
      category: 'coverage',
      message: `... and ${truncatedCount} more similar findings`,
      suggestedAction: 'review',
    });
    return truncated;
  }

  return findings;
}

/**
 * Get list of source files in the project
 */
async function getSourceFiles(projectPath: string): Promise<string[]> {
  const files: string[] = [];
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java']);
  const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '__pycache__']);

  function walkDir(dir: string, depth: number = 0): void {
    if (depth > 10) return; // Prevent infinite recursion

    try {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        const fullPath = join(dir, entry);

        if (ignoreDirs.has(entry)) continue;

        try {
          const stat = statSync(fullPath);

          if (stat.isDirectory()) {
            walkDir(fullPath, depth + 1);
          } else if (stat.isFile()) {
            const ext = entry.substring(entry.lastIndexOf('.'));
            if (extensions.has(ext)) {
              files.push(fullPath);
            }
          }
        } catch {
          // Skip inaccessible files
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  walkDir(projectPath);
  return files;
}

/**
 * Check for dependency issues
 */
export function checkDependencies(plan: ParsedPlan): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const ticketMap = new Map(plan.tickets.map(t => [t.id, t]));
  const allTicketIds = new Set(plan.tickets.map(t => t.id));

  for (const ticket of plan.tickets) {
    // Check for invalid dependencies
    for (const depId of ticket.dependencies) {
      if (!allTicketIds.has(depId)) {
        findings.push({
          severity: 'error',
          category: 'dependency',
          message: `Ticket ${ticket.id} depends on non-existent ticket ${depId}`,
          ticketId: ticket.id,
          suggestedAction: 'update',
        });
      }
    }

    // Check for stale dependencies (dependency is Done but ticket is still blocked)
    const depsAllDone = ticket.dependencies.every(depId => {
      const dep = ticketMap.get(depId);
      return dep && dep.status === 'Done';
    });

    if (depsAllDone && ticket.dependencies.length > 0 && ticket.status === 'Todo') {
      findings.push({
        severity: 'info',
        category: 'dependency',
        message: `Ticket ${ticket.id} has all dependencies completed but is still in Todo status`,
        ticketId: ticket.id,
        suggestedAction: 'review',
      });
    }

    // Check for circular dependencies (simple detection)
    const visited = new Set<string>();
    const stack = [...ticket.dependencies];

    while (stack.length > 0) {
      const depId = stack.pop()!;

      if (depId === ticket.id) {
        findings.push({
          severity: 'error',
          category: 'dependency',
          message: `Ticket ${ticket.id} has a circular dependency`,
          ticketId: ticket.id,
          suggestedAction: 'update',
        });
        break;
      }

      if (!visited.has(depId)) {
        visited.add(depId);
        const dep = ticketMap.get(depId);
        if (dep) {
          stack.push(...dep.dependencies);
        }
      }
    }
  }

  return findings;
}

/**
 * Check for stale tickets
 */
export function checkStaleness(plan: ParsedPlan): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // Check for tickets that are "In Progress" but have no owner
  for (const ticket of plan.tickets) {
    if (ticket.status === 'InProgress' && !ticket.owner) {
      findings.push({
        severity: 'warning',
        category: 'staleness',
        message: `Ticket ${ticket.id} is In Progress but has no owner assigned`,
        ticketId: ticket.id,
        suggestedAction: 'update',
      });
    }

    // Check for tickets with vague acceptance criteria
    if (ticket.acceptanceCriteria.length === 0 && ticket.status !== 'Done') {
      findings.push({
        severity: 'warning',
        category: 'accuracy',
        message: `Ticket ${ticket.id} has no acceptance criteria defined`,
        ticketId: ticket.id,
        suggestedAction: 'update',
      });
    }

    // Check for tickets with vague validation steps
    if (ticket.validationSteps.length === 0 && ticket.status !== 'Done') {
      findings.push({
        severity: 'info',
        category: 'accuracy',
        message: `Ticket ${ticket.id} has no validation steps defined`,
        ticketId: ticket.id,
        suggestedAction: 'update',
      });
    }
  }

  return findings;
}

/**
 * Check for orphaned tickets (tickets for code that no longer exists)
 */
export async function checkOrphanedTickets(
  projectPath: string,
  plan: ParsedPlan
): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // Get source files
  const sourceFiles = await getSourceFiles(projectPath);
  const sourceFilesRelative = new Set(
    sourceFiles.map(f => relative(projectPath, f))
  );

  for (const ticket of plan.tickets) {
    // Skip done tickets
    if (ticket.status === 'Done') continue;

    // Check if ticket references specific files that don't exist
    const fileReferences = extractFileReferences(ticket);

    for (const fileRef of fileReferences) {
      // Check various path formats
      const exists =
        sourceFilesRelative.has(fileRef) ||
        sourceFilesRelative.has(fileRef.replace(/^\//, '')) ||
        existsSync(join(projectPath, fileRef));

      if (!exists && !isLikelyNewFile(fileRef, ticket)) {
        findings.push({
          severity: 'warning',
          category: 'orphaned',
          message: `Ticket ${ticket.id} references file "${fileRef}" which does not exist`,
          ticketId: ticket.id,
          suggestedAction: 'update',
        });
      }
    }
  }

  return findings;
}

/**
 * Extract file references from a ticket
 */
function extractFileReferences(ticket: Ticket): string[] {
  const allText = [
    ticket.title,
    ticket.description || '',
    ...ticket.acceptanceCriteria,
    ...ticket.validationSteps,
    ticket.notes || '',
  ].join(' ');

  // Match common file path patterns
  const patterns = [
    /(?:^|\s)(src\/[\w/.-]+\.(?:ts|tsx|js|jsx))/g,
    /(?:^|\s)([\w-]+\.(?:ts|tsx|js|jsx))/g,
    /(?:`)([\w/.-]+\.(?:ts|tsx|js|jsx))(?:`)/g,
  ];

  const refs = new Set<string>();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(allText)) !== null) {
      refs.add(match[1]);
    }
  }

  return Array.from(refs);
}

/**
 * Check if a file reference is likely a new file to be created
 */
function isLikelyNewFile(filePath: string, ticket: Ticket): boolean {
  const text = [
    ticket.title.toLowerCase(),
    (ticket.description || '').toLowerCase(),
    ...ticket.acceptanceCriteria.map(ac => ac.toLowerCase()),
  ].join(' ');

  // Keywords that suggest the ticket is about creating new files
  const createKeywords = ['create', 'implement', 'add', 'new', 'build', 'write'];

  return createKeywords.some(keyword => text.includes(keyword));
}

/**
 * Format audit findings for display
 */
export function formatAuditFindings(result: AuditResult): string {
  const lines: string[] = [];

  lines.push(`Plan Audit Results (${result.auditedAt.toISOString()})`);
  lines.push(`${'='.repeat(50)}`);
  lines.push('');
  lines.push(`Summary: ${result.summary.errors} errors, ${result.summary.warnings} warnings, ${result.summary.infos} info`);
  lines.push('');

  // Group by category
  const byCategory = new Map<string, AuditFinding[]>();
  for (const finding of result.findings) {
    const cat = finding.category;
    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
    }
    byCategory.get(cat)!.push(finding);
  }

  for (const [category, findings] of byCategory) {
    lines.push(`## ${category.toUpperCase()}`);
    lines.push('');

    for (const finding of findings) {
      const icon = finding.severity === 'error' ? 'x' : finding.severity === 'warning' ? '!' : 'i';
      lines.push(`[${icon}] ${finding.message}`);
      if (finding.ticketId) {
        lines.push(`    Ticket: ${finding.ticketId}`);
      }
      lines.push(`    Suggested: ${finding.suggestedAction}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
