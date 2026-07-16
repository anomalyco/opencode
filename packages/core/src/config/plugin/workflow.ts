export * as ConfigWorkflowPlugin from "./workflow"

import { define } from "../../plugin/internal"
import { Effect } from "effect"
import { CommandV2 } from "../../command"
import { FSUtil } from "../../fs-util"
import { Location } from "../../location"
import matter from "gray-matter"
import * as fs from "fs"
import * as path from "path"

function parseYaml(content: string) {
  const result = matter(`---\n${content}\n---`)
  return { data: result.data, content: "" }
}

function loadWorkflows(directory: string): Array<{ name: string; description?: string }> {
  const workflows: Array<{ name: string; description?: string }> = []
  const workflowDir = path.join(directory, ".opencode", "workflows")

  if (!fs.existsSync(workflowDir)) return workflows

  try {
    const files = fs.readdirSync(workflowDir)
    for (const file of files) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue
      const filepath = path.join(workflowDir, file)
      try {
        const content = fs.readFileSync(filepath, "utf-8")
        const parsed = parseYaml(content)
        const name = file.replace(/\.(yaml|yml)$/, "")
        const data = parsed.data as Record<string, unknown>
        workflows.push({
          name,
          description: (data.description as string) ?? `Run ${name} workflow`,
        })
      } catch {
        // Skip invalid YAML files
      }
    }
  } catch {
    // Skip if directory read fails
  }

  return workflows
}

export const Plugin = define({
  id: "config-workflow",
  effect: Effect.fn(function* (ctx) {
    const location = yield* Location.Service
    yield* ctx.command.transform((draft) => {
      const workflows = loadWorkflows(location.directory)
      for (const workflow of workflows) {
        draft.update(`workflow/${workflow.name}`, (command) => {
          command.template = `[Workflow: ${workflow.name}] ${workflow.description}`
          command.description = workflow.description
        })
      }
    })
  }),
})
