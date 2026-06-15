import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { Effect } from "effect"
import type { ACPSession, RegisterChildInput } from "./session"

const maxAncestryDepth = 32

type SdkSessionInfo = {
  readonly id: string
  readonly parentID?: string
  readonly directory: string
}

export class SessionResolver {
  private readonly parentBySession = new Map<string, string>()

  constructor(
    private readonly session: ACPSession.Interface,
    private readonly sdk: OpencodeClient,
  ) {}

  invalidate(sessionId: string) {
    this.parentBySession.delete(sessionId)
    for (const [child, parent] of this.parentBySession.entries()) {
      if (parent === sessionId) this.parentBySession.delete(child)
    }
  }

  async resolve(sessionId: string, directory?: string) {
    const direct = await Effect.runPromise(this.session.tryGet(sessionId))
    if (direct) return direct

    const chain: Array<{ id: string; parentID: string; cwd: string }> = []
    const seen = new Set<string>()
    let currentID = sessionId

    for (let depth = 0; depth < maxAncestryDepth; depth++) {
      if (seen.has(currentID)) return undefined
      seen.add(currentID)

      const info = await this.fetchSdkSession(currentID, directory)
      const parentID = info?.parentID
      if (!parentID) return undefined

      if (info) this.parentBySession.set(currentID, parentID)

      chain.push({ id: currentID, parentID, cwd: info?.directory ?? "" })

      const parent = await Effect.runPromise(this.session.tryGet(parentID))
      if (parent) {
        await this.registerChain(chain, parent.cwd)
        return await Effect.runPromise(this.session.tryGet(sessionId))
      }

      currentID = parentID
    }

    return undefined
  }

  async registerChild(input: RegisterChildInput) {
    await Effect.runPromise(
      this.session.registerChild(input).pipe(Effect.catchTag("ACPSessionNotFoundError", () => Effect.void)),
    )
  }

  private async fetchSdkSession(sessionId: string, directory?: string): Promise<SdkSessionInfo | undefined> {
    const cachedParent = this.parentBySession.get(sessionId)
    const data = await this.sdk.session
      .get({ sessionID: sessionId, directory: directory ?? "" }, { throwOnError: false })
      .then((response) => response.data)
      .catch(() => undefined)

    if (!data?.parentID && !cachedParent) return undefined

    return {
      id: data?.id ?? sessionId,
      parentID: data?.parentID ?? cachedParent,
      directory: data?.directory ?? "",
    }
  }

  private async registerChain(chain: Array<{ id: string; parentID: string; cwd: string }>, fallbackCwd: string) {
    for (const link of [...chain].reverse()) {
      await this.registerChild({
        sessionId: link.id,
        parentSessionId: link.parentID,
        cwd: link.cwd || fallbackCwd,
      })
    }
  }
}

export async function resolveAcpSession(input: {
  readonly sessionId: string
  readonly session: ACPSession.Interface
  readonly sdk: OpencodeClient
  readonly directory?: string
  readonly resolver?: SessionResolver
}) {
  const resolver = input.resolver ?? new SessionResolver(input.session, input.sdk)
  return await resolver.resolve(input.sessionId, input.directory)
}

export * as ACPSessionResolve from "./session-resolve"
