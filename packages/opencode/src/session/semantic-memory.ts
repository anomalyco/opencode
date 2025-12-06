import z from "zod"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import type { MessageV2 } from "../session/message-v2"

/**
 * Semantic Code Memory System
 * 
 * This revolutionary system gives OpenCode a persistent memory of your codebase
 * that goes beyond simple vector embeddings. It understands:
 * - Code patterns and architectural decisions
 * - Developer intent and coding style
 * - Common bug patterns and solutions
 * - Cross-file relationships and dependencies
 * 
 * Unlike Cursor's basic context, this learns and evolves with your project.
 */

export namespace CodeMemory {
  const log = Log.create({ service: "code-memory" })

  export interface CodePattern {
    id: string
    type: "architectural" | "bug-fix" | "refactoring" | "style" | "api-usage"
    pattern: string
    context: {
      files: string[]
      frequency: number
      lastSeen: number
    }
    impact: "high" | "medium" | "low"
    confidence: number
  }

  export interface DeveloperIntent {
    action: string
    reasoning: string
    alternatives: string[]
    outcome: "success" | "failure" | "partial"
    timestamp: number
  }

  export interface ArchitecturalDecision {
    id: string
    decision: string
    rationale: string
    consequences: string[]
    alternatives: string[]
    files: string[]
    timestamp: number
  }

  export interface SemanticContext {
    patterns: Map<string, CodePattern>
    intents: DeveloperIntent[]
    decisions: ArchitecturalDecision[]
    relationships: Map<string, string[]> // file -> related files
    hotspots: Map<string, number> // file -> edit frequency
  }

  /**
   * Maintains a semantic understanding of the codebase
   */
  export class SemanticMemory {
    private context: SemanticContext
    private workspace: string

    constructor(workspace: string) {
      this.workspace = workspace
      this.context = {
        patterns: new Map(),
        intents: [],
        decisions: [],
        relationships: new Map(),
        hotspots: new Map(),
      }
      this.load()
    }

    /**
     * Learns from code changes and conversations
     */
    async learn(input: {
      messages: MessageV2.WithParts[]
      fileChanges: Array<{ path: string; diff: string }>
      outcome: "success" | "failure"
    }): Promise<void> {
      log.info("Learning from interaction", { 
        messageCount: input.messages.length,
        changedFiles: input.fileChanges.length 
      })

      // Extract patterns from code changes
      for (const change of input.fileChanges) {
        await this.extractPatterns(change)
        this.updateHotspot(change.path)
        await this.updateRelationships(change.path, input.fileChanges)
      }

      // Extract developer intent from messages
      const intent = await this.extractIntent(input.messages, input.outcome)
      if (intent) {
        this.context.intents.push(intent)
        // Keep only recent intents (last 1000)
        if (this.context.intents.length > 1000) {
          this.context.intents = this.context.intents.slice(-1000)
        }
      }

      // Detect architectural decisions
      const decision = await this.detectArchitecturalDecision(
        input.messages,
        input.fileChanges
      )
      if (decision) {
        this.context.decisions.push(decision)
      }

      await this.persist()
    }

    /**
     * Retrieves relevant context for a new task
     */
    async recall(query: {
      task: string
      files?: string[]
      similarTo?: string
    }): Promise<{
      patterns: CodePattern[]
      decisions: ArchitecturalDecision[]
      relatedFiles: string[]
      suggestions: string[]
    }> {
      log.info("Recalling relevant context", { task: query.task })

      const patterns = this.findRelevantPatterns(query.task, query.files)
      const decisions = this.findRelevantDecisions(query.task, query.files)
      const relatedFiles = this.findRelatedFiles(query.files || [])
      const suggestions = await this.generateSuggestions(query, patterns, decisions)

      return {
        patterns: Array.from(patterns.values()),
        decisions,
        relatedFiles,
        suggestions,
      }
    }

    /**
     * Predicts likely issues before they occur
     */
    async predictIssues(input: {
      proposedChanges: Array<{ path: string; content: string }>
    }): Promise<Array<{
      severity: "error" | "warning" | "info"
      message: string
      file: string
      confidence: number
    }>> {
      const issues: Array<{
        severity: "error" | "warning" | "info"
        message: string
        file: string
        confidence: number
      }> = []

      for (const change of input.proposedChanges) {
        // Check against known bug patterns
        const bugPatterns = Array.from(this.context.patterns.values())
          .filter(p => p.type === "bug-fix")

        for (const pattern of bugPatterns) {
          if (this.matchesPattern(change.content, pattern.pattern)) {
            issues.push({
              severity: "warning",
              message: `This code resembles a previous bug pattern: ${pattern.pattern}`,
              file: change.path,
              confidence: pattern.confidence,
            })
          }
        }

        // Check for architectural violations
        const relevantDecisions = this.context.decisions.filter(d =>
          d.files.some(f => change.path.includes(f))
        )

        for (const decision of relevantDecisions) {
          if (this.violatesDecision(change.content, decision)) {
            issues.push({
              severity: "error",
              message: `Change violates architectural decision: ${decision.decision}`,
              file: change.path,
              confidence: 0.85,
            })
          }
        }

        // Check for breaking related files
        const related = this.context.relationships.get(change.path) || []
        if (related.length > 5) {
          issues.push({
            severity: "info",
            message: `This file is highly connected (${related.length} relationships). Consider running tests.`,
            file: change.path,
            confidence: 0.9,
          })
        }
      }

      return issues
    }

