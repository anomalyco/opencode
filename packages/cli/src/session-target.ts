import type { LocationGetOutput, ModelRef, OpenCodeClient, SessionInfo } from "@opencode/client/promise"
import { Model } from "@opencode/schema/model"
import { errorMessage } from "./util/error"

const SESSION_PAGE_LIMIT = 50

export type SessionTarget = {
  session: SessionInfo
  location: LocationGetOutput
  model: ModelRef | undefined
  agent: string | undefined
  resume: boolean
}

export type SessionTargetPreparation = (input: {
  client: OpenCodeClient
  location: LocationGetOutput
  session: SessionInfo | undefined
  model: ModelRef | undefined
  agent: string | undefined
  signal?: AbortSignal
}) => Promise<{ model: ModelRef | undefined; agent: string | undefined }>

export class SessionTargetMutationError extends Error {
  override readonly name = "SessionTargetMutationError"

  constructor(cause: unknown) {
    super(errorMessage(cause), { cause })
  }
}

export function validateSessionCreateInput(input: {
  createSessionID?: string
  session?: string
  continue?: boolean
  fork?: boolean
}): string | undefined {
  if (input.createSessionID === undefined) return
  if (input.session !== undefined) return "--session-id cannot be used with --session"
  if (input.continue) return "--session-id cannot be used with --continue"
  if (input.fork) return "--session-id cannot be used with --fork"
  if (!input.createSessionID.startsWith("ses")) return "--session-id must be a session ID starting with ses"
}

export async function resolveSessionTarget(input: {
  client: OpenCodeClient
  location?: { directory?: string; workspace?: string }
  continue?: boolean
  session?: string
  createSessionID?: string
  fork?: boolean
  model?: ModelRef
  agent?: string
  environment?: Readonly<Record<string, string>>
  prepare: SessionTargetPreparation
  signal?: AbortSignal
}): Promise<SessionTarget> {
  // The server returns an existing session for a supplied ID; --session-id is
  // create-only, so reject that here instead of writing into another session.
  if (input.createSessionID !== undefined && (await findSession(input.client, input.createSessionID, input.signal)))
    throw new Error(`Session already exists: ${input.createSessionID}. Use --session to continue it.`)
  const selection = await selectSession(input)
  const selected = selection.session
  const location =
    selection.location ??
    (await resolveLocation(
      input.client,
      selected ? { directory: selected.location.directory } : input.location,
      input.signal,
    ))
  const prepared = await input.prepare({
    client: input.client,
    location,
    session: selected,
    model: input.model ?? selected?.model,
    agent: input.agent ?? selected?.agent,
    signal: input.signal,
  })
  const session =
    selected ??
    (await input.client.session
      .create(
        {
          id: input.createSessionID,
          agent: prepared.agent,
          model: prepared.model,
          location: { directory: location.directory },
        },
        ...requestOptions(input.signal),
      )
      .catch((error) => {
        throw new SessionTargetMutationError(error)
      }))
  if (input.environment !== undefined)
    await input.client.session
      .environment({ sessionID: session.id, variables: input.environment }, ...requestOptions(input.signal))
      .catch((error) => {
        throw new SessionTargetMutationError(error)
      })
  return {
    session,
    location,
    model: prepared.model,
    agent: prepared.agent ?? session.agent,
    resume: selected !== undefined,
  }
}

export function parseSessionTargetModel(value?: string): ModelRef | undefined {
  if (!value) return
  const model = Model.Ref.parse(value)
  return { providerID: model.providerID, id: model.id, variant: model.variant }
}

async function selectSession(input: {
  client: OpenCodeClient
  location?: { directory?: string }
  continue?: boolean
  session?: string
  fork?: boolean
  signal?: AbortSignal
}) {
  const explicit = input.session ? await findSession(input.client, input.session, input.signal) : undefined
  if (input.session && !explicit) throw new Error("Session not found")
  if (explicit)
    return {
      session: input.fork
        ? await input.client.session
            .fork({ sessionID: explicit.id }, ...requestOptions(input.signal))
            .catch((error) => {
              throw new SessionTargetMutationError(error)
            })
        : explicit,
    }
  if (!input.continue) return { session: undefined }

  const location = await resolveLocation(input.client, input.location, input.signal)
  const selected = await latestSession(input.client, location, undefined, input.signal)
  if (!selected) return { session: undefined, location }
  return {
    session: input.fork
      ? await input.client.session.fork({ sessionID: selected.id }, ...requestOptions(input.signal)).catch((error) => {
          throw new SessionTargetMutationError(error)
        })
      : selected,
  }
}

async function findSession(client: OpenCodeClient, sessionID: string, signal?: AbortSignal) {
  return client.session.get({ sessionID }, ...requestOptions(signal)).catch((error) => {
    if (error && typeof error === "object" && "_tag" in error && error._tag === "SessionNotFoundError") return undefined
    throw error
  })
}

async function latestSession(
  client: OpenCodeClient,
  location: LocationGetOutput,
  cursor?: string,
  signal?: AbortSignal,
): Promise<SessionInfo | undefined> {
  const page = await client.session.list(
    {
      directory: location.directory,
      parentID: null,
      limit: SESSION_PAGE_LIMIT,
      order: "desc",
      ...(cursor ? { cursor } : {}),
    },
    ...requestOptions(signal),
  )
  const selected = page.data.find((session) => session.location.directory === location.directory)
  if (selected) return selected
  if (!page.cursor.next || page.data.length === 0) return
  return latestSession(client, location, page.cursor.next, signal)
}

function resolveLocation(client: OpenCodeClient, location?: { directory?: string }, signal?: AbortSignal) {
  if (!location && !signal) return client.location.get()
  if (!location) return client.location.get(undefined, { signal })
  return client.location.get({ location }, ...requestOptions(signal))
}

function requestOptions(signal?: AbortSignal): [] | [{ signal: AbortSignal }] {
  return signal ? [{ signal }] : []
}
