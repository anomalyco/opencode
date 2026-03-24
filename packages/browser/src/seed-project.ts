// Seed the VFS with a demo TypeScript project
import { _vfs_setFile, _vfs_addDir } from "./shims/fs.browser"

export function seedDemoProject() {
  // Create workspace directories
  const dirs = [
    "/workspace",
    "/workspace/src",
    "/workspace/src/utils",
    "/workspace/test",
  ]
  for (const dir of dirs) {
    _vfs_addDir(dir)
  }

  // package.json
  _vfs_setFile("/workspace/package.json", JSON.stringify({
    name: "demo-project",
    version: "1.0.0",
    type: "module",
    scripts: {
      build: "tsc",
      test: "echo 'Tests would run here'",
    },
    dependencies: {},
    devDependencies: {
      typescript: "^5.0.0",
    },
  }, null, 2))

  // tsconfig.json
  _vfs_setFile("/workspace/tsconfig.json", JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      outDir: "./dist",
    },
    include: ["src/**/*.ts"],
  }, null, 2))

  // Main entry
  _vfs_setFile("/workspace/src/index.ts", `import { formatDate, calculateAge } from "./utils/helpers"

const users = [
  { name: "Alice", birthDate: "1990-05-15" },
  { name: "Bob", birthDate: "1985-12-01" },
  { name: "Charlie", birthDate: "2000-03-22" },
]

for (const user of users) {
  const age = calculateAge(user.birthDate)
  const formatted = formatDate(user.birthDate)
  console.log(\`\${user.name} was born on \${formatted} and is \${age} years old\`)
}
`)

  // Utils with a bug to fix
  _vfs_setFile("/workspace/src/utils/helpers.ts", `/**
 * Format a date string to a human-readable format
 * BUG: This function has an off-by-one error in month calculation
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const month = date.getMonth() // BUG: getMonth() is 0-indexed, should add 1
  const day = date.getDate()
  const year = date.getFullYear()
  return \`\${month}/\${day}/\${year}\`
}

/**
 * Calculate age from a birth date string
 * BUG: Doesn't account for whether birthday has passed this year
 */
export function calculateAge(birthDateStr: string): number {
  const today = new Date()
  const birthDate = new Date(birthDateStr)
  const age = today.getFullYear() - birthDate.getFullYear()
  return age // BUG: Should check if birthday has passed this year
}

/**
 * Validate an email address
 * BUG: The regex is too simple and allows invalid emails
 */
export function isValidEmail(email: string): boolean {
  return email.includes("@") // BUG: Should use proper regex validation
}

/**
 * Capitalize the first letter of each word
 */
export function titleCase(str: string): string {
  return str
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}

/**
 * Remove duplicate items from an array
 */
export function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}
`)

  // Test file
  _vfs_setFile("/workspace/test/helpers.test.ts", `import { formatDate, calculateAge, isValidEmail, titleCase, unique } from "../src/utils/helpers"

// These tests expose the bugs in the helpers module

console.log("Testing formatDate...")
console.log(formatDate("2024-01-15")) // Expected: "1/15/2024", Got: "0/15/2024" (off by one!)

console.log("Testing calculateAge...")
// If today is March 2026 and birthday is December 2000
console.log(calculateAge("2000-12-01")) // Should be 25, might return 26

console.log("Testing isValidEmail...")
console.log(isValidEmail("not-an-email@")) // Returns true but shouldn't!
console.log(isValidEmail("@also-bad"))     // Returns true but shouldn't!

console.log("Testing titleCase...")
console.log(titleCase("hello world")) // Should be "Hello World"

console.log("Testing unique...")
console.log(unique([1, 2, 2, 3, 3, 3])) // Should be [1, 2, 3]
`)

  // README
  _vfs_setFile("/workspace/README.md", `# Demo Project

A small TypeScript project with intentional bugs for testing OpenCode.

## Known Issues

- \`formatDate\` has an off-by-one month error
- \`calculateAge\` doesn't check if birthday has passed this year
- \`isValidEmail\` uses overly simple validation

## Usage

Ask OpenCode to find and fix the bugs!

Try: "Look at the helper functions in src/utils/helpers.ts and fix the bugs"
`)
}
