import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Ripgrep } from "../file/ripgrep"
import DESCRIPTION from "./secret-scan.txt"
import path from "path"
import { Log } from "../util/log"

const log = Log.create({ service: "secret-scan" })

interface SecretPattern {
  id: string
  title: string
  severity: "critical" | "high" | "medium" | "low"
  pattern: string
  description: string
  service: string
}

const SECRET_PATTERNS: SecretPattern[] = [
  // === AWS ===
  {
    id: "AWS-001",
    title: "AWS Access Key ID",
    severity: "critical",
    pattern: `(?:^|[^A-Za-z0-9])(AKIA[0-9A-Z]{16})(?:$|[^A-Za-z0-9])`,
    description: "AWS Access Key ID found in source code.",
    service: "AWS",
  },
  {
    id: "AWS-002",
    title: "AWS Secret Access Key",
    severity: "critical",
    pattern: `(?:aws_secret_access_key|aws_secret_key|secret_key|secretAccessKey)\\s*[=:]\\s*["']?[A-Za-z0-9/+=]{40}["']?`,
    description: "AWS Secret Access Key found in source code.",
    service: "AWS",
  },
  {
    id: "AWS-003",
    title: "AWS MWS Key",
    severity: "critical",
    pattern: `amzn\\.mws\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`,
    description: "Amazon MWS auth token found.",
    service: "AWS",
  },

  // === GCP ===
  {
    id: "GCP-001",
    title: "Google Cloud API Key",
    severity: "critical",
    pattern: `AIza[0-9A-Za-z_-]{35}`,
    description: "Google Cloud Platform API key found in source code.",
    service: "Google Cloud",
  },
  {
    id: "GCP-002",
    title: "Google OAuth Client Secret",
    severity: "high",
    pattern: `GOCSPX-[A-Za-z0-9_-]{28}`,
    description: "Google OAuth client secret found in source code.",
    service: "Google Cloud",
  },
  {
    id: "GCP-003",
    title: "Google Service Account Key",
    severity: "critical",
    pattern: `"type"\\s*:\\s*"service_account"`,
    description: "Google Cloud service account key file detected.",
    service: "Google Cloud",
  },

  // === Azure ===
  {
    id: "AZURE-001",
    title: "Azure Storage Account Key",
    severity: "critical",
    pattern: `(?:AccountKey|account_key|storage_key)\\s*[=:]\\s*["']?[A-Za-z0-9+/]{86}==["']?`,
    description: "Azure Storage account key found in source code.",
    service: "Azure",
  },
  {
    id: "AZURE-002",
    title: "Azure AD Client Secret",
    severity: "critical",
    pattern: `(?:client_secret|clientSecret|AZURE_CLIENT_SECRET)\\s*[=:]\\s*["'][A-Za-z0-9~._-]{34,}["']`,
    description: "Azure Active Directory client secret found.",
    service: "Azure",
  },

  // === GitHub ===
  {
    id: "GH-001",
    title: "GitHub Personal Access Token",
    severity: "critical",
    pattern: `ghp_[A-Za-z0-9]{36}`,
    description: "GitHub personal access token (classic) found in source code.",
    service: "GitHub",
  },
  {
    id: "GH-002",
    title: "GitHub Fine-Grained Token",
    severity: "critical",
    pattern: `github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}`,
    description: "GitHub fine-grained personal access token found.",
    service: "GitHub",
  },
  {
    id: "GH-003",
    title: "GitHub OAuth Access Token",
    severity: "critical",
    pattern: `gho_[A-Za-z0-9]{36}`,
    description: "GitHub OAuth access token found.",
    service: "GitHub",
  },
  {
    id: "GH-004",
    title: "GitHub App Token",
    severity: "critical",
    pattern: `(ghu|ghs)_[A-Za-z0-9]{36}`,
    description: "GitHub App installation or user-to-server token found.",
    service: "GitHub",
  },

  // === GitLab ===
  {
    id: "GL-001",
    title: "GitLab Personal Access Token",
    severity: "critical",
    pattern: `glpat-[A-Za-z0-9_-]{20}`,
    description: "GitLab personal access token found.",
    service: "GitLab",
  },

  // === Stripe ===
  {
    id: "STRIPE-001",
    title: "Stripe Secret Key",
    severity: "critical",
    pattern: `sk_(live|test)_[A-Za-z0-9]{20,}`,
    description: "Stripe secret API key found in source code.",
    service: "Stripe",
  },
  {
    id: "STRIPE-002",
    title: "Stripe Restricted Key",
    severity: "high",
    pattern: `rk_(live|test)_[A-Za-z0-9]{20,}`,
    description: "Stripe restricted API key found.",
    service: "Stripe",
  },

  // === Slack ===
  {
    id: "SLACK-001",
    title: "Slack Bot Token",
    severity: "critical",
    pattern: `xoxb-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24}`,
    description: "Slack bot token found in source code.",
    service: "Slack",
  },
  {
    id: "SLACK-002",
    title: "Slack User Token",
    severity: "critical",
    pattern: `xoxp-[0-9]{10,}-[0-9]{10,}-[0-9]{10,}-[A-Fa-f0-9]{32}`,
    description: "Slack user OAuth token found.",
    service: "Slack",
  },
  {
    id: "SLACK-003",
    title: "Slack Webhook URL",
    severity: "high",
    pattern: `https://hooks\\.slack\\.com/services/T[A-Z0-9]{8,}/B[A-Z0-9]{8,}/[A-Za-z0-9]{24}`,
    description: "Slack incoming webhook URL found.",
    service: "Slack",
  },

  // === Twilio ===
  {
    id: "TWILIO-001",
    title: "Twilio API Key",
    severity: "high",
    pattern: `SK[0-9a-fA-F]{32}`,
    description: "Twilio API key found in source code.",
    service: "Twilio",
  },

  // === SendGrid ===
  {
    id: "SG-001",
    title: "SendGrid API Key",
    severity: "high",
    pattern: `SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}`,
    description: "SendGrid API key found in source code.",
    service: "SendGrid",
  },

  // === Mailgun ===
  {
    id: "MG-001",
    title: "Mailgun API Key",
    severity: "high",
    pattern: `key-[0-9a-zA-Z]{32}`,
    description: "Mailgun API key found in source code.",
    service: "Mailgun",
  },

  // === JWT / Auth Tokens ===
  {
    id: "JWT-001",
    title: "JSON Web Token",
    severity: "high",
    pattern: `eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}`,
    description: "JWT token found in source code. May contain sensitive claims.",
    service: "JWT",
  },

  // === Private Keys ===
  {
    id: "KEY-001",
    title: "RSA Private Key",
    severity: "critical",
    pattern: `-----BEGIN RSA PRIVATE KEY-----`,
    description: "RSA private key found in source code.",
    service: "Cryptography",
  },
  {
    id: "KEY-002",
    title: "SSH Private Key (OpenSSH)",
    severity: "critical",
    pattern: `-----BEGIN OPENSSH PRIVATE KEY-----`,
    description: "OpenSSH private key found in source code.",
    service: "SSH",
  },
  {
    id: "KEY-003",
    title: "PGP Private Key",
    severity: "critical",
    pattern: `-----BEGIN PGP PRIVATE KEY BLOCK-----`,
    description: "PGP private key found in source code.",
    service: "PGP",
  },
  {
    id: "KEY-004",
    title: "EC Private Key",
    severity: "critical",
    pattern: `-----BEGIN EC PRIVATE KEY-----`,
    description: "Elliptic Curve private key found in source code.",
    service: "Cryptography",
  },
  {
    id: "KEY-005",
    title: "Generic Private Key",
    severity: "critical",
    pattern: `-----BEGIN PRIVATE KEY-----`,
    description: "Private key found in source code.",
    service: "Cryptography",
  },

  // === Database Connection Strings ===
  {
    id: "DB-001",
    title: "Database Connection String with Password",
    severity: "critical",
    pattern: `(mongodb|postgres|postgresql|mysql|redis|amqp)://[^:]+:[^@]+@[^\\s"']+`,
    description: "Database connection string with embedded credentials found.",
    service: "Database",
  },
  {
    id: "DB-002",
    title: "Database Password in Config",
    severity: "high",
    pattern: `(DB_PASSWORD|DATABASE_PASSWORD|MYSQL_PASSWORD|POSTGRES_PASSWORD|MONGO_PASSWORD)\\s*[=:]\\s*["']?[^\\s"']{8,}`,
    description: "Database password found in configuration.",
    service: "Database",
  },

  // === Generic Patterns ===
  {
    id: "GEN-001",
    title: "Hardcoded Password Assignment",
    severity: "high",
    pattern: `(?:password|passwd|pwd|pass)\\s*[=:]\\s*["'][^"'\\n]{8,64}["']`,
    description: "Hardcoded password found in source code.",
    service: "Generic",
  },
  {
    id: "GEN-002",
    title: "Hardcoded Secret/Token Assignment",
    severity: "high",
    pattern: `(?:secret|token|api_key|apikey|access_key|auth_token|client_secret)\\s*[=:]\\s*["'][A-Za-z0-9+/=_-]{20,}["']`,
    description: "Hardcoded secret or token found in source code.",
    service: "Generic",
  },
  {
    id: "GEN-003",
    title: "Bearer Token in Source",
    severity: "high",
    pattern: `(?:Authorization|authorization)\\s*[=:]\\s*["']Bearer\\s+[A-Za-z0-9._-]{20,}["']`,
    description: "Hardcoded Bearer authentication token found.",
    service: "Generic",
  },
  {
    id: "GEN-004",
    title: "Basic Auth Credentials",
    severity: "high",
    pattern: `(?:Authorization|authorization)\\s*[=:]\\s*["']Basic\\s+[A-Za-z0-9+/=]{10,}["']`,
    description: "Hardcoded Basic authentication credentials found.",
    service: "Generic",
  },

  // === Blockchain ===
  {
    id: "CRYPTO-001",
    title: "Ethereum Private Key",
    severity: "critical",
    pattern: `(?:0x)?[0-9a-fA-F]{64}`,
    description: "Potential Ethereum private key found (64 hex characters).",
    service: "Blockchain",
  },

  // === Heroku ===
  {
    id: "HEROKU-001",
    title: "Heroku API Key",
    severity: "high",
    pattern: `(?:heroku_api_key|HEROKU_API_KEY)\\s*[=:]\\s*["']?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`,
    description: "Heroku API key found in source code.",
    service: "Heroku",
  },

  // === Firebase ===
  {
    id: "FIREBASE-001",
    title: "Firebase Cloud Messaging Key",
    severity: "high",
    pattern: `AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}`,
    description: "Firebase Cloud Messaging server key found.",
    service: "Firebase",
  },

  // === npm ===
  {
    id: "NPM-001",
    title: "npm Access Token",
    severity: "critical",
    pattern: `npm_[A-Za-z0-9]{36}`,
    description: "npm access token found in source code.",
    service: "npm",
  },

  // === PyPI ===
  {
    id: "PYPI-001",
    title: "PyPI API Token",
    severity: "critical",
    pattern: `pypi-[A-Za-z0-9_-]{50,}`,
    description: "PyPI API token found in source code.",
    service: "PyPI",
  },

  // === Docker ===
  {
    id: "DOCKER-001",
    title: "Docker Hub Token",
    severity: "high",
    pattern: `dckr_pat_[A-Za-z0-9_-]{27}`,
    description: "Docker Hub personal access token found.",
    service: "Docker",
  },

  // === Shopify ===
  {
    id: "SHOPIFY-001",
    title: "Shopify Access Token",
    severity: "high",
    pattern: `shpat_[A-Fa-f0-9]{32}`,
    description: "Shopify Admin API access token found.",
    service: "Shopify",
  },
  {
    id: "SHOPIFY-002",
    title: "Shopify Secret",
    severity: "high",
    pattern: `shpss_[A-Fa-f0-9]{32}`,
    description: "Shopify shared secret found.",
    service: "Shopify",
  },

  // === Anthropic ===
  {
    id: "ANTHROPIC-001",
    title: "Anthropic API Key",
    severity: "critical",
    pattern: `sk-ant-[A-Za-z0-9_-]{90,}`,
    description: "Anthropic API key found in source code.",
    service: "Anthropic",
  },

  // === OpenAI ===
  {
    id: "OPENAI-001",
    title: "OpenAI API Key",
    severity: "critical",
    pattern: `sk-[A-Za-z0-9]{48}`,
    description: "OpenAI API key found in source code.",
    service: "OpenAI",
  },

  // === Supabase ===
  {
    id: "SUPABASE-001",
    title: "Supabase Service Role Key",
    severity: "critical",
    pattern: `sbp_[A-Fa-f0-9]{40}`,
    description: "Supabase service role key found in source code.",
    service: "Supabase",
  },

  // === Vercel ===
  {
    id: "VERCEL-001",
    title: "Vercel Access Token",
    severity: "high",
    pattern: `(?:vercel_token|VERCEL_TOKEN)\\s*[=:]\\s*["']?[A-Za-z0-9]{24}`,
    description: "Vercel access token found.",
    service: "Vercel",
  },
]

