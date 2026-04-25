import { AgentDisplay } from "@/agent/display"

export function modeLabel(mode: string) {
  return AgentDisplay.title(mode)
}

export * as AssistantFooter from "./assistant-footer"
