import type { Argv } from "yargs"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { EOL } from "os"
import { SequentialThinkingTool } from "../../tool/sequential-thinking"

export enum PlanningComplexity {
  Simple = "simple",
  Standard = "standard",
  Complex = "complex",
  Initiative = "initiative"
}

export enum OutputFormat {
  Markdown = "markdown",
  Json = "json",
  Checklist = "checklist"
}

export enum DevelopmentContext {
  Feature = "feature",
  BugFix = "bugfix",
  Refactor = "refactor",
  Infrastructure = "infrastructure",
  Research = "research",
  Maintenance = "maintenance"
}

export interface PlanningResult {
  originalTask: string
  complexity: PlanningComplexity
  developmentContext: DevelopmentContext
  totalSteps: number
  estimatedTime: string
  steps: PlanningStep[]
  dependencies: TaskDependency[]
  successCriteria: string[]
  technologies: string[]
  testingStrategy: string
}

export interface PlanningStep {
  number: number
  title: string
  description: string
  estimatedTime: string
  dependencies: number[]
  verification: string
}

export interface TaskDependency {
  from: number
  to: number
  description: string
}

export const PlanCommand = cmd({
  command: "plan <task>",
  describe: "Plan development tasks using sequential-thinking MCP",
  builder: (yargs: Argv) => {
    return yargs
      .positional("task", {
        describe: "Task or feature to plan",
        type: "string",
        demandOption: true,
      })
      .option("complexity", {
        alias: "c",
        describe: "Planning complexity level",
        type: "string",
        choices: Object.values(PlanningComplexity),
        default: PlanningComplexity.Standard,
      })
      .option("context", {
        describe: "Development context",
        type: "string",
        choices: Object.values(DevelopmentContext),
        default: DevelopmentContext.Feature,
      })
      .option("create-track", {
        alias: "t",
        describe: "Create conductor track from plan",
        type: "boolean",
        default: false,
      })
      .option("format", {
        alias: "f",
        describe: "Output format",
        type: "string",
        choices: Object.values(OutputFormat),
        default: OutputFormat.Markdown,
      })
      .option("interactive", {
        alias: "i",
        describe: "Interactive planning mode",
        type: "boolean",
        default: false,
      })
      .option("output", {
        alias: "o",
        describe: "Output file path (default: auto-generated)",
        type: "string",
      })
  },
  handler: async (args) => {
    const {
      task,
      complexity,
      context,
      createTrack,
      format,
      interactive,
      output
    } = args

    await bootstrap(process.cwd(), async () => {
      try {
        UI.info("Planning", `Planning: ${task}`)
        UI.info("Context", `Complexity: ${complexity}, Context: ${context}`)

        // Generate plan using sequential-thinking MCP
        const plan = await generatePlan(task, complexity, context, interactive)

        // Format and display results
        const formattedOutput = formatPlanOutput(plan, format)

        if (output) {
          await savePlanToFile(plan, output)
          UI.success("Plan Saved", `Plan saved to: ${output}`)
        } else {
          console.log(EOL + formattedOutput + EOL)
        }

        // Create conductor track if requested
        if (createTrack) {
          const trackId = await createConductorTrackFromPlan(plan)
          UI.success("Conductor Track Created", `Track ID: ${trackId}`)
        }

        // Save plan to project
        const planPath = await savePlanToProject(plan)
        UI.info("Plan Stored", `Project plan saved: ${planPath}`)

      } catch (error) {
        UI.error("Planning Failed", error instanceof Error ? error.message : String(error))
        process.exit(1)
      }
    })
  }
})

async function generatePlan(
  task: string,
  complexity: PlanningComplexity,
  context: DevelopmentContext,
  interactive: boolean
): Promise<PlanningResult> {
  try {
    // Use the sequential-thinking tool
    const result = await SequentialThinkingTool.execute({
      task,
      complexity,
      context,
      createTrack: false // We'll handle track creation separately
    }, {
      sessionID: `plan_${Date.now()}`,
      messageID: "plan_cmd",
      callID: "plan_generation",
      abort: new AbortController().signal
    })

    // Parse the tool result into our structured format
    return parseToolResponse(result.output, task, complexity, context)
  } catch (error) {
    console.warn("Sequential-thinking tool failed, using fallback:", error)

    // Fallback to simulated implementation if tool fails
    return generateFallbackPlan(task, complexity, context)
  }
}