function calculateEntropy(str: string): number {
  const freq = new Map<string, number>()
  for (const char of str) {
    freq.set(char, (freq.get(char) || 0) + 1)
  }
  let entropy = 0
  const len = str.length
  for (const count of freq.values()) {
    const p = count / len
    entropy -= p * Math.log2(p)
  }
  return entropy
}

export const SecretScanTool = Tool.define("secret_scan", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      target: z
        .string()
        .optional()
        .describe("File or directory to scan. Defaults to project root."),
      mode: z
        .enum(["quick", "thorough", "git-history"])
        .default("thorough")
        .describe("Scan mode - quick (high-confidence only), thorough (includes entropy analysis), git-history (includes git log)"),
      include: z
        .string()
        .optional()
        .describe('File pattern to include (e.g. "*.py", "*.{js,ts}")'),
      service: z
        .string()
        .optional()
        .describe("Filter by service name (e.g., AWS, GitHub, Stripe)"),
    }),
    async execute(params, ctx) {
      const target = params.target
        ? path.isAbsolute(params.target)
          ? params.target
          : path.resolve(Instance.directory, params.target)
        : Instance.directory

      await ctx.ask({
        permission: "secret_scan",
        patterns: [target],
        always: ["*"],
        metadata: { mode: params.mode, target },
      })

      log.info("starting secret scan", { target, mode: params.mode })

      const filteredPatterns = params.service
        ? SECRET_PATTERNS.filter((p) => p.service.toLowerCase() === params.service!.toLowerCase())
        : params.mode === "quick"
          ? SECRET_PATTERNS.filter((p) => p.severity === "critical")
          : SECRET_PATTERNS

      const findings: Array<{
        pattern: SecretPattern
        file: string
        line: number
        code: string
        entropy?: number
      }> = []

      const rgPath = await Ripgrep.filepath()

      for (const secret of filteredPatterns) {
        try {
          const args = ["-nH", "--no-messages", "--field-match-separator=|", "--regexp", secret.pattern]

          if (params.include) {
            args.push("--glob", params.include)
          }

          // Exclude common non-source files
          args.push("--glob", "!node_modules")
          args.push("--glob", "!.git")
          args.push("--glob", "!dist")
          args.push("--glob", "!build")
          args.push("--glob", "!vendor")
          args.push("--glob", "!*.lock")
          args.push("--glob", "!*.min.js")
          args.push("--glob", "!*.map")
          args.push("--glob", "!package-lock.json")
          args.push("--glob", "!yarn.lock")
          args.push("--glob", "!pnpm-lock.yaml")
          args.push("--glob", "!*.png")
          args.push("--glob", "!*.jpg")
          args.push("--glob", "!*.gif")
          args.push("--glob", "!*.ico")
          args.push("--glob", "!*.woff*")
          args.push("--glob", "!*.ttf")

          args.push(target)

          const proc = Bun.spawn([rgPath, ...args], {
            stdout: "pipe",
            stderr: "pipe",
            signal: ctx.abort,
          })

          const output = await new Response(proc.stdout).text()
          await proc.exited

          if (output.trim()) {
            const lines = output.trim().split(/\r?\n/)
            for (const line of lines) {
              if (!line) continue
              const [filePath, lineNumStr, ...codeParts] = line.split("|")
              if (!filePath || !lineNumStr) continue

              const code = codeParts.join("|").trim()

              // Skip test files and example files for reduced false positives
              if (
                filePath.includes(".test.") ||
                filePath.includes(".spec.") ||
                filePath.includes("__tests__") ||
                filePath.includes("example") ||
                filePath.includes("fixture") ||
                filePath.includes(".md") ||
                filePath.endsWith(".txt")
              ) {
                continue
              }

              // Calculate entropy for additional context
              const entropy = calculateEntropy(code)

              findings.push({
                pattern: secret,
                file: filePath,
                line: parseInt(lineNumStr, 10),
                code: code.substring(0, 150),
                entropy,
              })
            }
          }
        } catch {
          // Pattern scan failed, continue with next
        }
      }

      // Sort by severity
      const severityOrder = ["critical", "high", "medium", "low"]
      findings.sort((a, b) => severityOrder.indexOf(a.pattern.severity) - severityOrder.indexOf(b.pattern.severity))

      // Git history scan
      let gitHistoryFindings = 0
      if (params.mode === "git-history") {
        try {
          const proc = Bun.spawn(
            ["git", "log", "--all", "--diff-filter=D", "--name-only", "--pretty=format:", "--", "*.env", "*.key", "*.pem", "*.p12", "*.pfx"],
            {
              cwd: target,
              stdout: "pipe",
              stderr: "pipe",
              signal: ctx.abort,
            },
          )
          const output = await new Response(proc.stdout).text()
          await proc.exited
          gitHistoryFindings = output
            .trim()
            .split("\n")
            .filter((l) => l.trim()).length
        } catch {
          // git history scan failed
        }
      }

      // Build output
      const outputLines: string[] = []
      const bySeverity = {
        critical: findings.filter((f) => f.pattern.severity === "critical").length,
        high: findings.filter((f) => f.pattern.severity === "high").length,
        medium: findings.filter((f) => f.pattern.severity === "medium").length,
        low: findings.filter((f) => f.pattern.severity === "low").length,
      }

      outputLines.push("=".repeat(80))
      outputLines.push("  OPENCODE SECRET SCAN REPORT")
      outputLines.push("=".repeat(80))
      outputLines.push("")
      outputLines.push(`  Target:     ${target}`)
      outputLines.push(`  Scan Mode:  ${params.mode.toUpperCase()}`)
      outputLines.push(`  Date:       ${new Date().toISOString()}`)
      outputLines.push(`  Patterns:   ${filteredPatterns.length} secret patterns checked`)
      outputLines.push("")

      outputLines.push("-".repeat(80))
      outputLines.push("  SUMMARY")
      outputLines.push("-".repeat(80))
      outputLines.push(`  Total Secrets Found: ${findings.length}`)
      outputLines.push(`  Critical: ${bySeverity.critical}  |  High: ${bySeverity.high}  |  Medium: ${bySeverity.medium}  |  Low: ${bySeverity.low}`)
      if (params.mode === "git-history") {
        outputLines.push(`  Deleted sensitive files in git history: ${gitHistoryFindings}`)
      }
      outputLines.push("")

      // Service breakdown
      const byService = new Map<string, number>()
      for (const f of findings) {
        byService.set(f.pattern.service, (byService.get(f.pattern.service) || 0) + 1)
      }

      if (byService.size > 0) {
        outputLines.push("-".repeat(80))
        outputLines.push("  AFFECTED SERVICES")
        outputLines.push("-".repeat(80))
        for (const [service, count] of [...byService.entries()].sort((a, b) => b[1] - a[1])) {
          outputLines.push(`  ${service}: ${count} secret(s) exposed`)
        }
        outputLines.push("")
      }

      if (findings.length === 0) {
        outputLines.push("  No exposed secrets detected. The scanned code appears clean.")
        outputLines.push("")
        outputLines.push("  RECOMMENDATION: Continue to use environment variables and secret")
        outputLines.push("  management services for all sensitive configuration values.")
      } else {
        outputLines.push("-".repeat(80))
        outputLines.push("  DETAILED FINDINGS")
        outputLines.push("-".repeat(80))

        for (let i = 0; i < findings.length; i++) {
          const f = findings[i]
          const relPath = path.relative(Instance.directory, f.file)
          const maskedCode = f.code.replace(/([A-Za-z0-9+/=_-]{6})[A-Za-z0-9+/=_-]{10,}/g, "$1****")

          outputLines.push("")
          outputLines.push(`  [${f.pattern.severity.toUpperCase()}] Finding #${i + 1}: ${f.pattern.title}`)
          outputLines.push(`  ${"~".repeat(70)}`)
          outputLines.push(`  ID:          ${f.pattern.id}`)
          outputLines.push(`  Service:     ${f.pattern.service}`)
          outputLines.push(`  File:        ${relPath}:${f.line}`)
          outputLines.push(`  Description: ${f.pattern.description}`)
          outputLines.push(`  Code:        ${maskedCode}`)
          if (f.entropy !== undefined) {
            outputLines.push(`  Entropy:     ${f.entropy.toFixed(2)} bits/char`)
          }
        }

        outputLines.push("")
        outputLines.push("-".repeat(80))
        outputLines.push("  IMMEDIATE ACTIONS REQUIRED")
        outputLines.push("-".repeat(80))
        outputLines.push("")
        outputLines.push("  1. ROTATE all exposed credentials immediately")
        outputLines.push("  2. REVOKE and regenerate affected API keys and tokens")
        outputLines.push("  3. MOVE secrets to environment variables or a secret manager")
        outputLines.push("  4. CHECK git history for previously committed secrets")
        outputLines.push("  5. ADD patterns to .gitignore to prevent future exposure")
        outputLines.push("  6. ENABLE pre-commit hooks to block secret commits")
        if (gitHistoryFindings > 0) {
          outputLines.push(`  7. PURGE ${gitHistoryFindings} sensitive files from git history using git filter-branch or BFG Repo-Cleaner`)
        }
      }

      outputLines.push("")
      outputLines.push("=".repeat(80))
      outputLines.push("  End of Secret Scan Report")
      outputLines.push("=".repeat(80))

      return {
        title: `Secret Scan: ${findings.length} secrets found (${bySeverity.critical}C/${bySeverity.high}H)`,
        metadata: {
          total: findings.length,
          critical: bySeverity.critical,
          high: bySeverity.high,
          medium: bySeverity.medium,
          low: bySeverity.low,
          services: Object.fromEntries(byService),
        },
        output: outputLines.join("\n"),
      }
    },
  }
})
