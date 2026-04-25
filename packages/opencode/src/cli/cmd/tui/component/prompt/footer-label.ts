import { AgentDisplay } from "@/agent/display"

export function agent(mode: "normal" | "shell", name: string) {
  if (mode === "shell") return "Shell"
  return AgentDisplay.title(name)
}

export * as PromptFooterLabel from "./footer-label"