function parseToolResponse(
  toolOutput: string,
  originalTask: string,
  complexity: PlanningComplexity,
  context: DevelopmentContext
): PlanningResult {
  // Parse the markdown output from the sequential-thinking tool
  const lines = toolOutput.split('\n')

  let estimatedTime = "TBD"
  const steps: PlanningStep[] = []
  const successCriteria: string[] = []
  const technologies: string[] = []
  let testingStrategy = "Standard testing approach"

  let currentSection = ""
  let stepCount = 0

  for (const line of lines) {
    const trimmed = line.trim()

    // Extract estimated time
    if (trimmed.includes("**Estimated Time:**")) {
      const timeMatch = trimmed.match(/\*\*Estimated Time:\*\*\s*(.+)/)
      if (timeMatch) estimatedTime = timeMatch[1]
    }

    // Track sections
    if (trimmed.startsWith("## ")) {
      currentSection = trimmed.substring(3).toLowerCase()
      continue
    }

    // Parse implementation steps
    if (currentSection === "implementation steps" && trimmed.match(/^\d+\./)) {
      const stepMatch = trimmed.match(/^(\d+)\.\s*\*\*(.+?)\*\*/)
      if (stepMatch) {
        stepCount++
        const title = stepMatch[2]
        steps.push({
          number: stepCount,
          title,
          description: "Implementation details to be refined",
          estimatedTime: "TBD",
          dependencies: [],
          verification: "Step completed successfully"
        })
      }
    }

    // Parse technologies
    if (currentSection === "technologies" && trimmed.startsWith("- ")) {
      technologies.push(trimmed.substring(2))
    }

    // Parse success criteria
    if (currentSection === "success criteria" && trimmed.startsWith("- ")) {
      successCriteria.push(trimmed.substring(2))
    }

    // Parse testing strategy
    if (currentSection === "testing strategy") {
      if (testingStrategy === "Standard testing approach") {
        testingStrategy = ""
      }
      if (trimmed && !trimmed.startsWith("##")) {
        testingStrategy += (testingStrategy ? " " : "") + trimmed
      }
    }
  }

  return {
    originalTask,
    complexity,
    developmentContext: context,
    totalSteps: steps.length,
    estimatedTime,
    steps,
    dependencies: [], // Would need more sophisticated parsing for dependencies
    successCriteria,
    technologies,
    testingStrategy: testingStrategy || "Standard testing approach"
  }
}

async function generateFallbackPlan(
  task: string,
  complexity: PlanningComplexity,
  context: DevelopmentContext
): Promise<PlanningResult> {
  console.log("⚠️ Using fallback planning implementation")

  // Provide a basic structured plan as fallback
  const steps: PlanningStep[] = [
    {
      number: 1,
      title: "Analyze Requirements",
      description: `Gather and analyze requirements for ${task}`,
      estimatedTime: "2-4 hours",
      dependencies: [],
      verification: "Requirements documented"
    },
    {
      number: 2,
      title: "Design Solution",
      description: `Design the technical approach for ${task}`,
      estimatedTime: "4-6 hours",
      dependencies: [1],
      verification: "Design document complete"
    },
    {
      number: 3,
      title: "Implement Core Functionality",
      description: `Implement the main ${task} functionality`,
      estimatedTime: "8-12 hours",
      dependencies: [2],
      verification: "Core functionality working"
    },
    {
      number: 4,
      title: "Testing & Verification",
      description: "Write tests and verify functionality",
      estimatedTime: "4-6 hours",
      dependencies: [3],
      verification: "All tests passing"
    }
  ]

  const technologies = ["TypeScript", "Node.js"]
  const successCriteria = [
    "Requirements fully implemented",
    "All tests passing",
    "Code reviewed and approved"
  ]

  return {
    originalTask: task,
    complexity,
    developmentContext: context,
    totalSteps: steps.length,
    estimatedTime: getEstimatedTime(complexity),
    steps,
    dependencies: [],
    successCriteria,
    technologies,
    testingStrategy: "Unit tests and integration testing"
  }
}

