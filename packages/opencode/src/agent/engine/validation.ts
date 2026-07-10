import ts from "typescript"

export interface ValidationResult {
  layer: "syntax" | "semantic" | "runtime" | "security"
  score: number   // 0-1 per whitepaper §10.2
  report: string
}

export interface ValidationConfig {
  threshold: number   // default 0.7
  maxRetries: number  // default 3
}

export interface PermissionRuleset {
  allowBash?: boolean
  allowWrite?: boolean
  allowNetwork?: boolean
  allowedPaths?: string[]
  blockedPatterns?: string[]
}

/** LLM reviewer callback — per whitepaper §10.2: "LLM reviewer compares output against original goal" */
export type LLMReviewFn = (output: string, originalGoal: string) => Promise<{ score: number; report: string }>

/** External security scanner callback — per whitepaper §10.2: "semgrep, bandit, static scan" */
export type ExternalSecurityScanner = (code: string) => Promise<string[]>

const LIKELY_TS_JS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i

const SECURITY_PATTERNS = {
  destructive: [
    "rm -rf /",
    "rm -rf ~",
    "rm -rf .",
    "dd if=",
    "mkfs.",
    ":(){ :|:& };:",  // fork bomb
    "> /dev/sda",
    "> /dev/hda",
    "chmod 777 /",
    "chmod -R 777 /",
  ],
  sqlInjection: [
    "DROP TABLE",
    "DROP DATABASE",
    "TRUNCATE TABLE",
    "'; DROP",
    "'; DELETE",
    "1=1",
    "OR '1'='1'",
  ],
  pathTraversal: [
    "/etc/passwd",
    "/etc/shadow",
    "../../../",
    "....//....//",
    "%2e%2e%2f",
    "..\\..\\..\\",
  ],
  codeInjection: [
    "eval(",
    "exec(",
    "system(",
    "shell_exec(",
    "passthru(",
    "popen(",
    "proc_open(",
    "assert(",
    "Function(",
    "new Function",
    "process.mainModule",
    "require('child_process')",
    "spawn(",
    "fork(",
    "subprocess.call(",
    "os.system(",
  ],
  cryptoMining: [
    "stratum+tcp://",
    "xmrig",
    "minerd",
    "cgminer",
    "cpuminer",
    "cryptonight",
    "nicehash",
  ],
  reverseShell: [
    "nc -e /bin/sh",
    "nc -e /bin/bash",
    "bash -i >&",
    "python -c 'import socket",
    "perl -e 'use Socket",
    "ruby -rsocket",
    "php -r '$sock=fsockopen",
    "/dev/tcp/",
  ],
} as const

export class ValidationNetwork {
  private config: ValidationConfig

  constructor(config?: Partial<ValidationConfig>) {
    this.config = {
      threshold: config?.threshold ?? 0.7,
      maxRetries: config?.maxRetries ?? 3,
    }
  }

  async runSyntaxValidation(code: string, filePath: string): Promise<ValidationResult> {
    const issues: string[] = []

    // Primary: TypeScript AST parsing for TS/JS files
    if (LIKELY_TS_JS.test(filePath)) {
      const astIssues = tryParseWithTypeScript(code, filePath)
      issues.push(...astIssues)
    }

    // Fallback: regex-based checks (also catches non-TS/JS files)
    if (code.includes("const const") || code.includes("let let") || code.includes("var var")) {
      issues.push("Duplicate variable declaration")
    }
    if (!LIKELY_TS_JS.test(filePath)) {
      if ((code.match(/\{/g) || []).length !== (code.match(/\}/g) || []).length) {
        issues.push("Mismatched braces")
      }
      if ((code.match(/\(/g) || []).length !== (code.match(/\)/g) || []).length) {
        issues.push("Mismatched parentheses")
      }
      if ((code.match(/\[/g) || []).length !== (code.match(/\]/g) || []).length) {
        issues.push("Mismatched brackets")
      }
    }

    const bareTodos = code.match(/\/\/\s*TODO\s*$/gm) || []
    if (bareTodos.length > 0) {
      issues.push(`${bareTodos.length} bare TODO comment(s) without description`)
    }

    const score = issues.length === 0 ? 1.0 : Math.max(0, 1.0 - issues.length * 0.15)
    return {
      layer: "syntax",
      score,
      report: issues.length > 0 ? issues.join("; ") : "Syntax check passed",
    }
  }

