import { Ripgrep } from "../file/ripgrep"

import { Instance } from "../project/instance"

import { PROMPTS } from "./prompt/registry"
import type { Provider } from "@/provider/provider"

export namespace SystemPrompt {
  export function instructions() {
    return PROMPTS.codex.trim()
  }

  export function provider(model: Provider.Model) {
    if (model.systemPrompt) return [PROMPTS[model.systemPrompt]]
    if (model.api.id.includes("gpt-5")) return [PROMPTS.codex]
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPTS.beast]
    if (model.api.id.includes("gemini-")) return [PROMPTS.gemini]
    if (model.api.id.includes("claude")) return [PROMPTS.anthropic]
    if (model.api.id.toLowerCase().includes("trinity")) return [PROMPTS.trinity]
    return [PROMPTS.qwen]
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
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
      ].join("\n"),
    ]
  }
}