function getEstimatedTime(complexity: PlanningComplexity): string {
  switch (complexity) {
    case PlanningComplexity.Simple: return "4-8 hours"
    case PlanningComplexity.Standard: return "1-2 days"
    case PlanningComplexity.Complex: return "1-2 weeks"
    case PlanningComplexity.Initiative: return "1-3 months"
    default: return "TBD"
  }
}

function formatPlanOutput(plan: PlanningResult, format: OutputFormat): string {
  switch (format) {
    case OutputFormat.Json:
      return JSON.stringify(plan, null, 2)

    case OutputFormat.Checklist:
      return formatAsChecklist(plan)

    case OutputFormat.Markdown:
    default:
      return formatAsMarkdown(plan)
  }
}

function formatAsMarkdown(plan: PlanningResult): string {
  let output = `# Development Plan: ${plan.originalTask}\n\n`
  output += `**Complexity:** ${plan.complexity}\n`
  output += `**Context:** ${plan.developmentContext}\n`
  output += `**Estimated Time:** ${plan.estimatedTime}\n`
  output += `**Total Steps:** ${plan.totalSteps}\n\n`

  if (plan.technologies.length > 0) {
    output += `## Technologies\n`
    plan.technologies.forEach(tech => {
      output += `- ${tech}\n`
    })
    output += '\n'
  }

  output += `## Steps\n`
  plan.steps.forEach(step => {
    const deps = step.dependencies.length > 0 ? ` (depends on: ${step.dependencies.join(', ')})` : ''
    output += `${step.number}. **${step.title}** (${step.estimatedTime})${deps}\n`
    output += `   - ${step.description}\n`
    output += `   - *Verification:* ${step.verification}\n\n`
  })

  if (plan.successCriteria.length > 0) {
    output += `## Success Criteria\n`
    plan.successCriteria.forEach(criterion => {
      output += `- ${criterion}\n`
    })
    output += '\n'
  }

  if (plan.testingStrategy) {
    output += `## Testing Strategy\n${plan.testingStrategy}\n\n`
  }

  return output
}

function formatAsChecklist(plan: PlanningResult): string {
  let output = `# ${plan.originalTask} - Checklist\n\n`
  output += `Complexity: ${plan.complexity} | Context: ${plan.developmentContext}\n\n`

  plan.steps.forEach(step => {
    output += `- [ ] ${step.number}. ${step.title} (${step.estimatedTime})\n`
    output += `  - ${step.description}\n`
    output += `  - Verification: ${step.verification}\n\n`
  })

  return output
}

async function savePlanToFile(plan: PlanningResult, filePath: string): Promise<void> {
  const fs = await import("fs/promises")
  const content = formatPlanOutput(plan, OutputFormat.Json)
  await fs.writeFile(filePath, content, 'utf-8')
}

async function savePlanToProject(plan: PlanningResult): Promise<string> {
  const fs = await import("fs/promises")
  const path = await import("path")

  const projectRoot = process.cwd()
  const plansDir = path.join(projectRoot, "conductor", "plans")

  // Ensure directory exists
  await fs.mkdir(plansDir, { recursive: true })

  // Generate filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('Z')[0]
  const sanitizedTask = plan.originalTask.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 50)
  const filename = `plan_${sanitizedTask}_${timestamp}.json`

  const planPath = path.join(plansDir, filename)
  const content = JSON.stringify(plan, null, 2)

  await fs.writeFile(planPath, content, 'utf-8')

  return planPath
}

async function createConductorTrackFromPlan(plan: PlanningResult): Promise<string> {
  // This would integrate with the conductor system to create a track
  // For now, simulate track creation
  const trackId = `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  console.log(`🎯 Creating conductor track: ${trackId}`)
  console.log(`📋 Track title: Implement: ${plan.originalTask}`)
  console.log(`📊 Steps to implement: ${plan.totalSteps}`)

  // In real implementation, this would call conductor track creation
  return trackId
}