#!/usr/bin/env npx ts-node
/**
 * Task Management CLI
 *
 * Usage: npx ts-node task-cli.ts <command> [feature] [args...]
 *
 * Commands:
 *   status [feature]              - Show task status summary
 *   next [feature]                - Show next eligible tasks
 *   parallel [feature]            - Show parallelizable tasks ready to run
 *   deps <feature> <seq>          - Show dependency tree for a task
 *   blocked [feature]             - Show blocked tasks and why
 *   complete <feature> <seq> "summary" - Mark task completed
 *   validate [feature]            - Validate JSON files and dependencies
 *
 * Task files are stored in .tmp/tasks/ at the project root:
 *   .tmp/tasks/{feature-slug}/task.json
 *   .tmp/tasks/{feature-slug}/subtask_01.json
 *   .tmp/tasks/completed/{feature-slug}/
 */

const fs = require('fs');
const path = require('path');

// Find project root (look for .git or package.json)
function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot();
const TASKS_DIR = path.join(PROJECT_ROOT, '.tmp', 'tasks');
const COMPLETED_DIR = path.join(TASKS_DIR, 'completed');

interface Task {
  id: string;
  name: string;
  status: 'active' | 'completed' | 'blocked' | 'archived';
  objective: string;
  context_files: string[];
  reference_files?: string[];
  exit_criteria: string[];
  subtask_count: number;
  completed_count: number;
  created_at: string;
  completed_at: string | null;
}

interface Subtask {
  id: string;
  seq: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  depends_on: string[];
  parallel: boolean;
  context_files: string[];
  reference_files?: string[];
  acceptance_criteria: string[];
  deliverables: string[];
  agent_id: string | null;
  suggested_agent?: string;
  started_at: string | null;
  completed_at: string | null;
  completion_summary: string | null;
}

// Helpers
function getFeatureDirs(): string[] {
  if (!fs.existsSync(TASKS_DIR)) return [];
  return fs.readdirSync(TASKS_DIR).filter((f: string) => {
    const fullPath = path.join(TASKS_DIR, f);
    return fs.statSync(fullPath).isDirectory() && f !== 'completed';
  });
}

function loadTask(feature: string): Task | null {
  const taskPath = path.join(TASKS_DIR, feature, 'task.json');
  if (!fs.existsSync(taskPath)) return null;
  return JSON.parse(fs.readFileSync(taskPath, 'utf-8'));
}

function loadSubtasks(feature: string): Subtask[] {
  const featureDir = path.join(TASKS_DIR, feature);
  if (!fs.existsSync(featureDir)) return [];

  const files = fs.readdirSync(featureDir)
    .filter((f: string) => f.match(/^subtask_\d{2}\.json$/))
    .sort();

  return files.map((f: string) => JSON.parse(fs.readFileSync(path.join(featureDir, f), 'utf-8')));
}

function saveSubtask(feature: string, subtask: Subtask): void {
  const subtaskPath = path.join(TASKS_DIR, feature, `subtask_${subtask.seq}.json`);
  fs.writeFileSync(subtaskPath, JSON.stringify(subtask, null, 2));
}

function saveTask(feature: string, task: Task): void {
  const taskPath = path.join(TASKS_DIR, feature, 'task.json');
  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
}

// Commands
function cmdStatus(feature?: string): void {
  const features = feature ? [feature] : getFeatureDirs();

  if (features.length === 0) {
    console.log('No active features found.');
    return;
  }

  for (const f of features) {
    const task = loadTask(f);
    const subtasks = loadSubtasks(f);

    if (!task) {
      console.log(`\n[${f}] - No task.json found`);
      continue;
    }

    const counts = {
      pending: subtasks.filter(s => s.status === 'pending').length,
      in_progress: subtasks.filter(s => s.status === 'in_progress').length,
      completed: subtasks.filter(s => s.status === 'completed').length,
      blocked: subtasks.filter(s => s.status === 'blocked').length,
    };

    const progress = subtasks.length > 0
      ? Math.round((counts.completed / subtasks.length) * 100)
      : 0;

    console.log(`\n[${f}] ${task.name}`);
    console.log(`  Status: ${task.status} | Progress: ${progress}% (${counts.completed}/${subtasks.length})`);
    console.log(`  Pending: ${counts.pending} | In Progress: ${counts.in_progress} | Completed: ${counts.completed} | Blocked: ${counts.blocked}`);
  }
}

