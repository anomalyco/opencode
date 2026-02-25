import type { FromSandbox, ToSandbox } from "./sandbox"

type SDK = {
  client: {
    session: {
      create(input: { directory?: string; parentID?: string }): Promise<{ data?: { id: string } }>
      promptAsync(input: {
        sessionID: string
        parts?: Array<{ type: "text"; text: string }>
        system?: string
        model?: { providerID: string; modelID: string }
        tools?: Record<string, boolean>
      }): Promise<unknown>
    }
  }
  event: {
    on(type: string, handler: (event: any) => void): () => void
  }
}

type BridgeConfig = {
  sdk: SDK
  directory: string
  windowSessionID: string
  model: { providerID: string; modelID: string }
  iframe: HTMLIFrameElement
  onError?: (message: string) => void
}

const MAX_CONCURRENT = 10

export function createBridge(config: BridgeConfig) {
  let active = 0
  const pending = new Set<string>()
  let disposed = false

  function post(msg: ToSandbox) {
    if (disposed) return
    config.iframe.contentWindow?.postMessage(msg, "*")
  }

  async function handleAIRequest(id: string, prompt: string) {
    if (active >= MAX_CONCURRENT) {
      post({ type: "ai-error", id, message: "Too many concurrent requests (max 10)" })
      return
    }
    active++
    pending.add(id)
    try {
      const result = await config.sdk.client.session.promptAsync({
        sessionID: config.windowSessionID,
        parts: [{ type: "text", text: prompt }],
        system: "You are a helpful AI assistant. Respond concisely and directly.",
        model: config.model,
        tools: {},
      })

      // Collect the response text from the session events
      const text = await collectResponse(config.sdk, config.windowSessionID, id)
      if (!pending.has(id)) return
      post({ type: "ai-response", id, result: text, done: true })
    } catch (err) {
      if (!pending.has(id)) return
      post({ type: "ai-error", id, message: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      active--
      pending.delete(id)
    }
  }

  async function handleAIChat(
    id: string,
    messages: Array<{ role: string; content: string }>,
    system?: string,
    model?: string,
  ) {
    if (active >= MAX_CONCURRENT) {
      post({ type: "ai-error", id, message: "Too many concurrent requests (max 10)" })
      return
    }
    active++
    pending.add(id)
    try {
      const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n")
      const result = await config.sdk.client.session.promptAsync({
        sessionID: config.windowSessionID,
        parts: [{ type: "text", text: prompt }],
        system: system ?? "You are a helpful AI assistant. Respond concisely and directly.",
        model: config.model,
        tools: {},
      })

      const text = await collectResponse(config.sdk, config.windowSessionID, id)
      if (!pending.has(id)) return
      post({ type: "ai-response", id, result: text, done: true })
    } catch (err) {
      if (!pending.has(id)) return
      post({ type: "ai-error", id, message: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      active--
      pending.delete(id)
    }
  }

  async function handleSkillList(id: string) {
    // Skills are discovered via the server — for now return empty
    // In full implementation, this would query the skill registry
    post({
      type: "skill-list-result",
      id,
      skills: [],
    })
  }

  async function handleModelList(id: string) {
    // In full implementation, query the models context
    post({
      type: "model-list-result",
      id,
      models: [
        { id: config.model.modelID, provider: config.model.providerID },
      ],
    })
  }

  async function handleSkillInvoke(id: string, skill: string, input: string) {
    // Skill invocation: create a prompt that includes the skill context
    if (active >= MAX_CONCURRENT) {
      post({ type: "ai-error", id, message: "Too many concurrent requests (max 10)" })
      return
    }
    active++
    pending.add(id)
    try {
      const prompt = `Using the skill "${skill}", process this input:\n\n${input}`
      await config.sdk.client.session.promptAsync({
        sessionID: config.windowSessionID,
        parts: [{ type: "text", text: prompt }],
        model: config.model,
        tools: {},
      })
      const text = await collectResponse(config.sdk, config.windowSessionID, id)
      if (!pending.has(id)) return
      post({ type: "skill-result", id, result: text })
    } catch (err) {
      if (!pending.has(id)) return
      post({ type: "ai-error", id, message: err instanceof Error ? err.message : "Unknown error" })
    } finally {
      active--
      pending.delete(id)
    }
  }

  function handle(msg: FromSandbox, source: MessageEventSource | null) {
    if (disposed) return
    // Verify message comes from our iframe
    if (source !== config.iframe.contentWindow) return

    switch (msg.type) {
      case "ai-request":
        void handleAIRequest(msg.id, msg.prompt)
        break
      case "ai-chat":
        void handleAIChat(msg.id, msg.messages, msg.system, msg.model)
        break
      case "ai-stream":
        void handleAIRequest(msg.id, msg.prompt)
        break
      case "skill-invoke":
        void handleSkillInvoke(msg.id, msg.skill, msg.input)
        break
      case "skill-list":
        void handleSkillList(msg.id)
        break
      case "model-list":
        void handleModelList(msg.id)
        break
    }
  }

  function dispose() {
    disposed = true
    pending.clear()
    active = 0
  }

  return { handle, dispose }
}

async function collectResponse(sdk: SDK, sessionID: string, requestId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ""
    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        unsub()
        resolve(text || "No response received")
      }
    }, 60000)

    const unsub = sdk.event.on("message.part.updated", (event: any) => {
      if (resolved) return
      if (event.properties?.part?.sessionID !== sessionID) return
      if (event.properties?.part?.type !== "text") return
      text = event.properties.part.text ?? ""
    })

    // Also listen for session completion
    const unsub2 = sdk.event.on("session.status", (event: any) => {
      if (resolved) return
      if (event.properties?.sessionID !== sessionID) return
      const status = event.properties?.status
      if (status === "completed" || status === "idle") {
        resolved = true
        clearTimeout(timeout)
        unsub()
        unsub2()
        resolve(text)
      }
      if (status === "failed" || status === "error") {
        resolved = true
        clearTimeout(timeout)
        unsub()
        unsub2()
        reject(new Error("Session failed"))
      }
    })
  })
}
