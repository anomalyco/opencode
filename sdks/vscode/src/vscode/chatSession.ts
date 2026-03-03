import * as vscode from "vscode"
import { ActivationController } from "./activation"
import { OpenCodeRequestHandler, ChatInput } from "./handler"

// Workaround: register under a built-in provider type so the session target picker
// recognizes and lists the provider. Try 'copilotcli' (background) if 'local' didn't.
const scheme = "copilotcli"

type SessionOption = { id: string; label: string; description?: string; detail?: string }

type SessionGroup = {
  id: string
  label: string
  options: SessionOption[]
  multiple?: boolean
}

type SessionOptions = {
  groups: SessionGroup[]
  defaults: string[]
}

type SessionState = {
  key: string
  options: string[]
  handler?: OpenCodeRequestHandler
  request?: ChatSessionRequestHandler
  history: (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]
  reply: string
}

type ChatSessionRequest = {
  command?: string
  prompt?: string
  message?: string
  text?: string
  input?: string
  references?: vscode.ChatPromptReference[]
}

type ChatSessionContext = Pick<vscode.ChatContext, "history">

type ChatSessionRequestHandler = (
  request: ChatSessionRequest,
  context: ChatSessionContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
) => Promise<vscode.ChatResult>

type ChatSessionContent = {
  type: string
  title: string
  options: SessionOptions
  history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[]
  requestHandler: ChatSessionRequestHandler
}

type Session = { id?: string; sessionId?: string }

type SessionContentProvider = {
  onDidChangeChatSessionContent?: vscode.Event<Session>
  provideChatSessionProviderOptions?: () => SessionOptions
  provideHandleOptionsChange?: () => (session: Session, selections: SessionOption[] | string[]) => void
  provideChatSessionContent: (session: Session, token: vscode.CancellationToken) => Promise<ChatSessionContent>
}

export class OpenCodeChatSessionProvider implements SessionContentProvider {
  private activation: ActivationController
  private change = new vscode.EventEmitter<Session>()
  private states = new Map<string, SessionState>()
  private ids = new WeakMap<object, string>()
  private count = 0

  onDidChangeChatSessionContent = this.change.event

  constructor(activation: ActivationController) {
    this.activation = activation
  }

  provideChatSessionProviderOptions(): SessionOptions {
    return {
      groups: [],
      defaults: [],
    }
  }

  provideHandleOptionsChange(): (session: Session, selections: SessionOption[] | string[]) => void {
    return (session: Session, selections: SessionOption[] | string[]) => {
      const state = this.getState(session)
      state.options = this.parseSelections(selections)
      this.change.fire(session)
    }
  }

  async provideChatSessionContent(session: Session, token: vscode.CancellationToken): Promise<ChatSessionContent> {
    void token
    const state = this.getState(session)
    const options = this.getOptions(state)
    const request = state.request ?? this.createRequestHandler(session)
    state.request = request

    return {
      type: scheme,
      title: "OpenCode",
      options,
      history: state.history,
      requestHandler: request,
    }
  }

  private getState(session: Session): SessionState {
    const key = this.getKey(session)
    const existing = this.states.get(key)
    if (existing) return existing

    const state = {
      key,
      options: [],
      history: [],
      reply: "",
    }
    this.states.set(key, state)
    return state
  }

  private getKey(session: Session): string {
    const known = this.getSessionId(session)
    if (known) return known

    const cached = this.ids.get(session)
    if (cached) return cached
    const next = `session-${++this.count}`
    this.ids.set(session, next)
    return next
  }

  private getSessionId(session: Session): string | undefined {
    if (session.id) return session.id
    if (session.sessionId) return session.sessionId
  }

  private getOptions(state: SessionState): SessionOptions {
    return {
      groups: [],
      defaults: state.options,
    }
  }

  private parseSelections(selections: SessionOption[] | string[]): string[] {
    if (!Array.isArray(selections)) return []
    return selections.map((item) => (typeof item === "string" ? item : item.id)).filter((item) => Boolean(item))
  }

  private createRequestHandler(session: Session): ChatSessionRequestHandler {
    return async (request, context, stream: vscode.ChatResponseStream, token) => {
      const state = this.getState(session)
      const cmd = this.getCommand(request)
      const keep = this.selectHistory(state, context.history)
      if (cmd === "new") {
        this.resetSession(state, session)
        state.reply = ""
        stream.markdown("Starting a new session...")
        return { metadata: { stopReason: "command" } }
      }

      if (cmd === "clear") {
        this.resetSession(state, session)
        state.reply = ""
        stream.markdown("Clearing conversation...")
        return { metadata: { stopReason: "command" } }
      }

      const prompt = this.getPrompt(request)
      if (!prompt) {
        stream.markdown("Please enter a message to send to OpenCode.")
        return { metadata: { stopReason: "invalid" } }
      }

      const aligned = this.alignRequest(request, prompt)

      this.activation.onSessionStarted()
      const done = () => {
        this.activation.onSessionEnded()
      }

      return this.activation
        .ensureActivated()
        .then(async (client) => {
          if (!state.handler) state.handler = new OpenCodeRequestHandler(client)
          const chatContext: vscode.ChatContext = {
            history: keep,
          }
          const result = await state.handler.handle(aligned, chatContext, stream, token)
          this.clearHistory(state)
          this.appendHistory(state, keep)
          state.reply = result.reply
          this.recordTurn(state, prompt, aligned.references, state.reply)
          return { metadata: result.metadata }
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          stream.markdown(`Sorry, I couldn't connect to OpenCode: ${message}`)
          return { metadata: { stopReason: "error" } }
        })
        .finally(done)
    }
  }

  private resetSession(state: SessionState, session: Session, keepHistory = false): void {
    state.handler?.reset()
    state.handler = undefined
    state.request = undefined
    if (!keepHistory) state.history = []
    this.change.fire(session)
  }

  private clearHistory(state: SessionState): void {
    state.history = []
  }

  private appendHistory(
    state: SessionState,
    history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[],
  ): void {
    if (history.length === 0) return
    state.history = [...state.history, ...history]
  }

  private selectHistory(
    state: SessionState,
    incoming: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[],
  ): (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[] {
    if (incoming.length > 0) return [...incoming]
    return state.history
  }

  private recordTurn(
    state: SessionState,
    prompt: string,
    refs: readonly vscode.ChatPromptReference[],
    reply: string,
  ): void {
    const request: vscode.ChatRequestTurn = {
      prompt,
      references: [...refs],
      participant: "sst-dev.opencode",
      toolReferences: [],
    }
    const response: vscode.ChatResponseTurn = {
      response: [{ value: new vscode.MarkdownString(reply) }],
      result: {},
      participant: "sst-dev.opencode",
    }
    state.history = [...state.history, request, response]
  }

  private getCommand(request: ChatSessionRequest): string | undefined {
    if (!request.command) return
    if (typeof request.command === "string") return request.command
  }

  private getPrompt(request: ChatSessionRequest): string | undefined {
    const prompt = request.prompt
    if (typeof prompt === "string" && prompt.trim()) return prompt
    const message = request.message
    if (typeof message === "string" && message.trim()) return message
    const text = request.text
    if (typeof text === "string" && text.trim()) return text
    const input = request.input
    if (typeof input === "string" && input.trim()) return input
  }

  private alignRequest(request: ChatSessionRequest, prompt: string): ChatInput {
    const references = Array.isArray(request.references) ? request.references : []
    const command = typeof request.command === "string" ? request.command : undefined
    const base: ChatInput = {
      prompt,
      references,
      command,
    }
    return base
  }
}

export const sessionScheme = scheme
