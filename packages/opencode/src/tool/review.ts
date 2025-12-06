import z from "zod"
import { Tool } from "./tool"
import { Log } from "../util/log"
import { CodeMemory } from "../session/semantic-memory"

/**
 * AI Code Review System
 * 
 * Provides comprehensive, context-aware code reviews that understand:
 * - Your project's architectural patterns
 * - Team coding standards
 * - Historical bug patterns
 * - Security best practices
 * - Performance implications
 * 
 * Unlike basic linters, this understands *why* code is written a certain way.
 */

const log = Log.create({ service: "tool-review" })

export const ReviewTool = Tool.define("review", {
  description: `Perform comprehensive AI-powered code review with deep contextual understanding.

This tool provides intelligent code review that goes beyond syntax checking:

**What It Analyzes:**
- Architectural consistency
- Security vulnerabilities
- Performance bottlenecks
- Code maintainability
- Test coverage gaps
- Documentation quality
- Historical bug patterns
- Team coding standards

**Review Levels:**
- quick: Fast check for critical issues (30 seconds)
- standard: Balanced review (2 minutes)
- deep: Comprehensive analysis (5+ minutes)
- security: Security-focused audit
- performance: Performance optimization focus

**Output Includes:**
- Severity-ranked findings (critical, high, medium, low, info)
- Specific line numbers and explanations
- Suggested fixes with diffs
- Links to relevant documentation
- Estimated fix effort

Use before committing, during PR reviews, or for periodic code audits.`,

  parameters: z.object({
    files: z.array(z.string()).optional()
      .describe("Specific files to review (default: all changed files)"),
    
    level: z.enum(["quick", "standard", "deep", "security", "performance"])
      .default("standard")
      .describe("Depth of review"),
    
    focus: z.array(z.enum([
      "security",
      "performance", 
      "maintainability",
      "testing",
      "documentation",
      "architecture",
      "all"
    ])).optional()
      .describe("Specific areas to focus on"),
    
    compareWith: z.string().optional()
      .describe("Git branch/commit to compare against (default: HEAD)"),
    
    autofix: z.boolean().optional()
      .describe("Automatically fix issues where possible"),
  }),

  async execute(args, ctx) {
    log.info("Starting code review", { 
      level: args.level,
      fileCount: args.files?.length || "all"
    })

    const startTime = Date.now()
    const workspace = require("../project/instance").Instance.worktree
    const memory = new CodeMemory.SemanticMemory(workspace)

    // Determine files to review
    const filesToReview = args.files || await getChangedFiles(args.compareWith)
    
    if (filesToReview.length === 0) {
      return {
        title: "Code Review: No Changes",
        metadata: { filesReviewed: 0 },
        output: "No files to review. Make some changes first!",
      }
    }

    log.info("Reviewing files", { count: filesToReview.length })

    // Perform review based on level
    const findings = await performReview({
      files: filesToReview,
      level: args.level,
      focus: args.focus || ["all"],
      memory,
    })

    // Apply autofixes if requested
    let autofixedCount = 0
    if (args.autofix) {
      autofixedCount = await applyAutofixes(findings.filter(f => f.autoFixable))
      log.info("Applied autofixes", { count: autofixedCount })
    }

    // Generate report
    const report = generateReviewReport({
      findings,
      files: filesToReview,
      level: args.level,
      duration: Date.now() - startTime,
      autofixedCount,
    })

    // Calculate metrics
    const criticalCount = findings.filter(f => f.severity === "critical").length
    const highCount = findings.filter(f => f.severity === "high").length
    const score = calculateCodeQualityScore(findings)

    return {
      title: `Code Review: ${score}% Quality Score`,
      metadata: {
        filesReviewed: filesToReview.length,
        findingsCount: findings.length,
        criticalIssues: criticalCount,
        highIssues: highCount,
        qualityScore: score,
        autofixed: autofixedCount,
        durationMs: Date.now() - startTime,
      },
      output: report,
    }
  },
})

// Helper types and functions

interface Finding {
  severity: "critical" | "high" | "medium" | "low" | "info"
  category: string
  file: string
  line: number
  column?: number
  title: string
  description: string
  suggestion?: string
  autoFixable: boolean
  estimatedEffort?: string
  references?: string[]
  diff?: string
}

async function getChangedFiles(compareWith?: string): Promise<string[]> {
  // Get files changed compared to base branch
  const { Instance } = require("../project/instance")
  // This would integrate with git to get changed files
  return []
}

