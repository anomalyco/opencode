import { Ripgrep } from "../file/ripgrep"

import { Instance } from "../project/instance"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"

import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { Ide } from "../ide"

export namespace SystemPrompt {
  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-4") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gpt")) return [PROMPT_CODEX]
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    if (model.api.id.toLowerCase().includes("trinity")) return [PROMPT_TRINITY]
    return [PROMPT_DEFAULT]
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    const result = [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Workspace root folder: ${Instance.worktree}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<directories>`,
        `  ${
          project.vcs === "git" && false
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 50,
              })
            : ""
        }`,
        `</directories>`,
        ...getIdeContext(),
      ].join("\n"),
    ]

    return result
  }

  export async function skills(agent: Agent.Info) {
    if (Permission.disabled(["skill"], agent.permission).has("skill")) return

    const list = await Skill.available(agent)

    return [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
      // the agents seem to ingest the information about skills a bit better if we present a more verbose
      // version of them here and a less verbose version in tool description, rather than vice versa.
      Skill.fmt(list, { verbose: true }),
    ].join("\n")
  }

  /**
   * Returns a human-readable description of the current IDE editor context
   * (active file and selection) for inclusion in the system prompt.
   * Reads from the in-memory state maintained by `Ide.subscribeToContext()`,
   * so this never makes a network call.
   */
  export function getIdeContext(): string[] {
    const ctx = Ide.editorContext()
    if (!ctx.uri) return []

    return [
      `<ide-context>`,
      `  The user has ${ctx.uri} open in their IDE.`,
      ...(ctx.selection
        ? [
            `  They have ${ctx.selection.start.line === ctx.selection.end.line ? `line ${ctx.selection.start.line + 1}` : `lines ${ctx.selection.start.line + 1}-${ctx.selection.end.line + 1}`} selected:`,
            ctx.selection.text,
          ]
        : []),
      `</ide-context>`,
    ]
  }
}