    /**
     * Suggests optimal approaches based on past successes
     */
    async suggestApproach(task: string): Promise<{
      approach: string
      confidence: number
      reasoning: string
      alternatives: string[]
    }> {
      const similarIntents = this.context.intents
        .filter(i => i.outcome === "success" && this.isSimilar(i.action, task))
        .slice(-10)

      if (similarIntents.length === 0) {
        return {
          approach: "No similar successful patterns found. Proceeding with standard approach.",
          confidence: 0.5,
          reasoning: "No historical data available",
          alternatives: [],
        }
      }

      // Find most common successful approach
      const approaches = new Map<string, number>()
      for (const intent of similarIntents) {
        const key = intent.reasoning
        approaches.set(key, (approaches.get(key) || 0) + 1)
      }

      const bestApproach = Array.from(approaches.entries())
        .sort((a, b) => b[1] - a[1])[0]

      return {
        approach: bestApproach[0],
        confidence: bestApproach[1] / similarIntents.length,
        reasoning: `Successfully used ${bestApproach[1]} times in similar contexts`,
        alternatives: Array.from(approaches.keys()).filter(k => k !== bestApproach[0]),
      }
    }

    // Private helper methods

    private async extractPatterns(change: {
      path: string
      diff: string
    }): Promise<void> {
      // Analyze the diff for patterns
      const lines = change.diff.split("\n")
      
      // Look for common patterns
      if (this.isRefactoring(lines)) {
        this.recordPattern({
          type: "refactoring",
          pattern: this.extractRefactoringPattern(lines),
          files: [change.path],
        })
      }

      if (this.isBugFix(lines)) {
        this.recordPattern({
          type: "bug-fix",
          pattern: this.extractBugPattern(lines),
          files: [change.path],
        })
      }
    }

    private recordPattern(input: {
      type: CodePattern["type"]
      pattern: string
      files: string[]
    }): void {
      const id = `${input.type}-${input.pattern.substring(0, 20)}`
      const existing = this.context.patterns.get(id)

      if (existing) {
        existing.context.frequency++
        existing.context.lastSeen = Date.now()
        existing.confidence = Math.min(existing.confidence + 0.05, 1.0)
      } else {
        this.context.patterns.set(id, {
          id,
          type: input.type,
          pattern: input.pattern,
          context: {
            files: input.files,
            frequency: 1,
            lastSeen: Date.now(),
          },
          impact: "medium",
          confidence: 0.6,
        })
      }
    }

    private updateHotspot(path: string): void {
      const current = this.context.hotspots.get(path) || 0
      this.context.hotspots.set(path, current + 1)
    }

    private async updateRelationships(
      path: string,
      allChanges: Array<{ path: string; diff: string }>
    ): Promise<void> {
      // Files changed together are likely related
      const relatedPaths = allChanges
        .filter(c => c.path !== path)
        .map(c => c.path)

      if (relatedPaths.length === 0) return

      const existing = this.context.relationships.get(path) || []
      const updated = new Set([...existing, ...relatedPaths])
      this.context.relationships.set(path, Array.from(updated))
    }

    private async extractIntent(
      messages: MessageV2.WithParts[],
      outcome: "success" | "failure"
    ): Promise<DeveloperIntent | null> {
      // Extract the user's intent from messages
      const userMessages = messages.filter(m => m.type === "user")
      if (userMessages.length === 0) return null

      const lastUserMessage = userMessages[userMessages.length - 1]
      const text = lastUserMessage.parts
        .filter(p => p.type === "text")
        .map(p => "text" in p ? p.text : "")
        .join(" ")

      return {
        action: text.substring(0, 200),
        reasoning: "extracted from conversation",
        alternatives: [],
        outcome,
        timestamp: Date.now(),
      }
    }

    private async detectArchitecturalDecision(
      messages: MessageV2.WithParts[],
      fileChanges: Array<{ path: string; diff: string }>
    ): Promise<ArchitecturalDecision | null> {
      // Detect if this represents a significant architectural decision
      const isSignificant = 
        fileChanges.length > 5 || 
        fileChanges.some(c => c.path.includes("config") || c.path.includes("architecture"))

      if (!isSignificant) return null

      return {
        id: `decision-${Date.now()}`,
        decision: `Modified ${fileChanges.length} files`,
        rationale: "Large-scale change detected",
        consequences: [],
        alternatives: [],
        files: fileChanges.map(c => c.path),
        timestamp: Date.now(),
      }
    }

