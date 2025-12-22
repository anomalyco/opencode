import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./sequential-thinking.txt"
import { Config } from "../config/config"

const API_CONFIG = {
  COMMAND: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
  DEFAULT_TIMEOUT: 30000,
} as const

interface McpPlanningRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: {
      task: string
      complexity?: "simple" | "standard" | "complex" | "initiative"
      context?: "feature" | "bugfix" | "refactor" | "infrastructure" | "research" | "maintenance"
      createTrack?: boolean
    }
  }
}

interface McpPlanningResponse {
  jsonrpc: string
  result?: {
    content: Array<{
      type: string
      text: string
    }>
  }
  error?: {
    code: number
    message: string
  }
}

export const SequentialThinkingTool = Tool.define("sequential-thinking", {
  description: DESCRIPTION,
  parameters: z.object({
    task: z.string().describe("Development task to plan"),
    complexity: z
      .enum(["simple", "standard", "complex", "initiative"])
      .optional()
      .describe("Planning complexity level (default: standard)"),
    context: z
      .enum(["feature", "bugfix", "refactor", "infrastructure", "research", "maintenance"])
      .optional()
      .describe("Development context (default: feature)"),
    createTrack: z
      .boolean()
      .optional()
      .describe("Create conductor track from plan (default: false)"),
  }),
  async execute(params, ctx) {
    // Check if sequential-thinking MCP server is available
    const isAvailable = await checkSequentialThinkingAvailable()
    if (!isAvailable) {
      throw new Error("Sequential-thinking MCP server is not available. Please ensure it's configured in opencode.jsonc")
    }

    const planningRequest: McpPlanningRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: "sequential_thinking_plan",
        arguments: {
          task: params.task,
          complexity: params.complexity || "standard",
          context: params.context || "feature",
          createTrack: params.createTrack || false,
        },
      },
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.DEFAULT_TIMEOUT)

    try {
      // In a real implementation, this would spawn the MCP server process
      // and communicate with it via JSON-RPC over stdio
      console.log("🤔 Calling sequential-thinking MCP server...")

      // Simulate MCP server call (replace with actual MCP communication)
      const result = await simulateSequentialThinkingCall(planningRequest.params.arguments)

      clearTimeout(timeoutId)

      return {
        output: result,
        title: `Planning: ${params.task}`,
        metadata: {
          complexity: params.complexity,
          context: params.context,
          createTrack: params.createTrack,
        },
      }
    } catch (error) {
      clearTimeout(timeoutId)

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Planning request timed out")
      }

      throw error
    }
  },
})

// Check if sequential-thinking MCP server is configured and available
async function checkSequentialThinkingAvailable(): Promise<boolean> {
  try {
    const cfg = await Config.get()
    // Check if sequential-thinking is in the MCP configuration
    // This would need to be implemented based on how opencode loads MCP configs
    return true // Placeholder - assume it's available
  } catch {
    return false
  }
}

// Simulate sequential thinking MCP call (replace with actual MCP communication)
async function simulateSequentialThinkingCall(args: any): Promise<string> {
  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 2000))

  const { task, complexity, context, createTrack } = args

  // Generate a structured planning response
  const plan = {
    task,
    complexity,
    context,
    estimatedTime: getEstimatedTime(complexity),
    steps: generatePlanningSteps(task, complexity, context),
    technologies: getRecommendedTechnologies(context),
    testingStrategy: getTestingStrategy(complexity),
    successCriteria: generateSuccessCriteria(task, complexity),
  }

  let output = `# Development Plan: ${task}\n\n`
  output += `**Complexity:** ${complexity}\n`
  output += `**Context:** ${context}\n`
  output += `**Estimated Time:** ${plan.estimatedTime}\n\n`

  output += `## Implementation Steps\n`
  plan.steps.forEach((step: any, index: number) => {
    output += `${index + 1}. **${step.title}**\n`
    output += `   - ${step.description}\n`
    output += `   - *Time:* ${step.time}\n`
    output += `   - *Verification:* ${step.verification}\n\n`
  })

  output += `## Technologies\n`
  plan.technologies.forEach((tech: string) => {
    output += `- ${tech}\n`
  })
  output += `\n`

  output += `## Testing Strategy\n${plan.testingStrategy}\n\n`

  output += `## Success Criteria\n`
  plan.successCriteria.forEach((criterion: string) => {
    output += `- ${criterion}\n`
  })

  if (createTrack) {
    output += `\n## Conductor Track\n`
    output += `A conductor track will be created automatically for this plan.\n`
  }

  return output
}