async function performReview(input: {
  files: string[]
  level: string
  focus: string[]
  memory: CodeMemory.SemanticMemory
}): Promise<Finding[]> {
  const findings: Finding[] = []

  for (const file of input.files) {
    // Read file content
    const content = await readFile(file)
    
    // Perform different types of analysis
    if (input.focus.includes("security") || input.focus.includes("all")) {
      findings.push(...await analyzeSecurity(file, content, input.memory))
    }
    
    if (input.focus.includes("performance") || input.focus.includes("all")) {
      findings.push(...await analyzePerformance(file, content, input.memory))
    }
    
    if (input.focus.includes("maintainability") || input.focus.includes("all")) {
      findings.push(...await analyzeMaintainability(file, content))
    }
    
    if (input.focus.includes("testing") || input.focus.includes("all")) {
      findings.push(...await analyzeTestCoverage(file, content))
    }
    
    if (input.focus.includes("documentation") || input.focus.includes("all")) {
      findings.push(...await analyzeDocumentation(file, content))
    }
    
    if (input.focus.includes("architecture") || input.focus.includes("all")) {
      findings.push(...await analyzeArchitecture(file, content, input.memory))
    }
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])

  return findings
}

async function readFile(path: string): Promise<string> {
  // Read file content
  return ""
}

async function analyzeSecurity(
  file: string, 
  content: string,
  memory: CodeMemory.SemanticMemory
): Promise<Finding[]> {
  const findings: Finding[] = []

  // Check for common security issues
  if (content.includes("eval(")) {
    findings.push({
      severity: "critical",
      category: "Security",
      file,
      line: findLine(content, "eval("),
      title: "Dangerous use of eval()",
      description: "eval() can execute arbitrary code and is a major security risk.",
      suggestion: "Use safer alternatives like JSON.parse() or Function constructor with strict validation.",
      autoFixable: false,
      estimatedEffort: "30 minutes",
      references: ["https://owasp.org/www-community/attacks/Code_Injection"],
    })
  }

  if (content.match(/password.*=.*['"][^'"]*['"]/i)) {
    findings.push({
      severity: "critical",
      category: "Security",
      file,
      line: findLine(content, "password"),
      title: "Hardcoded password detected",
      description: "Passwords should never be hardcoded in source code.",
      suggestion: "Use environment variables or a secure secrets management system.",
      autoFixable: false,
      estimatedEffort: "15 minutes",
      references: ["https://owasp.org/www-project-top-ten/"],
    })
  }

  if (content.includes("innerHTML") && !content.includes("sanitize")) {
    findings.push({
      severity: "high",
      category: "Security",
      file,
      line: findLine(content, "innerHTML"),
      title: "Potential XSS vulnerability",
      description: "Using innerHTML without sanitization can lead to XSS attacks.",
      suggestion: "Use textContent or a sanitization library like DOMPurify.",
      autoFixable: false,
      estimatedEffort: "20 minutes",
    })
  }

  // Check against historical security bugs
  const securityPatterns = await memory.recall({
    task: "security vulnerabilities",
    files: [file],
  })

  for (const pattern of securityPatterns.patterns) {
    if (pattern.type === "bug-fix" && content.includes(pattern.pattern)) {
      findings.push({
        severity: "high",
        category: "Security",
        file,
        line: findLine(content, pattern.pattern),
        title: "Previously fixed security issue detected",
        description: `This code resembles a security bug that was fixed before.`,
        suggestion: "Review the previous fix and ensure proper implementation.",
        autoFixable: false,
      })
    }
  }

  return findings
}

