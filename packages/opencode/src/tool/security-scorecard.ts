import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Ripgrep } from "../file/ripgrep"
import DESCRIPTION from "./security-scorecard.txt"
import path from "path"
import * as fs from "fs"
import { Log } from "../util/log"

const log = Log.create({ service: "security-scorecard" })

interface DimensionScore {
  name: string
  score: number
  weight: number
  findings: string[]
  recommendations: string[]
}

async function checkPatternCount(
  rgPath: string,
  pattern: string,
  target: string,
  globPattern: string,
  abort: AbortSignal,
): Promise<number> {
  try {
    const args = [
      "--count",
      "--no-messages",
      "--glob",
      globPattern,
      "--glob",
      "!node_modules",
      "--glob",
      "!.git",
      "--glob",
      "!dist",
      "--glob",
      "!build",
      "--glob",
      "!vendor",
      "--glob",
      "!*.min.js",
      "--glob",
      "!*.lock",
      "--glob",
      "!*.map",
      "--regexp",
      pattern,
      target,
    ]
    const proc = Bun.spawn([rgPath, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      signal: abort,
    })
    const output = await new Response(proc.stdout).text()
    await proc.exited
    let total = 0
    for (const line of output.trim().split("\n")) {
      const match = line.match(/:(\d+)$/)
      if (match) total += parseInt(match[1], 10)
    }
    return total
  } catch {
    return 0
  }
}

async function countFiles(rgPath: string, target: string, glob: string, abort: AbortSignal): Promise<number> {
  try {
    const proc = Bun.spawn([rgPath, "--files", "--glob", glob, "--glob", "!node_modules", "--glob", "!.git", "--glob", "!dist", "--glob", "!build", target], {
      stdout: "pipe",
      stderr: "pipe",
      signal: abort,
    })
    const output = await new Response(proc.stdout).text()
    await proc.exited
    return output.trim().split("\n").filter(Boolean).length
  } catch {
    return 0
  }
}

function calculateGrade(score: number): string {
  if (score >= 97) return "A+"
  if (score >= 93) return "A"
  if (score >= 90) return "A-"
  if (score >= 87) return "B+"
  if (score >= 83) return "B"
  if (score >= 80) return "B-"
  if (score >= 77) return "C+"
  if (score >= 73) return "C"
  if (score >= 70) return "C-"
  if (score >= 67) return "D+"
  if (score >= 63) return "D"
  if (score >= 60) return "D-"
  return "F"
}

