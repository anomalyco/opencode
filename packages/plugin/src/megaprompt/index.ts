import type { Plugin, PluginInput, Hooks } from "../index"
import { tool } from "../tool"
import { orchestrate, formatFailures, type ModelConfig } from "./orchestrator"
import { buildJudgePrompt, parseEvaluationResult, type ModelResponse } from "./evaluator"

export type MegaPromptConfig = {
  models?: string[]
  evaluatorModel?: string
  timeout?: number
}

const DEFAULT_MODELS = ["openai/gpt-4o", "anthropic/claude-3-5-sonnet-20241022", "google/gemini-2.0-flash-exp"]
const DEFAULT_EVALUATOR = "google/gemini-2.0-flash-exp"

function parseModelString(modelStr: string): ModelConfig {
  const parts = modelStr.split("/")
  if (parts.length < 2) {
    return { providerID: modelStr, modelID: modelStr }
  }
  return { providerID: parts[0], modelID: parts.slice(1).join("/") }
}

export const MegaPromptPlugin: Plugin = async (ctx: PluginInput): Promise<Hooks> => {
  return {
    tool: {
      mega: tool({
        description:
          "Execute a MegaPrompt workflow: sends a prompt to multiple AI models in parallel, then uses an evaluator model to select the best response and identify improvements from other responses.",
        args: {
          prompt: tool.schema.string().describe("The prompt to send to all models"),
          models: tool.schema
            .string()
            .optional()
            .describe(
              "Comma-separated list of models to query (format: provider/model). Defaults to gpt-4o, claude-3-5-sonnet, gemini-2.0-flash",
            ),
          evaluator: tool.schema
            .string()
            .optional()
            .describe("The evaluator model to use for judging (format: provider/model). Defaults to gemini-2.0-flash"),
        },
        async execute(args, context) {
          const { prompt, models: modelsArg, evaluator: evaluatorArg } = args

          const modelStrings = modelsArg ? modelsArg.split(",").map((m) => m.trim()) : DEFAULT_MODELS
          const evaluatorString = evaluatorArg || DEFAULT_EVALUATOR

          const models = modelStrings.map(parseModelString)
          const evaluator = parseModelString(evaluatorString)

          context.metadata({ title: `MegaPrompt: Querying ${models.length} models...` })

          // Define a generate function that uses the SDK client
          const generate = async (model: ModelConfig, userPrompt: string): Promise<string> => {
            // Create a session for this model query
            const sessionResult = await ctx.client.session.create({
              body: {},
            })

            if (!sessionResult.data) {
              throw new Error(`Failed to create session for ${model.providerID}/${model.modelID}`)
            }

            const sessionID = sessionResult.data.id

            // Send the prompt to this specific model
            const promptResult = await ctx.client.session.prompt({
              path: { id: sessionID },
              body: {
                parts: [{ type: "text", text: userPrompt }],
                providerID: model.providerID,
                modelID: model.modelID,
              },
            })

            if (!promptResult.data) {
              throw new Error(`Failed to get response from ${model.providerID}/${model.modelID}`)
            }

            // Extract the text response from the message parts
            const response = promptResult.data
            const textParts = response.parts.filter((p: { type: string }) => p.type === "text")
            const text = textParts.map((p: { type: string; text?: string }) => p.text || "").join("\n")

            // Clean up the session
            await ctx.client.session.delete({ path: { id: sessionID } }).catch(() => {})

            return text
          }

          // Orchestrate parallel queries to all models
          const responses = await orchestrate({
            prompt,
            models,
            generate,
            timeout: 120000,
          })

          const successCount = responses.filter((r) => r.success).length

          if (successCount === 0) {
            return `MegaPrompt failed: No models responded successfully.\n\nErrors:\n${responses.map((r) => `- ${r.providerID}/${r.modelID}: ${r.error}`).join("\n")}`
          }

          context.metadata({
            title: `MegaPrompt: Evaluating ${successCount} responses with ${evaluator.providerID}/${evaluator.modelID}...`,
          })

          // Build the judge prompt
          const judgePrompt = buildJudgePrompt(prompt, responses)

          // Query the evaluator model
          let evaluatorResponse: string
          try {
            evaluatorResponse = await generate(evaluator, judgePrompt)
          } catch (error) {
            // If evaluator fails, return raw responses
            return formatFallbackResponse(prompt, responses)
          }

          // Parse the evaluation result
          const result = parseEvaluationResult(evaluatorResponse, responses)

          // Format the final output
          let output = `# MegaPrompt Results\n\n`
          output += `**Original Prompt:** ${prompt}\n\n`
          output += `**Models Queried:** ${models.map((m) => `${m.providerID}/${m.modelID}`).join(", ")}\n\n`

          output += `## Winner\n\n`
          output += `**Model:** ${result.winner.providerID}/${result.winner.modelID}\n`
          output += `**Reason:** ${result.winner.reason}\n\n`

          if (result.feedback.length > 0) {
            output += `## Improvements from Other Responses\n\n`
            output += result.feedback.map((f) => `- ${f}`).join("\n")
            output += "\n\n"
          }

          output += `## Winning Response\n\n`
          output += result.winningResponse

          output += formatFailures(responses)

          return output
        },
      }),
    },
  }
}

function formatFallbackResponse(prompt: string, responses: ModelResponse[]): string {
  const successful = responses.filter((r) => r.success)

  let output = `# MegaPrompt Results (Evaluator Unavailable)\n\n`
  output += `**Original Prompt:** ${prompt}\n\n`
  output += `**Note:** The evaluator model was unavailable. Showing all successful responses below.\n\n`

  for (const response of successful) {
    output += `## ${response.providerID}/${response.modelID}\n\n`
    output += response.text
    output += "\n\n---\n\n"
  }

  output += formatFailures(responses)

  return output
}

export default MegaPromptPlugin
