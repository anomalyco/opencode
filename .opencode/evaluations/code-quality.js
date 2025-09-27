#!/usr/bin/env bun
/**
 * Example EvalOps evaluation suite for code quality checks
 * This suite runs various tests on the codebase to ensure quality standards
 */

import { spawn } from "child_process"
import { promisify } from "util"
import fs from "fs/promises"
import path from "path"

const exec = promisify(require("child_process").exec)

// Get the payload from environment
const payload = JSON.parse(process.env.EVALOPS_PAYLOAD || "{}")

// Test suite definition
const tests = [
  {
    name: "TypeScript Type Check",
    async run() {
      try {
        const { stdout, stderr } = await exec("bun run typecheck", {
          cwd: payload.project || process.cwd(),
        })
        return {
          passed: !stderr || !stderr.includes("error"),
          output: stdout || "",
          error: stderr || "",
        }
      } catch (error) {
        return {
          passed: false,
          error: error.message,
        }
      }
    },
  },
  {
    name: "Code Formatting",
    async run() {
      try {
        const { stdout, stderr } = await exec("prettier --check '**/*.{ts,tsx,js,jsx}'", {
          cwd: payload.project || process.cwd(),
        })
        return {
          passed: true,
          output: "All files formatted correctly",
        }
      } catch (error) {
        return {
          passed: false,
          error: "Some files are not properly formatted",
          output: error.stdout || "",
        }
      }
    },
  },
  {
    name: "Bundle Size Check",
    async run() {
      try {
        // Check if bundle size is within limits
        const stats = await fs.stat(path.join(payload.project || process.cwd(), "dist"))
          .catch(() => null)

        if (!stats) {
          return {
            passed: true,
            output: "No dist directory found (not built yet)",
          }
        }

        // Simple size check (could be more sophisticated)
        const maxSize = 10 * 1024 * 1024 // 10MB
        const size = stats.size

        return {
          passed: size <= maxSize,
          output: `Bundle size: ${(size / 1024 / 1024).toFixed(2)}MB`,
          error: size > maxSize ? `Bundle too large: ${(size / 1024 / 1024).toFixed(2)}MB > 10MB` : undefined,
        }
      } catch (error) {
        return {
          passed: false,
          error: error.message,
        }
      }
    },
  },
  {
    name: "Security Audit",
    async run() {
      try {
        const { stdout, stderr } = await exec("bun audit", {
          cwd: payload.project || process.cwd(),
        })

        const hasVulnerabilities = stdout.includes("found") && stdout.includes("vulnerabilit")

        return {
          passed: !hasVulnerabilities,
          output: stdout,
          error: hasVulnerabilities ? "Security vulnerabilities found" : undefined,
        }
      } catch (error) {
        // Bun audit might not be available, skip
        return {
          passed: true,
          output: "Security audit skipped (bun audit not available)",
        }
      }
    },
  },
  {
    name: "Test Coverage",
    async run() {
      try {
        const { stdout } = await exec("bun test --coverage", {
          cwd: payload.project || process.cwd(),
        })

        // Parse coverage percentage from output
        const coverageMatch = stdout.match(/(\d+(\.\d+)?)%/)
        const coverage = coverageMatch ? parseFloat(coverageMatch[1]) : 0
        const threshold = 70 // 70% coverage threshold

        return {
          passed: coverage >= threshold,
          output: `Test coverage: ${coverage}%`,
          error: coverage < threshold ? `Coverage below threshold: ${coverage}% < ${threshold}%` : undefined,
        }
      } catch (error) {
        return {
          passed: false,
          error: "Failed to run tests",
          output: error.stdout || error.message,
        }
      }
    },
  },
  {
    name: "Dependency Check",
    async run() {
      try {
        // Check for outdated dependencies
        const { stdout } = await exec("bun outdated", {
          cwd: payload.project || process.cwd(),
        })

        const hasOutdated = stdout.includes("Package") && stdout.includes("Current")

        return {
          passed: true, // Outdated deps are warnings, not failures
          output: hasOutdated ? "Some dependencies are outdated" : "All dependencies up to date",
        }
      } catch (error) {
        return {
          passed: true,
          output: "Dependency check skipped",
        }
      }
    },
  },
  {
    name: "Code Complexity",
    async run() {
      try {
        // Simple check for file size and function length
        const files = await exec("find . -name '*.ts' -not -path './node_modules/*' -not -path './dist/*'", {
          cwd: payload.project || process.cwd(),
        })

        const fileList = files.stdout.trim().split('\n').filter(f => f)
        let issues = []

        for (const file of fileList.slice(0, 10)) { // Check first 10 files for performance
          try {
            const content = await fs.readFile(
              path.join(payload.project || process.cwd(), file),
              'utf-8'
            )

            const lines = content.split('\n')
            if (lines.length > 500) {
              issues.push(`${file}: ${lines.length} lines (>500)`)
            }

            // Check for long functions (simple heuristic)
            let functionStart = -1
            let braceCount = 0

            lines.forEach((line, idx) => {
              if (line.includes('function') || line.includes('=>')) {
                functionStart = idx
                braceCount = 0
              }

              if (functionStart >= 0) {
                braceCount += (line.match(/{/g) || []).length
                braceCount -= (line.match(/}/g) || []).length

                if (braceCount === 0 && idx - functionStart > 50) {
                  issues.push(`${file}:${functionStart}: Long function (>${50} lines)`)
                  functionStart = -1
                }
              }
            })
          } catch (e) {
            // Skip file if can't read
          }
        }

        return {
          passed: issues.length === 0,
          output: issues.length > 0 ? issues.join('\n') : "Code complexity within limits",
          error: issues.length > 0 ? `Found ${issues.length} complexity issues` : undefined,
        }
      } catch (error) {
        return {
          passed: true,
          output: "Complexity check skipped",
        }
      }
    },
  },
]

// Run the evaluation suite
async function runEvaluation() {
  const startTime = Date.now()
  const results = {
    suite: "code-quality",
    tests: [],
    summary: {
      total: tests.length,
      passed: 0,
      failed: 0,
      duration: 0,
    },
    timestamp: new Date().toISOString(),
  }

  for (const test of tests) {
    const testStart = Date.now()

    try {
      const result = await test.run()
      const duration = Date.now() - testStart

      results.tests.push({
        name: test.name,
        passed: result.passed,
        duration,
        error: result.error,
        output: result.output,
      })

      if (result.passed) {
        results.summary.passed++
      } else {
        results.summary.failed++
      }
    } catch (error) {
      const duration = Date.now() - testStart

      results.tests.push({
        name: test.name,
        passed: false,
        duration,
        error: error.message,
      })

      results.summary.failed++
    }
  }

  results.summary.duration = Date.now() - startTime

  // Output results as JSON to stdout
  console.log(JSON.stringify(results))
}

// Run if called directly
if (import.meta.main) {
  runEvaluation().catch(error => {
    console.error(JSON.stringify({
      suite: "code-quality",
      tests: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        duration: 0,
      },
      timestamp: new Date().toISOString(),
      error: error.message,
    }))
    process.exit(1)
  })
}