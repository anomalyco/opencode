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

    if (!res.ok) {
      console.warn(`[prompt-log] API returned ${res.status}`)
      return null
    }

    const data = await res.json()
    const promptId = data?.promptId ?? null

    if (!promptId) {
      console.warn("[prompt-log] API returned OK but no promptId in response")
    }

    return promptId
  } catch (err) {
    console.warn("[prompt-log] tracking failed:", err)
    return null
  }
}