function cmdNext(feature?: string): void {
  const features = feature ? [feature] : getFeatureDirs();

  console.log('\n=== Ready Tasks (deps satisfied) ===\n');

  for (const f of features) {
    const subtasks = loadSubtasks(f);
    const completedSeqs = new Set(subtasks.filter(s => s.status === 'completed').map(s => s.seq));

    const ready = subtasks.filter(s => {
      if (s.status !== 'pending') return false;
      return s.depends_on.every(dep => completedSeqs.has(dep));
    });

    if (ready.length > 0) {
      console.log(`[${f}]`);
      for (const s of ready) {
        const parallel = s.parallel ? '[parallel]' : '[sequential]';
        console.log(`  ${s.seq} - ${s.title}  ${parallel}`);
      }
      console.log();
    }
  }
}

function cmdParallel(feature?: string): void {
  const features = feature ? [feature] : getFeatureDirs();

  console.log('\n=== Parallelizable Tasks Ready Now ===\n');

  for (const f of features) {
    const subtasks = loadSubtasks(f);
    const completedSeqs = new Set(subtasks.filter(s => s.status === 'completed').map(s => s.seq));

    const parallel = subtasks.filter(s => {
      if (s.status !== 'pending') return false;
      if (!s.parallel) return false;
      return s.depends_on.every(dep => completedSeqs.has(dep));
    });

    if (parallel.length > 0) {
      console.log(`[${f}] - ${parallel.length} parallel tasks:`);
      for (const s of parallel) {
        console.log(`  ${s.seq} - ${s.title}`);
      }
      console.log();
    }
  }
}

function cmdDeps(feature: string, seq: string): void {
  const subtasks = loadSubtasks(feature);
  const target = subtasks.find(s => s.seq === seq);

  if (!target) {
    console.log(`Task ${seq} not found in ${feature}`);
    return;
  }

  console.log(`\n=== Dependency Tree: ${feature}/${seq} ===\n`);
  console.log(`${seq} - ${target.title} [${target.status}]`);

  if (target.depends_on.length === 0) {
    console.log('  └── (no dependencies)');
    return;
  }

  const printDeps = (seqs: string[], indent: string = '  '): void => {
    for (let i = 0; i < seqs.length; i++) {
      const depSeq = seqs[i];
      const dep = subtasks.find(s => s.seq === depSeq);
      const isLast = i === seqs.length - 1;
      const branch = isLast ? '└──' : '├──';

      if (dep) {
        const statusIcon = dep.status === 'completed' ? '✓' : dep.status === 'in_progress' ? '~' : '○';
        console.log(`${indent}${branch} ${statusIcon} ${depSeq} - ${dep.title} [${dep.status}]`);
        if (dep.depends_on.length > 0) {
          const newIndent = indent + (isLast ? '    ' : '│   ');
          printDeps(dep.depends_on, newIndent);
        }
      } else {
        console.log(`${indent}${branch} ? ${depSeq} - NOT FOUND`);
      }
    }
  };

  printDeps(target.depends_on);
}

function cmdBlocked(feature?: string): void {
  const features = feature ? [feature] : getFeatureDirs();

  console.log('\n=== Blocked Tasks ===\n');

  for (const f of features) {
    const subtasks = loadSubtasks(f);
    const completedSeqs = new Set(subtasks.filter(s => s.status === 'completed').map(s => s.seq));

    const blocked = subtasks.filter(s => {
      if (s.status === 'blocked') return true;
      if (s.status !== 'pending') return false;
      return !s.depends_on.every(dep => completedSeqs.has(dep));
    });

    if (blocked.length > 0) {
      console.log(`[${f}]`);
      for (const s of blocked) {
        const waitingFor = s.depends_on.filter(dep => !completedSeqs.has(dep));
        const reason = s.status === 'blocked'
          ? 'explicitly blocked'
          : `waiting: ${waitingFor.join(', ')}`;
        console.log(`  ${s.seq} - ${s.title} (${reason})`);
      }
      console.log();
    }
  }
}