  /**
   * Semantic validation — per whitepaper §10.2: "LLM reviewer compares output against original goal"
   * When `llmReview` is provided, delegates to the LLM for proper semantic comparison.
   * When omitted, falls back to keyword-based relevance scoring.
   */
  async runSemanticValidation(
    output: string,
    originalGoal: string,
    llmReview?: LLMReviewFn,
  ): Promise<ValidationResult> {
    if (llmReview) {
      const { score, report } = await llmReview(output, originalGoal)
      return {
        layer: "semantic",
        score: Math.max(0, Math.min(1.0, score)),
        report: `LLM review: ${report}`,
      }
    }

    // Fallback: keyword-based relevance scoring
    const outputLower = output.toLowerCase()
    const goalKeywords = originalGoal
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
    const matchedKeywords = goalKeywords.filter((kw) => outputLower.includes(kw))

    const outputLengthPenalty = output.length < 20 ? 0.1 : 0
    const score = goalKeywords.length > 0
      ? matchedKeywords.length / goalKeywords.length - outputLengthPenalty
      : 0.5

    return {
      layer: "semantic",
      score: Math.max(0, Math.min(1.0, score + 0.3)),
      report: `[fallback] Goal relevance: ${matchedKeywords.length}/${goalKeywords.length} keywords matched`,
    }
  }

  /**
   * Runtime validation — per whitepaper §10.2: "Execute tests/builds"
   * Accepts optional test suite and build outputs for structured error extraction.
   * Categorizes errors by type: compilation, test failure, runtime crash, build error.
   */
  async runRuntimeValidation(
    output: string,
    testOutput?: string,
    buildOutput?: string,
  ): Promise<ValidationResult> {
    const allOutput = [output, testOutput, buildOutput].filter(Boolean).join("\n")
    const errors = extractStructuredErrors(allOutput)

    if (errors.length === 0) {
      return { layer: "runtime", score: 1.0, report: "No runtime errors detected" }
    }

    const severityWeights: Record<string, number> = {
      crash: 1.0,
      compilation: 0.9,
      test_failure: 0.7,
      build_error: 0.8,
      runtime_error: 0.6,
      warning: 0.3,
    }
    const penalty = errors.reduce((sum, e) => sum + (severityWeights[e.category] ?? 0.5) * 0.1, 0)
    const score = Math.max(0, 1.0 - penalty)

    const byCategory = new Map<string, number>()
    for (const e of errors) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1)
    }
    const summary = Array.from(byCategory.entries())
      .map(([cat, count]) => `${cat}(${count})`)
      .join(", ")

    return {
      layer: "runtime",
      score,
      report: `Runtime issues detected: ${summary}`,
    }
  }

  /**
   * Security validation — per whitepaper §10.2: "semgrep, bandit, static scan"
   * When `externalScanner` is provided (e.g. semgrep wrapper), runs it alongside built-in patterns.
   * Built-in: 40+ regex patterns across 6 categories + permission-aware checks.
   */
  async runSecurityValidation(
    code: string,
    permission?: PermissionRuleset,
    externalScanner?: ExternalSecurityScanner,
  ): Promise<ValidationResult> {
    const found: string[] = []
    const codeLower = code.toLowerCase()

    for (const pattern of SECURITY_PATTERNS.destructive) {
      if (codeLower.includes(pattern.toLowerCase())) {
        found.push(`destructive: ${pattern}`)
      }
    }
    for (const pattern of SECURITY_PATTERNS.sqlInjection) {
      if (codeLower.includes(pattern.toLowerCase())) {
        found.push(`sql_injection: ${pattern}`)
      }
    }
    for (const pattern of SECURITY_PATTERNS.pathTraversal) {
      if (codeLower.includes(pattern.toLowerCase())) {
        found.push(`path_traversal: ${pattern}`)
      }
    }
    for (const pattern of SECURITY_PATTERNS.codeInjection) {
      if (codeLower.includes(pattern.toLowerCase())) {
        found.push(`code_injection: ${pattern}`)
      }
    }
    for (const pattern of SECURITY_PATTERNS.cryptoMining) {
      if (codeLower.includes(pattern.toLowerCase())) {
        found.push(`crypto_mining: ${pattern}`)
      }
    }
    for (const pattern of SECURITY_PATTERNS.reverseShell) {
      if (codeLower.includes(pattern.toLowerCase())) {
        found.push(`reverse_shell: ${pattern}`)
      }
    }

    // External scanner (semgrep/bandit equivalent)
    if (externalScanner) {
      try {
        const externalIssues = await externalScanner(code)
        for (const issue of externalIssues) {
          found.push(`external: ${issue}`)
        }
      } catch {
        found.push("external: security scanner failed to execute")
      }
    }

    // Permission-aware checks
    if (permission) {
      if (!permission.allowBash && /bash|shell|exec|spawn/i.test(code)) {
        found.push("permission: bash/shell execution not allowed")
      }
      if (!permission.allowWrite && /write|create|save/i.test(code)) {
        found.push("permission: file write not allowed")
      }
      if (!permission.allowNetwork && /fetch|http|curl|wget|axios/i.test(code)) {
        found.push("permission: network access not allowed")
      }
      if (permission.blockedPatterns) {
        for (const blocked of permission.blockedPatterns) {
          if (codeLower.includes(blocked.toLowerCase())) {
            found.push(`permission: blocked pattern "${blocked}"`)
          }
        }
      }
    }

    const score = found.length === 0 ? 1.0 : Math.max(0, 1.0 - found.length * 0.25)

    return {
      layer: "security",
      score,
      report: found.length > 0 ? `Security concerns found: ${found.join(", ")}` : "Security check passed",
    }
  }

  calculateConfidence(results: ValidationResult[]): number {
    const weights: Record<ValidationResult["layer"], number> = {
      syntax: 0.2,
      semantic: 0.3,
      runtime: 0.3,
      security: 0.2,
    }
    const total = results.reduce((sum, r) => sum + r.score * weights[r.layer], 0)
    return Math.round(total * 100) / 100
  }

  shouldRetry(confidence: number, retryCount: number): boolean {
    return confidence < this.config.threshold && retryCount < this.config.maxRetries
  }

  getThreshold(): number {
    return this.config.threshold
  }

  getMaxRetries(): number {
    return this.config.maxRetries
  }
}

