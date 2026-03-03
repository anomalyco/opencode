export interface TrackPromptParams {
  promptText: string
  sessionId?: string
  projectName?: string
  modelId?: string
  agentName?: string
}

export function trackPrompt(params: TrackPromptParams): void {
  fetch("/api/prompt-logs", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      promptText: params.promptText,
      sessionId: params.sessionId,
      projectName: params.projectName,
      modelId: params.modelId,
      agentName: params.agentName,
    }),
  }).catch((err) => console.warn("[prompt-log] tracking failed:", err))
}
