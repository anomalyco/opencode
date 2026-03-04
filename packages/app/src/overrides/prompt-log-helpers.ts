export interface TrackPromptParams {
  promptText: string
  sessionId?: string
  projectName?: string
  modelId?: string
  agentName?: string
}

export async function trackPrompt(params: TrackPromptParams): Promise<string | null> {
  try {
    const res = await fetch("/api/prompt-logs", {
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
    })

    if (res.ok) {
      const data = await res.json()
      return data?.promptId ?? null
    }

    return null
  } catch (err) {
    console.warn("[prompt-log] tracking failed:", err)
    return null
  }
}
