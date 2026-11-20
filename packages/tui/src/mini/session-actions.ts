import { messagePrompt } from "./session.shared"
import type { FooterApi, RunAction, RunInput } from "./types"

export const SESSION_ACTIONS: RunAction[] = [
  { command: "sessions", display: "Switch session", keywords: "/sessions resume open session" },
  { command: "rename", display: "Rename session", keywords: "/rename title", prefill: true },
  { command: "fork", display: "Fork session", keywords: "/fork copy branch" },
  { command: "undo", display: "Undo previous message", keywords: "/undo revert" },
  { command: "redo", display: "Redo", keywords: "/redo restore" },
  { command: "mcp", display: "MCP servers", keywords: "/mcp connect disconnect tools" },
]

type Deps = {
  sdk: () => RunInput["sdk"]
  sessionID: () => string
  directory: () => string
  footer: FooterApi
  open: (sessionID: string) => Promise<void>
  retitle: (title: string) => void
}

// Runs one of the slash commands in SESSION_ACTIONS. Failures are printed, never thrown.
export async function runSessionCommand(deps: Deps, text: string) {
  const [, name, args = ""] = /^\/(\S+)\s*(.*)$/s.exec(text.trim()) ?? []
  await commands[name?.toLowerCase() ?? ""]?.(deps, args.trim()).catch((error) =>
    deps.footer.append({
      kind: "error",
      text: error instanceof Error ? error.message : String(error),
      phase: "final",
      source: "system",
    }),
  )
}

const commands: Record<string, (deps: Deps, args: string) => Promise<void>> = {
  sessions: async (deps, id) => {
    if (id) return id === deps.sessionID() ? undefined : deps.open(id)
    deps.footer.event({
      type: "picker",
      picker: {
        title: "Switch session",
        empty: "No sessions found",
        load: () =>
          deps
            .sdk()
            .session.list({ directory: deps.directory(), parentID: null, limit: 50, order: "desc" })
            .then((page) =>
              page.data.map((session) => ({
                id: session.id,
                display: session.title || session.id,
                description: new Date(session.time.updated).toLocaleString(),
                current: session.id === deps.sessionID(),
              })),
            ),
        // Goes through the prompt queue so the switch waits for any active turn.
        onSelect: (id) => deps.footer.submit({ text: `/sessions ${id}`, parts: [] }),
      },
    })
  },

  rename: async (deps, title) => {
    if (!title) return say(deps, "usage: /rename <new title>")
    await deps.sdk().session.update({ sessionID: deps.sessionID(), title })
    deps.retitle(title)
    say(deps, `renamed session to ${title}`)
  },

  fork: async (deps) => {
    const forked = await deps.sdk().session.fork({ sessionID: deps.sessionID() })
    await deps.open(forked.id)
    say(deps, `forked session ${forked.id}`)
  },

  undo: async (deps) => {
    const sdk = deps.sdk()
    const sessionID = deps.sessionID()
    const [session, messages] = await Promise.all([
      sdk.session.get({ sessionID }),
      sdk.message.list({ sessionID, limit: 50, order: "desc" }),
    ])
    // A staged revert hides that message and everything after it, so undo again steps further back.
    const staged = messages.data.findIndex((item) => item.id === session.revert?.messageID)
    const message = messages.data.slice(staged + 1).find((item) => item.type === "user" && item.text.trim())
    if (message?.type !== "user") return say(deps, "nothing to undo")
    await sdk.session.interrupt({ sessionID })
    await sdk.session.wait({ sessionID })
    await sdk.session.revert.stage({ sessionID, messageID: message.id })
    deps.footer.event({ type: "prefill", prompt: messagePrompt(message) })
    say(deps, "undid the previous message and put it back in the prompt")
  },

  redo: async (deps) => {
    await deps.sdk().session.revert.clear({ sessionID: deps.sessionID() })
    say(deps, "restored the undone message")
  },

  mcp: async (deps) =>
    deps.footer.event({
      type: "picker",
      picker: {
        title: "MCP servers",
        empty: "No MCP servers configured",
        load: () =>
          deps
            .sdk()
            .mcp.list({ location: { directory: deps.directory() } })
            .then((list) =>
              list.data.map((server) => ({
                id: server.name,
                display: server.name,
                footer: server.status.status,
                current: server.status.status === "connected",
              })),
            ),
        onSelect: (name) => void runSessionCommand(deps, `/toggle-mcp ${name}`),
      },
    }),

  "toggle-mcp": async (deps, name) => {
    const sdk = deps.sdk()
    const input = { server: name, location: { directory: deps.directory() } }
    const server = (await sdk.mcp.list({ location: input.location })).data.find((item) => item.name === name)
    if (!server) return say(deps, `no MCP server named ${name}`)
    if (server.status.status === "needs_auth")
      return say(deps, `${name} needs authentication. Connect it from the full interface.`)
    const connected = server.status.status === "connected"
    await (connected ? sdk.mcp.disconnect(input) : sdk.mcp.connect(input))
    say(deps, connected ? `disconnected ${name}` : `connecting ${name}`)
  },
}

function say(deps: Deps, text: string) {
  deps.footer.append({ kind: "system", text, phase: "final", source: "system" })
}
