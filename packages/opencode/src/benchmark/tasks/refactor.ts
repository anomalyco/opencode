import fs from "fs/promises"
import path from "path"
import os from "os"

/**
 * Refactor benchmark task.
 * Creates a multi-file TypeScript project and asks the agent to perform
 * a complex refactoring that will require multiple context switches and
 * should trigger 2-3 compactions.
 */
export namespace RefactorTask {
  export const NAME = "refactor"
  export const DESCRIPTION = "Multi-file TypeScript refactoring task"

  /**
   * The prompt to send to the agent
   */
  export const TASK_PROMPT = `
You are working on a TypeScript project in the current directory. Your task is to perform a comprehensive refactoring:

1. **Rename Function**: Rename the \`getData\` function to \`fetchUserData\` across ALL files that use it. Make sure to update all imports and call sites.

2. **Extract Module**: Move ALL validation-related functions into a new file \`utils/validation.ts\`:
   - Extract \`validateEmail\`
   - Extract \`validateAge\`
   - Extract \`validateName\`
   - Create proper exports from the new module
   - Update all imports in files that used these functions

3. **Add TypeScript Types**: Add proper TypeScript types to all function parameters and return types:
   - Create an interface for User data
   - Add parameter types to all functions
   - Add return type annotations

4. **Update Error Handling**: Improve error handling in the API functions:
   - Add try-catch blocks where needed
   - Create custom error classes for validation errors

5. **Verify Changes**: After making all changes:
   - Read each modified file to verify the changes
   - Run \`tsc --noEmit\` to verify TypeScript compilation
   - List all files to confirm structure

This is a complex refactoring that requires careful attention to all file dependencies.
`

  /**
   * Sample TypeScript files for the benchmark
   */
  const FILES = {
    "src/index.ts": `
import { getData } from './api/data';
import { validateEmail, validateAge } from './utils/helpers';
import { processUser } from './services/user';

async function main() {
  const users = await getData();

  for (const user of users) {
    if (validateEmail(user.email) && validateAge(user.age)) {
      await processUser(user);
    }
  }
}

main().catch(console.error);
`,
    "src/api/data.ts": `
import { validateName } from '../utils/helpers';

export async function getData() {
  const response = await fetch('/api/users');
  const data = await response.json();

  return data.users.filter(user => validateName(user.name));
}

export async function saveData(users) {
  const response = await fetch('/api/users', {
    method: 'POST',
    body: JSON.stringify(users),
  });
  return response.ok;
}
`,
    "src/services/user.ts": `
import { getData } from '../api/data';
import { validateEmail } from '../utils/helpers';

export async function processUser(user) {
  console.log('Processing user:', user.name);

  if (!validateEmail(user.email)) {
    throw new Error('Invalid email');
  }

  // Simulate processing
  await new Promise(resolve => setTimeout(resolve, 100));

  return { success: true, userId: user.id };
}

export async function refreshUsers() {
  return getData();
}
`,
    "src/utils/helpers.ts": `
export function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return emailRegex.test(email);
}

export function validateAge(age) {
  if (typeof age !== 'number') {
    return false;
  }
  return age >= 0 && age <= 150;
}

export function validateName(name) {
  if (!name || typeof name !== 'string') {
    return false;
  }
  return name.length >= 1 && name.length <= 100;
}

export function formatDate(date) {
  return new Date(date).toISOString();
}

export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
`,
    "src/types/index.ts": `
// Types will be defined here after refactoring
export {};
`,
    "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
`,
    "package.json": `{
  "name": "benchmark-refactor-task",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "check": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
`,
  }

  /**
   * Set up the benchmark task by creating a temporary directory with sample files
   */
  export async function setup(): Promise<string> {
    // Create temp directory
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-benchmark-refactor-"))

    // Create all files
    for (const [filepath, content] of Object.entries(FILES)) {
      const fullPath = path.join(tempDir, filepath)
      await fs.mkdir(path.dirname(fullPath), { recursive: true })
      await fs.writeFile(fullPath, content.trim())
    }

    // Create utils directory for the validation module target
    await fs.mkdir(path.join(tempDir, "src", "utils"), { recursive: true })

    return tempDir
  }

  /**
   * Clean up the benchmark task directory
   */
  export async function cleanup(dir: string): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true })
  }

  /**
   * Verify the refactoring was completed correctly
   */
  export async function verify(dir: string): Promise<{
    success: boolean
    issues: string[]
  }> {
    const issues: string[] = []

    // Check if validation.ts was created
    try {
      await fs.access(path.join(dir, "src", "utils", "validation.ts"))
    } catch {
      issues.push("utils/validation.ts was not created")
    }

    // Check if getData was renamed
    const dataFile = await fs.readFile(path.join(dir, "src", "api", "data.ts"), "utf-8").catch(() => "")
    if (dataFile.includes("function getData") || dataFile.includes("export async function getData")) {
      issues.push("getData function was not renamed to fetchUserData")
    }

    // Check if index.ts imports fetchUserData
    const indexFile = await fs.readFile(path.join(dir, "src", "index.ts"), "utf-8").catch(() => "")
    if (!indexFile.includes("fetchUserData")) {
      issues.push("index.ts does not import fetchUserData")
    }

    // Check if validation functions were moved
    const helpersFile = await fs.readFile(path.join(dir, "src", "utils", "helpers.ts"), "utf-8").catch(() => "")
    if (helpersFile.includes("function validateEmail")) {
      issues.push("validateEmail was not moved to validation.ts")
    }

    return {
      success: issues.length === 0,
      issues,
    }
  }
}
