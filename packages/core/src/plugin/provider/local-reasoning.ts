export * as LocalReasoning from "./local-reasoning.js"

import { Model } from "../../model.js"

type Option = "off" | "on" | "low" | "medium" | "high"

export function fromOptions(options: readonly Option[]) {
  return variants(
    options.map((option) => {
      if (option === "off") return ["none", "none"] as const
      if (option === "on") return ["thinking", "medium"] as const
      return [option, option] as const
    }),
  )
}

export function infer(engine: "ollama" | "vllm", model: string) {
  const id = model.toLowerCase().replaceAll("_", "-")
  if (id.includes("gpt-oss") || id.includes("gptoss"))
    return variants([
      ["low", "low"],
      ["medium", "medium"],
      ["high", "high"],
    ])
  if (id.includes("deepseek-v4") || id.includes("deepseekv4"))
    return variants([
      ["none", "none"],
      ["high", "high"],
      ["max", "max"],
    ])
  if (id.includes("qwen3") || id.includes("gemma-4") || id.includes("gemma4")) return toggle()
  return engine === "ollama" ? toggle() : []
}

function toggle() {
  return variants([
    ["none", "none"],
    ["thinking", "medium"],
  ])
}

function variants(items: ReadonlyArray<readonly [id: string, effort: string]>) {
  return items.map(([id, effort]) => ({
    id: Model.VariantID.make(id),
    settings: { reasoningEffort: effort },
  }))
}
