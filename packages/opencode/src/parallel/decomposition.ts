import z from "zod"
import { generateObject } from "ai"
import { Provider } from "@/provider/provider"
import { Log } from "@/util/log"
import { SubtaskID } from "./schema"
import type { Subtask, ModelRef } from "./schema"

export namespace Decomposition {
  const log = Log.create({ service: "decomposition" })

  export const SYSTEM_PROMPT = `You are a task decomposition agent for a parallel coding system.

Given a user's task, break it down into independent subtasks that can be executed in parallel by separate coding agents. Each agent will work in an isolated git worktree branched from the same HEAD.

Rules:
1. Each subtask MUST touch a different set of files where possible. File overlap causes merge conflicts.
2. Each subtask must be self-contained — the worker agent receives ONLY the global task description and its specific subtask, nothing else.
3. Each subtask should be small enough for a single agent session (under ~500 lines changed).
4. Include a clear fileScope listing which files/directories the subtask should modify.
5. If a task cannot be meaningfully parallelized (e.g., a single-file bug fix), return exactly ONE subtask.
6. Subtask descriptions should be detailed enough for an agent to execute without ambiguity.
7. Dependencies between subtasks are NOT supported in v1 — all subtasks run simultaneously.

Output format: a JSON object with a "subtasks" array.`

  const SubtaskOutput = z.object({
    title: z.string().describe("Short label for the subtask, e.g., 'Add login form'"),
    description: z.string().describe("Full instructions for the worker agent"),
    fileScope: z.array(z.string()).describe("Files/directories this subtask should modify"),
  })

  const OutputSchema = z.object({
    subtasks: z.array(SubtaskOutput),
  })

  export async function decompose(input: {
    task: string
    model: ModelRef
    codebaseContext?: string
  }): Promise<Subtask[]> {
    log.info("decomposing task", { task: input.task.slice(0, 100) })

    const fullModel = await Provider.getModel(input.model.providerID, input.model.modelID)
    const language = await Provider.getLanguage(fullModel)

    const userContent = input.codebaseContext
      ? `## Task\n${input.task}\n\n## Codebase Context\n${input.codebaseContext}`
      : input.task

    const result = await generateObject({
      model: language,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
      schema: OutputSchema,
    })

    const subtasks: Subtask[] = result.object.subtasks.map((st) => ({
      id: SubtaskID.ascending(),
      title: st.title,
      description: st.description,
      fileScope: st.fileScope,
      dependencies: [],
    }))

    log.info("decomposition complete", { count: subtasks.length })
    return subtasks
  }
}
