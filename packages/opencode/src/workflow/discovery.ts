import { Glob } from "@opencode-ai/core/util/glob"
import * as Log from "@opencode-ai/core/util/log"
import path from "path"

const log = Log.create({ service: "workflow.discovery" })

export interface DiscoveredWorkflow {
  name: string
  description: string
  script: string
  source: "project" | "user"
}

export async function discoverWorkflows(configDirs: string[]): Promise<DiscoveredWorkflow[]> {
  const results: DiscoveredWorkflow[] = []
  const seen = new Set<string>()

  for (const dir of configDirs) {
    const workflowsDir = path.join(dir, ".opencode", "workflows")
    const matches = await Glob.scan("*.js", { cwd: workflowsDir, absolute: true, dot: true, symlink: true }).catch(
      () => [],
    )

    for (const match of matches) {
      const name = path.basename(match, ".js")
      if (seen.has(name)) continue
      seen.add(name)

      const content = await Bun.file(match).text().catch(() => {
        log.warn("failed to read workflow file", { file: match })
        return ""
      })
      if (!content) continue

      const descMatch = content.match(/^\/\/\s*(.+)$/m)
      const description = descMatch?.[1] ?? `workflow: ${name}`

      results.push({
        name,
        description,
        script: content,
        source: dir === configDirs[0] ? "project" : "user",
      })
    }
  }

  return results
}

export function workflowTemplate(script: string): string {
  return [
    "Use the workflow tool to execute this workflow script with the provided arguments.",
    "",
    "<workflow_script>",
    script,
    "</workflow_script>",
    "",
    "Pass $ARGUMENTS as the `args` parameter to the workflow tool.",
  ].join("\n")
}

export * as WorkflowDiscovery from "./discovery"