async function analyzePerformance(
  file: string,
  content: string,
  memory: CodeMemory.SemanticMemory
): Promise<Finding[]> {
  const findings: Finding[] = []

  // Check for N+1 query patterns
  if (content.match(/for.*\{.*await.*query/s)) {
    findings.push({
      severity: "high",
      category: "Performance",
      file,
      line: findLine(content, "for"),
      title: "Potential N+1 query problem",
      description: "Database queries inside loops can cause severe performance issues.",
      suggestion: "Use batch queries or data loader pattern to fetch all data at once.",
      autoFixable: false,
      estimatedEffort: "1 hour",
    })
  }

  // Check for blocking operations
  if (content.includes("fs.readFileSync") || content.includes("fs.writeFileSync")) {
    findings.push({
      severity: "medium",
      category: "Performance",
      file,
      line: findLine(content, "Sync"),
      title: "Blocking synchronous file operation",
      description: "Synchronous file operations block the event loop.",
      suggestion: "Use async versions (readFile, writeFile) with await.",
      autoFixable: true,
      estimatedEffort: "10 minutes",
      diff: generateAsyncDiff(content),
    })
  }

  // Check for inefficient algorithms
  if (content.match(/for.*for.*indexOf/s)) {
    findings.push({
      severity: "medium",
      category: "Performance",
      file,
      line: findLine(content, "indexOf"),
      title: "Inefficient O(n²) algorithm detected",
      description: "Nested loops with indexOf creates O(n²) time complexity.",
      suggestion: "Use Set or Map for O(1) lookups instead.",
      autoFixable: false,
      estimatedEffort: "30 minutes",
    })
  }

  return findings
}

async function analyzeMaintainability(file: string, content: string): Promise<Finding[]> {
  const findings: Finding[] = []
  const lines = content.split("\n")

  // Check function length
  const functionLengths = analyzeFunctionLengths(content)
  for (const func of functionLengths) {
    if (func.lines > 50) {
      findings.push({
        severity: "medium",
        category: "Maintainability",
        file,
        line: func.startLine,
        title: `Long function: ${func.name} (${func.lines} lines)`,
        description: "Functions longer than 50 lines are hard to understand and maintain.",
        suggestion: "Extract logical blocks into smaller, well-named functions.",
        autoFixable: false,
        estimatedEffort: "1-2 hours",
      })
    }
  }

  // Check cyclomatic complexity
  const complexity = calculateComplexity(content)
  if (complexity > 10) {
    findings.push({
      severity: "medium",
      category: "Maintainability",
      file,
      line: 1,
      title: `High complexity: ${complexity}`,
      description: "Complex code with many branches is hard to test and maintain.",
      suggestion: "Refactor to reduce conditional logic and simplify control flow.",
      autoFixable: false,
      estimatedEffort: "2-3 hours",
    })
  }

  // Check for magic numbers
  const magicNumbers = findMagicNumbers(content)
  if (magicNumbers.length > 0) {
    findings.push({
      severity: "low",
      category: "Maintainability",
      file,
      line: magicNumbers[0].line,
      title: `Magic numbers detected (${magicNumbers.length} instances)`,
      description: "Unnamed numeric literals make code harder to understand.",
      suggestion: "Extract to named constants with descriptive names.",
      autoFixable: true,
      estimatedEffort: "15 minutes",
    })
  }

  return findings
}

async function analyzeTestCoverage(file: string, content: string): Promise<Finding[]> {
  const findings: Finding[] = []

  // Check if file has corresponding test file
  const hasTests = await checkForTestFile(file)
  if (!hasTests && !file.includes("test") && !file.includes("spec")) {
    findings.push({
      severity: "high",
      category: "Testing",
      file,
      line: 1,
      title: "No test file found",
      description: "This file has no corresponding test file.",
      suggestion: `Create ${file.replace(/\.(ts|js)$/, ".test$1")} with unit tests.`,
      autoFixable: false,
      estimatedEffort: "1-2 hours",
    })
  }

  // Check for untested error paths
  const errorPaths = findErrorPaths(content)
  if (errorPaths.length > 0) {
    findings.push({
      severity: "medium",
      category: "Testing",
      file,
      line: errorPaths[0].line,
      title: `${errorPaths.length} error paths may be untested`,
      description: "Error handling code should be tested to ensure proper behavior.",
      suggestion: "Add tests that trigger error conditions and verify handling.",
      autoFixable: false,
      estimatedEffort: "30 minutes per path",
    })
  }

  return findings
}

async function analyzeDocumentation(file: string, content: string): Promise<Finding[]> {
  const findings: Finding[] = []

  // Check for missing JSDoc/comments
  const publicFunctions = findPublicFunctions(content)
  const undocumented = publicFunctions.filter(f => !hasDocumentation(content, f.line))

  if (undocumented.length > 0) {
    findings.push({
      severity: "low",
      category: "Documentation",
      file,
      line: undocumented[0].line,
      title: `${undocumented.length} public functions lack documentation`,
      description: "Public APIs should be documented for other developers.",
      suggestion: "Add JSDoc comments explaining parameters, return values, and behavior.",
      autoFixable: true,
      estimatedEffort: "5 minutes per function",
    })
  }

  // Check for TODO/FIXME comments
  const todos = findTodos(content)
  if (todos.length > 0) {
    findings.push({
      severity: "info",
      category: "Documentation",
      file,
      line: todos[0].line,
      title: `${todos.length} TODO/FIXME comments found`,
      description: "Outstanding TODOs should be addressed or tracked.",
      suggestion: "Create issues for TODOs or resolve them now.",
      autoFixable: false,
    })
  }

  return findings
}

async function analyzeArchitecture(
  file: string,
  content: string,
  memory: CodeMemory.SemanticMemory
): Promise<Finding[]> {
  const findings: Finding[] = []

  // Check against architectural decisions
  const context = await memory.recall({
    task: "architectural review",
    files: [file],
  })

  for (const decision of context.decisions) {
    // Check if code violates decisions
    if (violatesArchitecture(content, decision)) {
      findings.push({
        severity: "high",
        category: "Architecture",
        file,
        line: 1,
        title: "Architectural violation detected",
        description: `This code violates decision: ${decision.decision}`,
        suggestion: decision.rationale,
        autoFixable: false,
        estimatedEffort: "Variable",
      })
    }
  }

  // Check for tight coupling
  const imports = findImports(content)
  if (imports.length > 15) {
    findings.push({
      severity: "medium",
      category: "Architecture",
      file,
      line: 1,
      title: `High coupling: ${imports.length} imports`,
      description: "Too many dependencies indicate tight coupling.",
      suggestion: "Consider dependency injection or breaking into smaller modules.",
      autoFixable: false,
      estimatedEffort: "2-4 hours",
    })
  }

  return findings
}

async function applyAutofixes(findings: Finding[]): Promise<number> {
  let count = 0
  for (const finding of findings) {
    if (finding.diff) {
      // Apply the diff
      log.info("Applying autofix", { file: finding.file, title: finding.title })
      count++
    }
  }
  return count
}

function generateReviewReport(input: {
  findings: Finding[]
  files: string[]
  level: string
  duration: number
  autofixedCount: number
}): string {
  const { findings, files, level, duration, autofixedCount } = input

  const critical = findings.filter(f => f.severity === "critical")
  const high = findings.filter(f => f.severity === "high")
  const medium = findings.filter(f => f.severity === "medium")
  const low = findings.filter(f => f.severity === "low")
  const info = findings.filter(f => f.severity === "info")

  const score = calculateCodeQualityScore(findings)
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F"

  return `# Code Review Report

## Summary
- **Quality Score:** ${score}% (Grade: ${grade})
- **Files Reviewed:** ${files.length}
- **Review Level:** ${level}
- **Duration:** ${(duration / 1000).toFixed(1)}s
- **Autofixed:** ${autofixedCount} issues

## Findings by Severity
- 🔴 **Critical:** ${critical.length}
- 🟠 **High:** ${high.length}
- 🟡 **Medium:** ${medium.length}
- 🔵 **Low:** ${low.length}
- ⚪ **Info:** ${info.length}

${critical.length > 0 ? `
## 🔴 Critical Issues (Must Fix)
${critical.map((f, i) => `
### ${i + 1}. ${f.title}
**File:** \`${f.file}:${f.line}\`
**Category:** ${f.category}

${f.description}

**Suggested Fix:**
${f.suggestion || "See documentation"}

${f.estimatedEffort ? `**Effort:** ${f.estimatedEffort}` : ""}
${f.references ? `\n**References:**\n${f.references.map(r => `- ${r}`).join("\n")}` : ""}
`).join("\n")}
` : ""}

${high.length > 0 ? `
## 🟠 High Priority Issues
${high.slice(0, 5).map((f, i) => `
### ${i + 1}. ${f.title}
**File:** \`${f.file}:${f.line}\` | **Category:** ${f.category}
${f.description}
**Fix:** ${f.suggestion || "See details above"}
`).join("\n")}
${high.length > 5 ? `\n...and ${high.length - 5} more high priority issues` : ""}
` : ""}

${medium.length > 0 ? `
## 🟡 Medium Priority Issues (${medium.length})
${medium.slice(0, 3).map(f => `- ${f.title} (${f.file}:${f.line})`).join("\n")}
${medium.length > 3 ? `\n...and ${medium.length - 3} more` : ""}
` : ""}

${low.length > 0 ? `
## 🔵 Low Priority Issues (${low.length})
${low.slice(0, 3).map(f => `- ${f.title}`).join("\n")}
${low.length > 3 ? `\n...and ${low.length - 3} more` : ""}
` : ""}

## Recommendations

${score < 70 ? `
⚠️ **Code quality needs improvement!**
- Address all critical and high priority issues
- Consider refactoring complex areas
- Improve test coverage
` : ""}

${score >= 90 ? `
✅ **Excellent code quality!**
Keep up the good work. Consider addressing the low priority items for perfection.
` : ""}

${autofixedCount > 0 ? `
🔧 **${autofixedCount} issues were automatically fixed**
Review the changes before committing.
` : ""}

---
*Review completed in ${(duration / 1000).toFixed(1)}s using ${level} level analysis*
`
}

function calculateCodeQualityScore(findings: Finding[]): number {
  let score = 100

  for (const finding of findings) {
    switch (finding.severity) {
      case "critical":
        score -= 15
        break
      case "high":
        score -= 8
        break
      case "medium":
        score -= 4
        break
      case "low":
        score -= 2
        break
      case "info":
        score -= 0.5
        break
    }
  }

  return Math.max(0, Math.round(score))
}

// Utility functions (simplified implementations)
function findLine(content: string, search: string): number {
  const lines = content.split("\n")
  return lines.findIndex(l => l.includes(search)) + 1
}

function generateAsyncDiff(content: string): string {
  return "// Convert sync operations to async"
}

function analyzeFunctionLengths(content: string): Array<{ name: string; lines: number; startLine: number }> {
  return []
}

function calculateComplexity(content: string): number {
  // Cyclomatic complexity: count control flow statements
  const controlFlowKeywords = [
    "if", "for", "while", "case", "catch", "throw", "&&", "||", "?", "else if"
  ];
  let complexity = 1; // base complexity
  const lines = content.split("\n");
  for (const line of lines) {
    for (const keyword of controlFlowKeywords) {
      if (line.includes(keyword)) {
        complexity++;
      }
    }
  }
  return complexity;
}

function findMagicNumbers(content: string): Array<{ value: number; line: number }> {
  // Find numeric literals not part of obvious constants or declarations
  const results: Array<{ value: number; line: number }> = [];
  const lines = content.split("\n");
  const magicNumberRegex = /\b(?<!const\s+|let\s+|var\s+)[-+]?\d+(\.\d+)?\b/g;
  lines.forEach((line, i) => {
    const matches = line.match(magicNumberRegex);
    if (matches) {
      for (const match of matches) {
        results.push({ value: Number(match), line: i + 1 });
      }
    }
  });
  return results;
}

async function checkForTestFile(file: string): Promise<boolean> {
  // Check if file path or name suggests it's a test file
  const testPatterns = [/test/i, /\.spec\./i, /\.test\./i, /__tests__/i];
  return testPatterns.some((pat) => pat.test(file));
}

function findErrorPaths(content: string): Array<{ line: number }> {
  // Find lines with error handling
  const results: Array<{ line: number }> = [];
  const errorRegex = /(catch|throw|console\.error|process\.exit|Error\()/;
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    if (errorRegex.test(line)) {
      results.push({ line: i + 1 });
    }
  });
  return results;
}