function tryParseWithTypeScript(code: string, filePath: string): string[] {
  const issues: string[] = []
  const source = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true)

  const parseDiagnostics = collectParseErrors(source, code)
  issues.push(...parseDiagnostics)

  // AST walk for quality checks
  const walkCtx: WalkContext = { issues, source }
  walkAST(source, walkCtx)

  return issues
}

interface WalkContext {
  issues: string[]
  source: ts.SourceFile
}

function collectParseErrors(source: ts.SourceFile, code: string): string[] {
  const issues: string[] = []

  // TypeScript stores parse diagnostics directly on the SourceFile
  const diags = (source as any).parseDiagnostics as ts.Diagnostic[] | undefined
  if (diags && diags.length > 0) {
    for (const diag of diags) {
      if (diag.start !== undefined && diag.length !== undefined) {
        const snippet = code.slice(diag.start, diag.start + diag.length)
        issues.push(`Parse error: ${ts.flattenDiagnosticMessageText(diag.messageText, "\n")} at "${snippet}"`)
      } else {
        issues.push(`Parse error: ${ts.flattenDiagnosticMessageText(diag.messageText, "\n")}`)
      }
    }
  }

  return issues
}

function walkAST(node: ts.Node, ctx: WalkContext): void {
  // Detect empty catch blocks
  if (ts.isCatchClause(node)) {
    if (node.block && node.block.statements.length === 0) {
      ctx.issues.push("Empty catch block — swallowing errors silently")
    }
  }

  // Detect "any" type usage (unless explicit)
  if (ts.isTypeNode(node) && node.kind === ts.SyntaxKind.AnyKeyword) {
    ctx.issues.push("Usage of 'any' type — consider a more specific type")
  }

  // Detect console.log in production-looking code
  if (ts.isCallExpression(node)) {
    const expr = node.expression
    if (
      ts.isPropertyAccessExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === "console" &&
      ["log", "warn", "error", "debug"].includes(expr.name.text)
    ) {
      ctx.issues.push(`console.${expr.name.text}() call — remove before production`)
    }
  }

  // Detect empty block statements (not catch)
  if (ts.isBlock(node) && node.statements.length === 0) {
    const parent = node.parent
    if (parent && !ts.isFunctionDeclaration(parent) && !ts.isMethodDeclaration(parent) &&
        !ts.isIfStatement(parent) && !ts.isCatchClause(parent) && !ts.isForStatement(parent) &&
        !ts.isWhileStatement(parent) && !ts.isTryStatement(parent)) {
      ctx.issues.push("Empty block statement — dead code or incomplete logic")
    }
  }

  // Detect eval() calls
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "eval") {
    ctx.issues.push("eval() call detected — security risk, consider alternatives")
  }

  ts.forEachChild(node, (child) => walkAST(child, ctx))
}

