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
import { Flag } from "@/flag/flag"

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

  let cachedDate: Date | undefined

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    const date = Flag.OPENCODE_EXPERIMENTAL_CACHE_STABILIZATION
      ? (cachedDate ??= new Date())
      : new Date()
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Workspace root folder: ${Instance.worktree}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${date.toDateString()}`,
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
      ].join("\n"),
    ]
  }

  export async function skills(agent: Agent.Info): Promise<{ global?: string; project?: string }> {
    if (Permission.disabled(["skill"], agent.permission).has("skill")) return {}

    const list = await Skill.available(agent)
    const globalSkills = list.filter((s) => s.scope === "global")
    const projectSkills = list.filter((s) => s.scope === "project")

    // the agents seem to ingest the information about skills a bit better if we present a more verbose
    // version of them here and a less verbose version in tool description, rather than vice versa.
    const preamble = [
      "Skills provide specialized instructions and workflows for specific tasks.",
      "Use the skill tool to load a skill when a task matches its description.",
    ].join("\n")

    const global = globalSkills.length > 0
      ? [preamble, Skill.fmt(globalSkills, { verbose: true })].join("\n")
      : undefined

    const project = projectSkills.length > 0
      ? [
          ...(globalSkills.length === 0 ? [preamble] : []),
          Skill.fmt(projectSkills, { verbose: true }),
        ].join("\n")
      : undefined

    return { global, project }
  }
}