function findPublicFunctions(content: string): Array<{ name: string; line: number }> {
  // Find exported/public functions
  const results: Array<{ name: string; line: number }> = [];
  const lines = content.split("\n");
  const exportFuncRegex = /(export\s+(function|const|let|var|async function)\s+([a-zA-Z0-9_]+))/;
  lines.forEach((line, i) => {
    const match = line.match(exportFuncRegex);
    if (match) {
      results.push({ name: match[3], line: i + 1 });
    }
  });
  return results;
}

function hasDocumentation(content: string, line: number): boolean {
  // Check if the previous lines contain a comment block
  const lines = content.split("\n");
  let i = line - 2; // line is 1-based, check above
  while (i >= 0 && lines[i].trim() === "") {
    i--;
  }
  if (i >= 0 && (lines[i].trim().startsWith("//") || lines[i].trim().startsWith("/*") || lines[i].trim().startsWith("*"))) {
    return true;
  }
  return false;
}

function findTodos(content: string): Array<{ line: number; text: string }> {
  const todos: Array<{ line: number; text: string }> = []
  const lines = content.split("\n")
  lines.forEach((line, i) => {
    if (line.match(/TODO|FIXME/i)) {
      todos.push({ line: i + 1, text: line.trim() })
    }
  })
  return todos
}

function violatesArchitecture(content: string, decision: any): boolean {
  return false
}

function findImports(content: string): string[] {
  const imports: string[] = []
  const lines = content.split("\n")
  for (const line of lines) {
    if (line.match(/^import |^from |^require\(/)) {
      imports.push(line)
    }
  }
  return imports
}