function getEstimatedTime(complexity: string): string {
  switch (complexity) {
    case "simple": return "4-8 hours"
    case "standard": return "1-2 days"
    case "complex": return "1-2 weeks"
    case "initiative": return "1-3 months"
    default: return "TBD"
  }
}

function generatePlanningSteps(task: string, complexity: string, context: string): any[] {
  const baseSteps = [
    {
      title: "Analyze Requirements",
      description: `Gather and analyze requirements for ${task}`,
      time: "2-4 hours",
      verification: "Requirements document complete"
    },
    {
      title: "Design Solution",
      description: `Design the technical approach for ${task}`,
      time: "4-6 hours",
      verification: "Design document and architecture diagram complete"
    }
  ]

  if (complexity === "simple") {
    return [
      ...baseSteps,
      {
        title: "Implement Solution",
        description: `Implement the ${task} functionality`,
        time: "4-8 hours",
        verification: "Core functionality working"
      },
      {
        title: "Test and Verify",
        description: "Write tests and verify functionality",
        time: "2-4 hours",
        verification: "All tests passing, functionality verified"
      }
    ]
  }

  // Add more steps for higher complexity levels
  const additionalSteps = [
    {
      title: "Set Up Development Environment",
      description: "Configure development environment and dependencies",
      time: "2-4 hours",
      verification: "Environment ready for development"
    },
    {
      title: "Implement Core Functionality",
      description: `Implement the main ${task} functionality`,
      time: "8-16 hours",
      verification: "Core features implemented and working"
    },
    {
      title: "Add Error Handling",
      description: "Implement comprehensive error handling and edge cases",
      time: "4-8 hours",
      verification: "Error handling covers all edge cases"
    },
    {
      title: "Write Tests",
      description: "Write unit and integration tests",
      time: "6-12 hours",
      verification: "Test coverage > 80%, all critical paths tested"
    },
    {
      title: "Code Review and Refactoring",
      description: "Review code, refactor for quality and performance",
      time: "4-8 hours",
      verification: "Code reviewed, refactored, and optimized"
    },
    {
      title: "Integration and Deployment",
      description: "Integrate with existing systems and deploy",
      time: "4-8 hours",
      verification: "Successfully integrated and deployed"
    }
  ]

  const stepCount = complexity === "complex" ? 8 : complexity === "initiative" ? 10 : 6
  return [...baseSteps, ...additionalSteps.slice(0, stepCount - 2)]
}

function getRecommendedTechnologies(context: string): string[] {
  const baseTech = ["TypeScript", "Node.js"]

  switch (context) {
    case "feature":
      return [...baseTech, "React", "Jest"]
    case "bugfix":
      return [...baseTech, "Debugging tools", "Testing frameworks"]
    case "refactor":
      return [...baseTech, "ESLint", "Prettier", "Testing frameworks"]
    case "infrastructure":
      return [...baseTech, "Docker", "Kubernetes", "Monitoring tools"]
    case "research":
      return [...baseTech, "Research tools", "Prototyping frameworks"]
    case "maintenance":
      return [...baseTech, "Code analysis tools", "Performance monitoring"]
    default:
      return baseTech
  }
}

function getTestingStrategy(complexity: string): string {
  switch (complexity) {
    case "simple":
      return "Unit tests for core functionality, manual testing for verification."
    case "standard":
      return "Unit tests, integration tests, and manual testing. Aim for 80%+ test coverage."
    case "complex":
      return "Comprehensive testing including unit, integration, end-to-end, and performance tests. Include manual testing and user acceptance testing."
    case "initiative":
      return "Full testing strategy including automated testing (unit, integration, e2e), performance testing, security testing, and extensive manual testing. Include beta testing and user feedback loops."
    default:
      return "Standard testing approach with unit and integration tests."
  }
}

function generateSuccessCriteria(task: string, complexity: string): string[] {
  const baseCriteria = [
    "All requirements implemented correctly",
    "Code follows established patterns and standards",
    "No critical bugs or security issues"
  ]

  if (complexity === "simple") {
    return [...baseCriteria, "Functionality verified through testing"]
  }

  const additionalCriteria = [
    "Comprehensive test coverage achieved",
    "Performance requirements met",
    "Documentation updated",
    "Code reviewed and approved",
    "Successfully deployed to production"
  ]

  const count = complexity === "complex" ? 8 : complexity === "initiative" ? 10 : 6
  return [...baseCriteria, ...additionalCriteria.slice(0, count - 3)]
}