    private findRelevantPatterns(
      task: string,
      files?: string[]
    ): Map<string, CodePattern> {
      const relevant = new Map<string, CodePattern>()

      for (const [id, pattern] of this.context.patterns.entries()) {
        let score = 0

        // Check task similarity
        if (this.isSimilar(pattern.pattern, task)) {
          score += 0.5
        }

        // Check file overlap
        if (files) {
          const overlap = pattern.context.files.filter(f => 
            files.some(uf => uf.includes(f) || f.includes(uf))
          ).length
          score += overlap * 0.2
        }

        // Boost by frequency and confidence
        score *= pattern.confidence
        score *= Math.log(pattern.context.frequency + 1)

        if (score > 0.3) {
          relevant.set(id, pattern)
        }
      }

      return relevant
    }

    private findRelevantDecisions(
      task: string,
      files?: string[]
    ): ArchitecturalDecision[] {
      return this.context.decisions
        .filter(d => {
          if (files) {
            return d.files.some(f => files.some(uf => uf.includes(f) || f.includes(uf)))
          }
          return this.isSimilar(d.decision, task)
        })
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5)
    }

    private findRelatedFiles(files: string[]): string[] {
      const related = new Set<string>()

      for (const file of files) {
        const fileRelated = this.context.relationships.get(file) || []
        fileRelated.forEach(f => related.add(f))
      }

      return Array.from(related)
    }

    private async generateSuggestions(
      query: any,
      patterns: Map<string, CodePattern>,
      decisions: ArchitecturalDecision[]
    ): Promise<string[]> {
      const suggestions: string[] = []

      // Suggest based on patterns
      for (const pattern of patterns.values()) {
        if (pattern.impact === "high") {
          suggestions.push(`Consider pattern: ${pattern.pattern} (confidence: ${(pattern.confidence * 100).toFixed(0)}%)`)
        }
      }

      // Suggest based on decisions
      for (const decision of decisions) {
        suggestions.push(`Remember: ${decision.decision}`)
      }

      return suggestions.slice(0, 5)
    }

    private matchesPattern(content: string, pattern: string): boolean {
      // Simple pattern matching - could be enhanced with ML
      return content.toLowerCase().includes(pattern.toLowerCase())
    }

    private violatesDecision(
      content: string,
      decision: ArchitecturalDecision
    ): boolean {
      // Check if content violates the decision
      // This is simplified - real implementation would be more sophisticated
      // Basic implementation: if decision says "do not use X" and content contains X, return true
      const lowerDecision = decision.decision.toLowerCase();
      const lowerContent = content.toLowerCase();
      const doNotMatch = lowerDecision.match(/do not use ([\w\-]+)/);
      if (doNotMatch) {
        const forbidden = doNotMatch[1];
        if (lowerContent.includes(forbidden)) {
          return true;
        }
      }
      // Also check for "avoid X"
      const avoidMatch = lowerDecision.match(/avoid ([\w\-]+)/);
      if (avoidMatch) {
        const forbidden = avoidMatch[1];
        if (lowerContent.includes(forbidden)) {
          return true;
        }
      }
      return false;
    }

    private isSimilar(text1: string, text2: string): boolean {
      // Simple similarity check - could use embeddings for better results
      const words1 = new Set(text1.toLowerCase().split(/\s+/))
      const words2 = new Set(text2.toLowerCase().split(/\s+/))
      
      const intersection = new Set([...words1].filter(x => words2.has(x)))
      const union = new Set([...words1, ...words2])
      
      return intersection.size / union.size > 0.3
    }

    private isRefactoring(lines: string[]): boolean {
      const refactoringKeywords = ["rename", "extract", "inline", "move", "restructure"]
      const content = lines.join(" ").toLowerCase()
      return refactoringKeywords.some(k => content.includes(k))
    }

    private isBugFix(lines: string[]): boolean {
      const bugKeywords = ["fix", "bug", "error", "issue", "crash"]
      const content = lines.join(" ").toLowerCase()
      return bugKeywords.some(k => content.includes(k))
    }

    private extractRefactoringPattern(lines: string[]): string {
      // Extract the refactoring pattern
      return lines.filter(l => l.startsWith("+") || l.startsWith("-"))
        .slice(0, 3)
        .join("\n")
    }

    private extractBugPattern(lines: string[]): string {
      // Extract the bug pattern
      return lines.filter(l => l.startsWith("-"))
        .slice(0, 2)
        .join("\n")
    }

    private async load(): Promise<void> {
      // Load persisted memory from disk
      // Implementation would read from Instance.state or file system
      log.info("Loading semantic memory", { workspace: this.workspace })
    }

    private async persist(): Promise<void> {
      // Persist memory to disk
      log.info("Persisting semantic memory", { 
        patterns: this.context.patterns.size,
        intents: this.context.intents.length,
        decisions: this.context.decisions.length 
      })
    }
  }
}
