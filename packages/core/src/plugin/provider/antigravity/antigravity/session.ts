export * as AntigravitySession from "./session.js"

import { AntigravityACP } from "./acp.js"
import { AntigravityCatalog } from "./catalog.js"

/**
 * The account's Antigravity session.
 *
 * The CLI keeps the conversation, so one session is opened per working
 * directory and every turn continues it. The CLI reports the account's models
 * when the session opens, which is where the model list comes from.
 *
 * The CLI is started on the first use rather than when opencode starts, so a
 * server that never talks to Antigravity never runs it.
 */
export interface Interface {
  /** The models the account may use, grouped into models with effort levels. */
  readonly groups: () => readonly AntigravityCatalog.Group[]
  /** Open the CLI if it is not open yet, and report the account's models. */
  readonly refresh: () => Promise<readonly AntigravityCatalog.Group[]>
  /** Run one turn and report what the agent said while it ran. */
  readonly run: (
    request: Request,
    onUpdate: (update: AntigravityACP.Update) => void,
    signal: AbortSignal,
  ) => Promise<AntigravityACP.Turn>
}

export interface Request {
  /** The model to run, as the CLI names it. */
  readonly model: string
  /** The turn's text. */
  readonly prompt: string
}

export interface Options {
  /** The working directory the session runs in. */
  readonly directory: string
}

interface Opened {
  readonly client: AntigravityACP.Client
  readonly session: AntigravityACP.Session
  readonly groups: readonly AntigravityCatalog.Group[]
}

export const make = (options: Options): Interface => {
  let opened: Promise<Opened> | undefined
  let groups: readonly AntigravityCatalog.Group[] = []

  const ensure = () => {
    opened ??= start(options)
    return opened
  }

  return {
    groups: () => groups,
    refresh: async () => {
      const ready = await ensure()
      groups = ready.groups
      return groups
    },
    run: async (request, onUpdate, signal) => {
      const ready = await ensure()
      return ready.client.prompt(ready.session.sessionId, request.prompt, onUpdate, signal)
    },
  }
}

/**
 * Start the CLI and open a session.
 *
 * The CLI is missing or not signed in often enough to be worth saying so
 * plainly, so both cases fail with a message that names them.
 */
const start = async (options: Options): Promise<Opened> => {
  const client = await AntigravityACP.Client.start({})
  try {
    const session = await client.newSession(options.directory)
    return { client, session, groups: AntigravityCatalog.group(session.models) }
  } catch (cause) {
    await client.close()
    throw cause
  }
}