function cmdComplete(feature: string, seq: string, summary: string): void {
  if (summary.length > 200) {
    console.log('Error: Summary must be max 200 characters');
    process.exit(1);
  }

  const subtasks = loadSubtasks(feature);
  const subtask = subtasks.find(s => s.seq === seq);

  if (!subtask) {
    console.log(`Task ${seq} not found in ${feature}`);
    process.exit(1);
  }

  subtask.status = 'completed';
  subtask.completed_at = new Date().toISOString();
  subtask.completion_summary = summary;

  saveSubtask(feature, subtask);

  // Update task.json counts
  const task = loadTask(feature);
  if (task) {
    const newSubtasks = loadSubtasks(feature);
    task.completed_count = newSubtasks.filter(s => s.status === 'completed').length;
    saveTask(feature, task);
  }

  console.log(`\n✓ Marked ${feature}/${seq} as completed`);
  console.log(`  Summary: ${summary}`);

  if (task) {
    console.log(`  Progress: ${task.completed_count}/${task.subtask_count}`);
  }
}

function cmdValidate(feature?: string): void {
  const features = feature ? [feature] : getFeatureDirs();
  let hasErrors = false;

  const validTaskStatuses = new Set(['active', 'completed', 'blocked', 'archived']);
  const validSubtaskStatuses = new Set(['pending', 'in_progress', 'completed', 'blocked']);

  const requiredTaskFields = [
    'id',
    'name',
    'status',
    'objective',
    'context_files',
    'exit_criteria',
    'subtask_count',
    'completed_count',
    'created_at',
    'completed_at',
  ];

  const requiredSubtaskFields = [
    'id',
    'seq',
    'title',
    'status',
    'depends_on',
    'parallel',
    'context_files',
    'acceptance_criteria',
    'deliverables',
    'agent_id',
    'started_at',
    'completed_at',
    'completion_summary',
  ];

  const hasField = (obj: any, field: string): boolean => Object.prototype.hasOwnProperty.call(obj, field);
  const isStringArray = (value: any): boolean => Array.isArray(value) && value.every(v => typeof v === 'string');

  console.log('\n=== Validation Results ===\n');

  for (const f of features) {
    const errors: string[] = [];

    // Check task.json exists
    const task = loadTask(f);
    if (!task) {
      errors.push('Missing task.json');
    }

    // Load and validate subtasks
    const subtasks = loadSubtasks(f);
    const seqCounts = new Map<string, number>();
    for (const s of subtasks) {
      const seq = typeof s.seq === 'string' ? s.seq : '';
      seqCounts.set(seq, (seqCounts.get(seq) || 0) + 1);
    }
    const seqs = new Set(subtasks.map(s => s.seq));

    if (task) {
      // Required fields in task.json
      for (const field of requiredTaskFields) {
        if (!hasField(task, field)) {
          errors.push(`task.json: missing required field '${field}'`);
        }
      }

      // Task ID should match feature slug
      if (task.id !== f) {
        errors.push(`task.json id ('${task.id}') should match feature slug ('${f}')`);
      }

      // Task status should be valid
      if (!validTaskStatuses.has(task.status)) {
        errors.push(`task.json: invalid status '${task.status}'`);
      }

      // Basic type checks for key task fields
      if (!isStringArray(task.context_files)) {
        errors.push('task.json: context_files must be string[]');
      }
      if (hasField(task, 'reference_files') && task.reference_files !== undefined && !isStringArray(task.reference_files)) {
        errors.push('task.json: reference_files must be string[] when present');
      }
      if (!isStringArray(task.exit_criteria)) {
        errors.push('task.json: exit_criteria must be string[]');
      }
      if (typeof task.subtask_count !== 'number') {
        errors.push('task.json: subtask_count must be number');
      }
      if (typeof task.completed_count !== 'number') {
        errors.push('task.json: completed_count must be number');
      }
    }

    for (const s of subtasks) {
      // Required fields in subtask files
      for (const field of requiredSubtaskFields) {
        if (!hasField(s, field)) {
          errors.push(`${s.seq || '??'}: missing required field '${field}'`);
        }
      }

      // Sequence format and uniqueness
      if (!/^\d{2}$/.test(s.seq)) {
        errors.push(`${s.seq}: sequence must be 2 digits (e.g., 01, 02)`);
      }
      if ((seqCounts.get(s.seq) || 0) > 1) {
        errors.push(`${s.seq}: duplicate sequence number`);
      }

      // Check ID format
      if (!s.id.startsWith(f)) {
        errors.push(`${s.seq}: ID should start with feature name`);
      }

      // Status should be valid
      if (!validSubtaskStatuses.has(s.status)) {
        errors.push(`${s.seq}: invalid status '${s.status}'`);
      }

      // Type checks
      if (!isStringArray(s.depends_on)) {
        errors.push(`${s.seq}: depends_on must be string[]`);
      }
      if (typeof s.parallel !== 'boolean') {
        errors.push(`${s.seq}: parallel must be boolean`);
      }
      if (!isStringArray(s.context_files)) {
        errors.push(`${s.seq}: context_files must be string[]`);
      }
      if (hasField(s, 'reference_files') && s.reference_files !== undefined && !isStringArray(s.reference_files)) {
        errors.push(`${s.seq}: reference_files must be string[] when present`);
      }
      if (!isStringArray(s.acceptance_criteria)) {
        errors.push(`${s.seq}: acceptance_criteria must be string[]`);
      } else if (s.acceptance_criteria.length === 0) {
        errors.push(`${s.seq}: No acceptance criteria defined`);
      }
      if (!isStringArray(s.deliverables)) {
        errors.push(`${s.seq}: deliverables must be string[]`);
      } else if (s.deliverables.length === 0) {
        errors.push(`${s.seq}: No deliverables defined`);
      }

      // Self dependency is invalid
      if (Array.isArray(s.depends_on) && s.depends_on.includes(s.seq)) {
        errors.push(`${s.seq}: task cannot depend on itself`);
      }

      // Check for missing dependencies
      for (const dep of (Array.isArray(s.depends_on) ? s.depends_on : [])) {
        if (!seqs.has(dep)) {
          errors.push(`${s.seq}: depends on non-existent task ${dep}`);
        }
      }

      // Check for circular dependencies
      const visited = new Set<string>();
      const checkCircular = (seq: string, path: string[]): boolean => {
        if (path.includes(seq)) {
          errors.push(`${s.seq}: circular dependency detected: ${[...path, seq].join(' -> ')}`);
          return true;
        }
        if (visited.has(seq)) return false;
        visited.add(seq);

        const task = subtasks.find(t => t.seq === seq);
        if (task) {
          for (const dep of task.depends_on) {
            if (checkCircular(dep, [...path, seq])) return true;
          }
        }
        return false;
      };
      checkCircular(s.seq, []);
    }

    // Check counts match
    if (task && task.subtask_count !== subtasks.length) {
      errors.push(`task.json subtask_count (${task.subtask_count}) doesn't match actual count (${subtasks.length})`);
    }

    // Print results
    console.log(`[${f}]`);
    if (errors.length === 0) {
      console.log('  ✓ All checks passed');
    } else {
      for (const e of errors) {
        console.log(`  ✗ ERROR: ${e}`);
        hasErrors = true;
      }
    }
    console.log();
  }

  process.exit(hasErrors ? 1 : 0);
}

