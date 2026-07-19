import type { LocationGetOutput, ModelRef, OpenCodeClient, SessionInfo } from "@opencode-ai/client/promise"
import { Model } from "@opencode-ai/schema/model"

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
    super(cause instanceof Error ? cause.message : "Session target mutation failed", { cause })
  }
}

export async function resolveSessionTarget(input: {
  client: OpenCodeClient
  location?: { directory?: string; workspace?: string }
  continue?: boolean
  session?: string
  fork?: boolean
  model?: ModelRef
  agent?: string
  prepare: SessionTargetPreparation
  signal?: AbortSignal
}): Promise<SessionTarget> {
  const selection = await selectSession(input)
  const selected = selection.session
  const location =
    selection.location ??
    (await resolveLocation(
      input.client,
      selected ? { directory: selected.location.directory, workspace: selected.location.workspaceID } : input.location,
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
          agent: prepared.agent,
          model: prepared.model,
          location: { directory: location.directory, workspaceID: location.workspaceID },
        },
        ...requestOptions(input.signal),
      )
      .catch((error) => {
        throw new SessionTargetMutationError(error)
      }))
  return {
    session,
    location,
    model: prepared.model,
    agent: prepared.agent,
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
  location?: { directory?: string; workspace?: string }
  continue?: boolean
  session?: string
  fork?: boolean
  signal?: AbortSignal
}) {
  const explicit = input.session
    ? await input.client.session.get({ sessionID: input.session }, ...requestOptions(input.signal)).catch((error) => {
        if (error && typeof error === "object" && Reflect.get(error, "_tag") === "SessionNotFoundError")
          return undefined
        throw error
      })
    : undefined
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

async function latestSession(
  client: OpenCodeClient,
  location: LocationGetOutput,
  cursor?: string,
  signal?: AbortSignal,
): Promise<SessionInfo | undefined> {
  const page = await client.session.list(
    {
      directory: location.directory,
      workspace: location.workspaceID,
      parentID: null,
      limit: SESSION_PAGE_LIMIT,
      order: "desc",
      ...(cursor ? { cursor } : {}),
    },
    ...requestOptions(signal),
  )
  const selected = page.data.find(
    (session) =>
      session.location.directory === location.directory && session.location.workspaceID === location.workspaceID,
  )
  if (selected) return selected
  if (!page.cursor.next || page.data.length === 0) return
  return latestSession(client, location, page.cursor.next, signal)
}

function resolveLocation(
  client: OpenCodeClient,
  location?: { directory?: string; workspace?: string },
  signal?: AbortSignal,
) {
  if (!location && !signal) return client.location.get()
  if (!location) return client.location.get(undefined, { signal })
  return client.location.get({ location }, ...requestOptions(signal))
}

function requestOptions(signal?: AbortSignal): [] | [{ signal: AbortSignal }] {
  return signal ? [{ signal }] : []
}