interface StructuredError {
  category: "crash" | "compilation" | "test_failure" | "build_error" | "runtime_error" | "warning"
  message: string
  filePath?: string
  lineNumber?: number
}

function extractStructuredErrors(output: string): StructuredError[] {
  const errors: StructuredError[] = []
  const outputLower = output.toLowerCase()

  // Compilation errors: tsc, gcc, rustc style
  const compilationPatterns = [
    /error\s+TS\d{4}:/gi,
    /error:\s*(expected|undeclared|cannot find)/gi,
    /compilation failed/gi,
    /syntax error/gi,
  ]
  for (const pattern of compilationPatterns) {
    for (const match of output.matchAll(pattern)) {
      const ctx = output.slice(Math.max(0, match.index! - 20), match.index! + 80)
      errors.push({ category: "compilation", message: ctx.trim(), lineNumber: extractLineNumber(ctx) })
    }
  }

  // Test failures: jest, vitest, pytest style
  const testPatterns = [
    /tests?\s+failed/gi,
    /\bfail\b.*\d+\s+test/gi,
    /assertion.*failed/gi,
    /expected.*but got/gi,
    /assertionerror/gi,
    /expect\(.*\)\.toBe/gi,
  ]
  for (const pattern of testPatterns) {
    for (const match of output.matchAll(pattern)) {
      const ctx = output.slice(Math.max(0, match.index! - 30), match.index! + 100)
      errors.push({ category: "test_failure", message: ctx.trim() })
    }
  }

  // Runtime errors: JS/TS/Python style
  const runtimePatterns = [
    /\btypeerror\b/gi,
    /\breferenceerror\b/gi,
    /\brangeerror\b/gi,
    /\burierror\b/gi,
    /\bcannot find module\b/gi,
    /\bmodule not found\b/gi,
    /\benoent\b/gi,
    /\beacces\b/gi,
    /\beaddrinuse\b/gi,
  ]
  for (const pattern of runtimePatterns) {
    for (const match of output.matchAll(pattern)) {
      const ctx = output.slice(Math.max(0, match.index! - 20), match.index! + 80)
      const filePath = extractFilePath(ctx)
      errors.push({
        category: "runtime_error",
        message: ctx.trim(),
        filePath,
        lineNumber: extractLineNumber(ctx),
      })
    }
  }

  // Crashes: segfault, panic, stack overflow, OOM
  const crashPatterns = [
    /\bpanic\b/gi,
    /\bsegfault\b/gi,
    /\bsigsegv\b/gi,
    /\bsigabrt\b/gi,
    /\bstack overflow\b/gi,
    /\bout of memory\b/gi,
  ]
  for (const pattern of crashPatterns) {
    for (const match of output.matchAll(pattern)) {
      const ctx = output.slice(Math.max(0, match.index! - 20), match.index! + 60)
      errors.push({ category: "crash", message: ctx.trim() })
    }
  }

  // Build errors
  const buildPatterns = [
    /\bbuild (failed|error)/gi,
    /\bbun build.*error/gi,
    /\bnpm run build.*error/gi,
    /\bcargo build.*error/gi,
  ]
  for (const pattern of buildPatterns) {
    for (const match of output.matchAll(pattern)) {
      const ctx = output.slice(Math.max(0, match.index! - 20), match.index! + 80)
      errors.push({ category: "build_error", message: ctx.trim() })
    }
  }

  // Warnings (lower severity)
  const warningPatterns = [
    /\bwarning\b/gi,
    /\bdeprecated\b/gi,
    /\bwarn\b/gi,
  ]
  for (const pattern of warningPatterns) {
    for (const match of output.matchAll(pattern)) {
      const ctx = output.slice(Math.max(0, match.index! - 20), match.index! + 60)
      errors.push({ category: "warning", message: ctx.trim() })
    }
  }

  return errors
}

function extractLineNumber(ctx: string): number | undefined {
  const match = ctx.match(/[:\s](\d+)[:,\s]/)
  return match ? parseInt(match[1], 10) : undefined
}

function extractFilePath(ctx: string): string | undefined {
  const match = ctx.match(/([^\s:"]+\.(ts|tsx|js|jsx|py|rs|go|java))[:,\s]/i)
  return match ? match[1] : undefined
}

export * as Validation from "./validation"