// Main
const [,, command, ...args] = process.argv;

switch (command) {
  case 'status':
    cmdStatus(args[0]);
    break;
  case 'next':
    cmdNext(args[0]);
    break;
  case 'parallel':
    cmdParallel(args[0]);
    break;
  case 'deps':
    if (args.length < 2) {
      console.log('Usage: deps <feature> <seq>');
      process.exit(1);
    }
    cmdDeps(args[0], args[1]);
    break;
  case 'blocked':
    cmdBlocked(args[0]);
    break;
  case 'complete':
    if (args.length < 3) {
      console.log('Usage: complete <feature> <seq> "summary"');
      process.exit(1);
    }
    cmdComplete(args[0], args[1], args.slice(2).join(' '));
    break;
  case 'validate':
    cmdValidate(args[0]);
    break;
  default:
    console.log(`
Task Management CLI

Usage: npx ts-node task-cli.ts <command> [feature] [args...]

Task files are stored in: .tmp/tasks/{feature-slug}/

Commands:
  status [feature]                  Show task status summary
  next [feature]                    Show next eligible tasks (deps satisfied)
  parallel [feature]                Show parallelizable tasks ready to run
  deps <feature> <seq>              Show dependency tree for a task
  blocked [feature]                 Show blocked tasks and why
  complete <feature> <seq> "summary" Mark task completed with summary
  validate [feature]                Validate JSON files and dependencies

Examples:
  npx ts-node task-cli.ts status
  npx ts-node task-cli.ts next my-feature
  npx ts-node task-cli.ts complete my-feature 02 "Implemented auth module"
`);
}