export const SecurityScorecardTool = Tool.define("security_scorecard", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      target: z
        .string()
        .optional()
        .describe("Directory to assess. Defaults to project root."),
      verbose: z
        .boolean()
        .default(false)
        .describe("Include detailed breakdown per dimension"),
    }),
    async execute(params, ctx) {
      const target = params.target
        ? path.isAbsolute(params.target)
          ? params.target
          : path.resolve(Instance.directory, params.target)
        : Instance.directory

      await ctx.ask({
        permission: "security_scorecard",
        patterns: [target],
        always: ["*"],
        metadata: { target },
      })

      log.info("calculating security scorecard", { target })

      const rgPath = await Ripgrep.filepath()
      const dimensions: DimensionScore[] = []

      // === 1. CODE SECURITY (25%) ===
      const codeScore: DimensionScore = {
        name: "Code Security",
        score: 100,
        weight: 0.25,
        findings: [],
        recommendations: [],
      }

      // Check for injection vulnerabilities
      const sqlInjections = await checkPatternCount(rgPath, `(query|execute|exec)\\s*\\(\\s*[\"\`'].*\\$\\{`, target, "*.{js,ts,tsx,py}", ctx.abort)
      if (sqlInjections > 0) {
        codeScore.score -= Math.min(30, sqlInjections * 10)
        codeScore.findings.push(`${sqlInjections} potential SQL injection patterns`)
        codeScore.recommendations.push("Use parameterized queries instead of string interpolation in SQL")
      }

      // Check for XSS
      const xssPatterns = await checkPatternCount(rgPath, `\\.innerHTML\\s*=|dangerouslySetInnerHTML|document\\.write`, target, "*.{js,ts,tsx,jsx}", ctx.abort)
      if (xssPatterns > 0) {
        codeScore.score -= Math.min(20, xssPatterns * 5)
        codeScore.findings.push(`${xssPatterns} potential XSS patterns`)
        codeScore.recommendations.push("Sanitize HTML output using DOMPurify or equivalent")
      }

      // Check for eval usage
      const evalUsage = await checkPatternCount(rgPath, `\\beval\\s*\\(`, target, "*.{js,ts,tsx,py}", ctx.abort)
      if (evalUsage > 0) {
        codeScore.score -= Math.min(25, evalUsage * 8)
        codeScore.findings.push(`${evalUsage} eval() usages detected`)
        codeScore.recommendations.push("Remove all eval() usage and use safe alternatives")
      }

      // Check for command injection
      const cmdInjections = await checkPatternCount(rgPath, `(exec|execSync|spawn|system)\\s*\\([^"'\`]*\\+`, target, "*.{js,ts,py,rb}", ctx.abort)
      if (cmdInjections > 0) {
        codeScore.score -= Math.min(30, cmdInjections * 10)
        codeScore.findings.push(`${cmdInjections} potential command injection patterns`)
        codeScore.recommendations.push("Use parameterized commands, avoid shell execution with user input")
      }

      codeScore.score = Math.max(0, codeScore.score)
      dimensions.push(codeScore)

      // === 2. DEPENDENCY SECURITY (20%) ===
      const depScore: DimensionScore = {
        name: "Dependency Security",
        score: 100,
        weight: 0.20,
        findings: [],
        recommendations: [],
      }

      // Check for package.json
      const packageJsonPath = path.join(target, "package.json")
      if (fs.existsSync(packageJsonPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
          const depCount = Object.keys(pkg.dependencies || {}).length
          const devDepCount = Object.keys(pkg.devDependencies || {}).length

          // Check for lock file
          const hasLockFile =
            fs.existsSync(path.join(target, "package-lock.json")) ||
            fs.existsSync(path.join(target, "yarn.lock")) ||
            fs.existsSync(path.join(target, "pnpm-lock.yaml")) ||
            fs.existsSync(path.join(target, "bun.lockb"))

          if (!hasLockFile) {
            depScore.score -= 15
            depScore.findings.push("No lock file found")
            depScore.recommendations.push("Generate and commit a lock file for reproducible builds")
          }

          // Check for wildcard versions
          const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
          let wildcardCount = 0
          for (const version of Object.values(allDeps)) {
            if (version === "*" || version === "latest") wildcardCount++
          }
          if (wildcardCount > 0) {
            depScore.score -= Math.min(20, wildcardCount * 5)
            depScore.findings.push(`${wildcardCount} dependencies with wildcard/latest versions`)
            depScore.recommendations.push("Pin dependency versions for security and reproducibility")
          }

          depScore.findings.push(`${depCount} production deps, ${devDepCount} dev deps`)
        } catch {
          // ignore
        }
      }

      // Check for .npmrc with unsafe settings
      const npmrcPath = path.join(target, ".npmrc")
      if (fs.existsSync(npmrcPath)) {
        try {
          const content = fs.readFileSync(npmrcPath, "utf8")
          if (content.includes("strict-ssl=false")) {
            depScore.score -= 15
            depScore.findings.push("npm strict-ssl disabled")
            depScore.recommendations.push("Enable strict SSL for npm registry connections")
          }
        } catch {
          // ignore
        }
      }

      depScore.score = Math.max(0, depScore.score)
      dimensions.push(depScore)

      // === 3. SECRET MANAGEMENT (15%) ===
      const secretScore: DimensionScore = {
        name: "Secret Management",
        score: 100,
        weight: 0.15,
        findings: [],
        recommendations: [],
      }

      // Check for hardcoded secrets
      const hardcodedPasswords = await checkPatternCount(rgPath, `(password|passwd|pwd)\\s*[=:]\\s*["'][^"'\\s]{8,}["']`, target, "*.{js,ts,py,java,go,rb,php}", ctx.abort)
      if (hardcodedPasswords > 0) {
        secretScore.score -= Math.min(40, hardcodedPasswords * 15)
        secretScore.findings.push(`${hardcodedPasswords} hardcoded passwords`)
        secretScore.recommendations.push("Move all passwords to environment variables or secret manager")
      }

      // Check for API keys
      const apiKeys = await checkPatternCount(rgPath, `(api[_-]?key|apikey)\\s*[=:]\\s*["'][A-Za-z0-9]{20,}["']`, target, "*.{js,ts,py,java,go,rb,php}", ctx.abort)
      if (apiKeys > 0) {
        secretScore.score -= Math.min(30, apiKeys * 10)
        secretScore.findings.push(`${apiKeys} hardcoded API keys`)
        secretScore.recommendations.push("Store API keys in environment variables")
      }

      // Check for private keys
      const privateKeys = await checkPatternCount(rgPath, `-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----`, target, "*", ctx.abort)
      if (privateKeys > 0) {
        secretScore.score -= 40
        secretScore.findings.push(`${privateKeys} private key files in repository`)
        secretScore.recommendations.push("Remove private keys from repository and use secret management")
      }

      // Check for .env files
      const envFiles = await countFiles(rgPath, target, "*.env", ctx.abort)
      const hasGitignoreEnv = fs.existsSync(path.join(target, ".gitignore")) &&
        fs.readFileSync(path.join(target, ".gitignore"), "utf8").includes(".env")

      if (envFiles > 0 && !hasGitignoreEnv) {
        secretScore.score -= 20
        secretScore.findings.push(`${envFiles} .env files found, not in .gitignore`)
        secretScore.recommendations.push("Add .env to .gitignore to prevent committing secrets")
      }

      secretScore.score = Math.max(0, secretScore.score)
      dimensions.push(secretScore)

      // === 4. CONFIGURATION SECURITY (15%) ===
      const configScore: DimensionScore = {
        name: "Configuration Security",
        score: 100,
        weight: 0.15,
        findings: [],
        recommendations: [],
      }

      // Check for TLS verification disabled
      const tlsDisabled = await checkPatternCount(rgPath, `(rejectUnauthorized\\s*:\\s*false|NODE_TLS_REJECT_UNAUTHORIZED.*0|verify\\s*=\\s*False|InsecureSkipVerify.*true)`, target, "*.{js,ts,py,go}", ctx.abort)
      if (tlsDisabled > 0) {
        configScore.score -= Math.min(30, tlsDisabled * 15)
        configScore.findings.push(`${tlsDisabled} TLS verification disabled instances`)
        configScore.recommendations.push("Enable TLS certificate verification in all HTTP clients")
      }

      // Check for CORS wildcard
      const corsWildcard = await checkPatternCount(rgPath, `Access-Control-Allow-Origin.*\\*|cors.*origin.*\\*`, target, "*.{js,ts,py,go,java}", ctx.abort)
      if (corsWildcard > 0) {
        configScore.score -= Math.min(15, corsWildcard * 5)
        configScore.findings.push(`${corsWildcard} CORS wildcard configurations`)
        configScore.recommendations.push("Replace CORS wildcard with specific allowed origins")
      }

      // Check for debug mode
      const debugMode = await checkPatternCount(rgPath, `(DEBUG\\s*=\\s*True|debug\\s*:\\s*true)`, target, "*.{js,ts,py,env}", ctx.abort)
      if (debugMode > 0) {
        configScore.score -= Math.min(10, debugMode * 3)
        configScore.findings.push(`${debugMode} debug mode configurations`)
        configScore.recommendations.push("Ensure debug mode is disabled in production")
      }

      configScore.score = Math.max(0, configScore.score)
      dimensions.push(configScore)

      // === 5. INFRASTRUCTURE SECURITY (10%) ===
      const infraScore: DimensionScore = {
        name: "Infrastructure Security",
        score: 100,
        weight: 0.10,
        findings: [],
        recommendations: [],
      }

      // Check for Dockerfile security
      const hasDockerfile = fs.existsSync(path.join(target, "Dockerfile"))
      if (hasDockerfile) {
        try {
          const dockerfile = fs.readFileSync(path.join(target, "Dockerfile"), "utf8")
          if (dockerfile.includes("FROM") && dockerfile.includes(":latest")) {
            infraScore.score -= 10
            infraScore.findings.push("Dockerfile uses :latest tag")
            infraScore.recommendations.push("Pin Docker base image versions for reproducibility")
          }
          if (dockerfile.match(/USER\s+root/i) || !dockerfile.includes("USER")) {
            infraScore.score -= 15
            infraScore.findings.push("Dockerfile runs as root")
            infraScore.recommendations.push("Add a non-root USER directive to Dockerfile")
          }
        } catch {
          // ignore
        }
      }

      // Check for CI/CD configs
      const hasGHActions = fs.existsSync(path.join(target, ".github", "workflows"))
      if (hasGHActions) {
        infraScore.findings.push("GitHub Actions CI/CD detected")
      }

      // Check for .dockerignore
      if (hasDockerfile && !fs.existsSync(path.join(target, ".dockerignore"))) {
        infraScore.score -= 10
        infraScore.findings.push("No .dockerignore file")
        infraScore.recommendations.push("Create .dockerignore to prevent sensitive files from entering Docker images")
      }

      infraScore.score = Math.max(0, infraScore.score)
      dimensions.push(infraScore)

      // === 6. SECURITY PRACTICES (15%) ===
      const practicesScore: DimensionScore = {
        name: "Security Practices",
        score: 100,
        weight: 0.15,
        findings: [],
        recommendations: [],
      }

      // Check for security testing
      const securityTests = await checkPatternCount(rgPath, `(security|vuln|xss|injection|csrf|auth)`, target, "*.{test,spec}.{js,ts,py}", ctx.abort)
      if (securityTests > 0) {
        practicesScore.findings.push(`${securityTests} security-related test patterns found`)
      } else {
        practicesScore.score -= 20
        practicesScore.findings.push("No security-specific tests detected")
        practicesScore.recommendations.push("Add security-focused test cases (XSS, injection, auth)")
      }

      // Check for SECURITY.md
      const hasSecurityMd =
        fs.existsSync(path.join(target, "SECURITY.md")) || fs.existsSync(path.join(target, ".github", "SECURITY.md"))
      if (hasSecurityMd) {
        practicesScore.findings.push("SECURITY.md found - good disclosure practice")
      } else {
        practicesScore.score -= 10
        practicesScore.findings.push("No SECURITY.md file")
        practicesScore.recommendations.push("Create SECURITY.md with vulnerability disclosure policy")
      }

      // Check for .gitignore
      if (!fs.existsSync(path.join(target, ".gitignore"))) {
        practicesScore.score -= 15
        practicesScore.findings.push("No .gitignore file")
        practicesScore.recommendations.push("Create .gitignore to prevent committing sensitive files")
      }

      // Check for pre-commit hooks
      const hasHusky = fs.existsSync(path.join(target, ".husky"))
      const hasPreCommit = fs.existsSync(path.join(target, ".pre-commit-config.yaml"))
      if (hasHusky || hasPreCommit) {
        practicesScore.findings.push("Git hooks configured for code quality")
      } else {
        practicesScore.score -= 5
        practicesScore.recommendations.push("Set up pre-commit hooks for automated security checks")
      }

      practicesScore.score = Math.max(0, practicesScore.score)
      dimensions.push(practicesScore)

      // === CALCULATE OVERALL SCORE ===
      const overallScore = Math.round(
        dimensions.reduce((sum, d) => sum + d.score * d.weight, 0),
      )
      const grade = calculateGrade(overallScore)

      // Build output
      const outputLines: string[] = []

      outputLines.push("=".repeat(80))
      outputLines.push("  OPENCODE SECURITY SCORECARD")
      outputLines.push("=".repeat(80))
      outputLines.push("")
      outputLines.push(`  Project:  ${path.basename(target)}`)
      outputLines.push(`  Path:     ${target}`)
      outputLines.push(`  Date:     ${new Date().toISOString()}`)
      outputLines.push("")

      // Big score display
      outputLines.push("-".repeat(80))
      outputLines.push("")
      outputLines.push(`       OVERALL SECURITY SCORE: ${grade} (${overallScore}/100)`)
      outputLines.push("")
      outputLines.push("-".repeat(80))
      outputLines.push("")

      // Score bar visualization
      const filled = Math.round(overallScore / 2)
      const empty = 50 - filled
      outputLines.push(`  [${"#".repeat(filled)}${".".repeat(empty)}] ${overallScore}%`)
      outputLines.push("")

      // Dimension breakdown
      outputLines.push("-".repeat(80))
      outputLines.push("  DIMENSION SCORES")
      outputLines.push("-".repeat(80))
      outputLines.push("")
      outputLines.push("  Dimension                | Score | Weight | Weighted |")
      outputLines.push("  " + "-".repeat(65))

      for (const dim of dimensions) {
        const weighted = Math.round(dim.score * dim.weight)
        const dimGrade = calculateGrade(dim.score)
        outputLines.push(
          `  ${dim.name.padEnd(25)}| ${String(dim.score).padStart(3)}/100 (${dimGrade}) | ${String(Math.round(dim.weight * 100)).padStart(3)}%   | ${String(weighted).padStart(3)}     |`,
        )
      }
      outputLines.push("")

      // Detailed dimension findings
      if (params.verbose) {
        for (const dim of dimensions) {
          outputLines.push("-".repeat(80))
          outputLines.push(`  ${dim.name.toUpperCase()} - Details`)
          outputLines.push("-".repeat(80))
          outputLines.push("")
          if (dim.findings.length > 0) {
            outputLines.push("  Findings:")
            for (const f of dim.findings) {
              outputLines.push(`    - ${f}`)
            }
          }
          if (dim.recommendations.length > 0) {
            outputLines.push("  Recommendations:")
            for (const r of dim.recommendations) {
              outputLines.push(`    - ${r}`)
            }
          }
          outputLines.push("")
        }
      }

      // Top recommendations
      const allRecs = dimensions.flatMap((d) =>
        d.recommendations.map((r) => ({ rec: r, dim: d.name, impact: 100 - d.score })),
      )
      allRecs.sort((a, b) => b.impact - a.impact)

      outputLines.push("-".repeat(80))
      outputLines.push("  TOP PRIORITY IMPROVEMENTS")
      outputLines.push("-".repeat(80))
      outputLines.push("")

      const topRecs = allRecs.slice(0, 10)
      for (let i = 0; i < topRecs.length; i++) {
        const r = topRecs[i]
        outputLines.push(`  ${i + 1}. [${r.dim}] ${r.rec}`)
      }

      if (topRecs.length === 0) {
        outputLines.push("  No critical improvements needed. Keep up the good security practices!")
      }

      // Quick wins
      outputLines.push("")
      outputLines.push("-".repeat(80))
      outputLines.push("  QUICK WINS (Easy improvements)")
      outputLines.push("-".repeat(80))
      outputLines.push("")

      const quickWins = [
        !fs.existsSync(path.join(target, "SECURITY.md")) ? "Create a SECURITY.md vulnerability disclosure policy" : null,
        !fs.existsSync(path.join(target, ".gitignore")) ? "Create a .gitignore file" : null,
        "Run dependency_audit tool to identify vulnerable packages",
        "Run secret_scan tool to find exposed credentials",
        "Run security_scan tool for comprehensive vulnerability analysis",
      ].filter(Boolean)

      for (let i = 0; i < quickWins.length; i++) {
        outputLines.push(`  ${i + 1}. ${quickWins[i]}`)
      }

      outputLines.push("")
      outputLines.push("=".repeat(80))
      outputLines.push("  End of Security Scorecard")
      outputLines.push("=".repeat(80))

      return {
        title: `Security Scorecard: ${grade} (${overallScore}/100)`,
        metadata: {
          grade,
          score: overallScore,
          dimensions: Object.fromEntries(dimensions.map((d) => [d.name, d.score])),
        },
        output: outputLines.join("\n"),
      }
    },
  }
})
