import z from "zod"
import { Tool } from "./tool"
import { Log } from "../util/log"
import { CodeMemory } from "../session/semantic-memory"
import { Instance } from "../project/instance"

/**
 * Predictive Analysis Tool
 * 
 * This tool uses the semantic memory system to predict issues, suggest
 * approaches, and provide context-aware recommendations before you even ask.
 */

const log = Log.create({ service: "tool-predict" })

export const PredictTool = Tool.define("predict", {
  description: `Predict potential issues and suggest optimal approaches based on learned patterns.

This tool leverages OpenCode's semantic memory to:
- Predict bugs before they happen based on historical patterns
- Suggest approaches that have worked in similar situations
- Identify architectural violations before committing
- Recommend related files that might need updating
- Provide context-aware insights from past development sessions

Use this before making changes to:
- Avoid repeating past mistakes
- Follow established patterns in the codebase
- Ensure consistency with architectural decisions
- Identify potential side effects of changes

This is like having an experienced developer review your plan before execution.`,

  parameters: z.object({
    action: z.enum(["predict-issues", "suggest-approach", "recall-context", "analyze-impact"])
      .describe("Type of predictive analysis to perform"),
    
    task: z.string().optional()
      .describe("Description of the task or change being planned"),
    
    files: z.array(z.string()).optional()
      .describe("Files that will be modified or are relevant"),
    
    proposedChanges: z.array(z.object({
      path: z.string(),
      content: z.string(),
    })).optional().describe("Proposed code changes to analyze"),
  }),

  async execute(args, ctx) {
    log.info("Performing predictive analysis", { action: args.action })

    const workspace = Instance.worktree
    const memory = new CodeMemory.SemanticMemory(workspace)

    let output = ""
    let metadata: any = {}

    switch (args.action) {
      case "predict-issues": {
        if (!args.proposedChanges) {
          throw new Error("proposedChanges required for predict-issues action")
        }

        const issues = await memory.predictIssues({
          proposedChanges: args.proposedChanges,
        })

        output = `# Predictive Issue Analysis

## Potential Issues Found: ${issues.length}

${issues.map(issue => `
### ${issue.severity.toUpperCase()}: ${issue.file}
${issue.message}
**Confidence:** ${(issue.confidence * 100).toFixed(0)}%
`).join("\n")}

${issues.length === 0 ? "✅ No potential issues detected based on historical patterns." : ""}
`
        metadata = { issuesFound: issues.length, highConfidence: issues.filter(i => i.confidence > 0.8).length }
        break
      }

      case "suggest-approach": {
        if (!args.task) {
          throw new Error("task description required for suggest-approach action")
        }

        const suggestion = await memory.suggestApproach(args.task)

        output = `# Suggested Approach

## Recommended Strategy
${suggestion.approach}

**Confidence:** ${(suggestion.confidence * 100).toFixed(0)}%

## Reasoning
${suggestion.reasoning}

${suggestion.alternatives.length > 0 ? `
## Alternative Approaches
${suggestion.alternatives.map((alt, i) => `${i + 1}. ${alt}`).join("\n")}
` : ""}
`
        metadata = { confidence: suggestion.confidence, hasAlternatives: suggestion.alternatives.length > 0 }
        break
      }

      case "recall-context": {
        if (!args.task) {
          throw new Error("task description required for recall-context action")
        }

        const context = await memory.recall({
          task: args.task,
          files: args.files,
        })

        output = `# Relevant Context Recalled

## Code Patterns (${context.patterns.length})
${context.patterns.map(p => `
- **${p.type}**: ${p.pattern}
  - Seen ${p.context.frequency} times
  - Confidence: ${(p.confidence * 100).toFixed(0)}%
  - Impact: ${p.impact}
`).join("\n")}

## Architectural Decisions (${context.decisions.length})
${context.decisions.map(d => `
- **${d.decision}**
  - ${d.rationale}
  - Affects: ${d.files.slice(0, 3).join(", ")}${d.files.length > 3 ? "..." : ""}
`).join("\n")}

## Related Files (${context.relatedFiles.length})
${context.relatedFiles.slice(0, 10).join("\n")}

## Suggestions
${context.suggestions.map(s => `- ${s}`).join("\n")}
`
        metadata = {
          patternsFound: context.patterns.length,
          decisionsFound: context.decisions.length,
          relatedFiles: context.relatedFiles.length,
        }
        break
      }

      case "analyze-impact": {
        if (!args.files || args.files.length === 0) {
          throw new Error("files required for analyze-impact action")
        }

        const context = await memory.recall({
          task: args.task || "Impact analysis",
          files: args.files,
        })

        // Analyze the ripple effect
        const directFiles = args.files.length
        const relatedFiles = context.relatedFiles.length
        const totalImpact = directFiles + relatedFiles

        const riskLevel = 
          totalImpact > 20 ? "HIGH" :
          totalImpact > 10 ? "MEDIUM" :
          "LOW"

        output = `# Impact Analysis

## Direct Changes
Modifying ${directFiles} file(s):
${args.files.map(f => `- ${f}`).join("\n")}

## Ripple Effect
${relatedFiles} related file(s) may be affected:
${context.relatedFiles.slice(0, 15).map(f => `- ${f}`).join("\n")}
${relatedFiles > 15 ? `\n...and ${relatedFiles - 15} more` : ""}

## Risk Assessment
**Risk Level:** ${riskLevel}
**Total Impact:** ${totalImpact} files

${riskLevel === "HIGH" ? "⚠️ **High impact change detected!**\n- Consider breaking into smaller changes\n- Ensure comprehensive testing\n- Review architectural decisions" : ""}

## Recommendations
${context.suggestions.map(s => `- ${s}`).join("\n")}

## Relevant Patterns
${context.patterns.slice(0, 3).map(p => `- ${p.pattern} (${p.type})`).join("\n")}
`
        metadata = {
          directFiles,
          relatedFiles,
          riskLevel,
          totalImpact,
        }
        break
      }
    }

    return {
      title: `Predictive Analysis: ${args.action}`,
      metadata,
      output,
    }
  },
})
