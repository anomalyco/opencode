import type { Subtask, SharedContract, ProjectConventions } from "./schema"

export namespace SharedContext {
  export function build(input: {
    task: string
    subtasks: Subtask[]
    sharedContracts?: SharedContract[]
    conventions?: ProjectConventions
  }): string {
    const parts: string[] = []

    parts.push("## Global Task")
    parts.push(input.task)

    if (input.sharedContracts && input.sharedContracts.length > 0) {
      parts.push("")
      parts.push("## Shared Contracts")
      for (const contract of input.sharedContracts) {
        parts.push(`### ${contract.name}`)
        parts.push(contract.description)
        parts.push(`Types: ${contract.types}`)
      }
    }

    if (input.conventions) {
      parts.push("")
      parts.push("## Project Conventions")
      const c = input.conventions
      if (c.serialization) parts.push(`- Serialization: ${c.serialization}`)
      if (c.auth) parts.push(`- Auth: ${c.auth}`)
      if (c.timestamps) parts.push(`- Timestamps: ${c.timestamps}`)
      if (c.naming) parts.push(`- Naming: ${c.naming}`)
      if (c.other) for (const o of c.other) parts.push(`- ${o}`)
    }

    parts.push("")
    parts.push("## All Subtasks Overview")
    for (const st of input.subtasks) {
      const deps = st.dependencies.length > 0
        ? ` (depends on: ${st.dependencies.join(", ")})`
        : ""
      parts.push(`- [${st.id}] ${st.title}${deps}`)
    }

    return parts.join("\n")
  }

  export function workerDirective(input: {
    sharedContext: string
    subtaskTitle: string
    subtaskDescription: string
    fileScope: string[]
    constraints?: string[]
    dependencyOutputs?: string
    retryDirective?: string
    mode: "task-agent" | "worktree"
  }): string {
    const parts: string[] = []

    parts.push(input.sharedContext)

    parts.push("")
    parts.push("## Your Assignment")
    parts.push(`### ${input.subtaskTitle}`)
    parts.push(input.subtaskDescription)

    parts.push("")
    parts.push("### File Scope")
    for (const f of input.fileScope) {
      parts.push(`- ${f}`)
    }

    if (input.constraints && input.constraints.length > 0) {
      parts.push("")
      parts.push("### Constraints")
      for (const c of input.constraints) {
        parts.push(`- ${c}`)
      }
    }

    if (input.dependencyOutputs) {
      parts.push("")
      parts.push("### Dependency Outputs")
      parts.push(input.dependencyOutputs)
    }

    if (input.retryDirective) {
      parts.push("")
      parts.push("### Retry Directive")
      parts.push(input.retryDirective)
    }

    parts.push("")
    parts.push("### Mode")
    if (input.mode === "worktree") {
      parts.push("You are working in an isolated git worktree. Commit your changes when done.")
    } else {
      parts.push("You are working in the shared workspace. Stay strictly within your file scope.")
    }

    return parts.join("\n")
  }
}
