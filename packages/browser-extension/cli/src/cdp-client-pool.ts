import { Data } from "effect"
import type { CdpEvent, JsonObject } from "./protocol.ts"
import type { ChildTarget, ConnectedTarget } from "./relay-types.ts"

type ClientCdpSessionAlias = Data.TaggedEnum<{
  Browser: {}
  Target: { readonly tabId: number; readonly targetId: string; readonly chromeSessionId?: string }
}>
export const ClientCdpSessionAlias = Data.taggedEnum<ClientCdpSessionAlias>()

type AnnouncedTarget = {
  readonly tabId: number
  readonly targetId: string
  readonly sessionId: string
  readonly parentSessionId?: string
}

type CdpClientState = {
  readonly aliases: Map<string, ClientCdpSessionAlias>
  readonly announcements: Map<string, AnnouncedTarget>
  readonly opencodeBrowserSessionId?: string
  readonly kind: "raw" | "sandbox"
  autoAttachParams?: JsonObject
}

export class CdpClientPool<Client extends object> implements Iterable<Client> {
  private readonly states = new Map<Client, CdpClientState>()
  private nextAliasId = 1
  private connectionGeneration = 0

  constructor(
    private readonly send: (client: Client, event: CdpEvent) => void,
    /** Observe every canonical session this client stops seeing, announced or silent. */
    private readonly retired: (client: Client, sessionId: string) => void,
  ) {}

  register(client: Client, opencodeBrowserSessionId?: string, kind: "raw" | "sandbox" = "raw"): void {
    if (this.states.has(client)) throw new Error("CDP client is already registered")
    this.states.set(client, {
      aliases: new Map(),
      announcements: new Map(),
      kind: opencodeBrowserSessionId ? kind : "raw",
      ...(opencodeBrowserSessionId ? { opencodeBrowserSessionId } : {}),
    })
    this.connectionGeneration += 1
  }

  unregister(client: Client): number | undefined {
    if (!this.states.delete(client) || this.states.size !== 0) return undefined
    return ++this.connectionGeneration
  }

  get size(): number {
    return this.states.size
  }

  has(client: Client): boolean {
    return this.states.has(client)
  }

  [Symbol.iterator](): IterableIterator<Client> {
    return this.states.keys()
  }

  sessionId(client: Client): string | undefined {
    return this.states.get(client)?.opencodeBrowserSessionId
  }

  isSandbox(client: Client): boolean {
    return this.states.get(client)?.kind === "sandbox"
  }

  hasSession(client: Client, sessionId: string): boolean {
    return this.states.get(client)?.announcements.has(sessionId) ?? false
  }

  announce(client: Client, target: ConnectedTarget | ChildTarget): void {
    const state = this.requireState(client)
    const targetId = target.targetInfo.targetId
    const existing = Array.from(state.announcements.values()).find((entry) => entry.targetId === targetId)
    if (existing?.sessionId === target.sessionId) return
    if (existing) this.detachSession(client, state, existing.sessionId)
    this.detachSession(client, state, target.sessionId)
    const parent = "parentSessionId" in target ? { parentSessionId: target.parentSessionId } : {}
    state.announcements.set(target.sessionId, { tabId: target.tabId, targetId, sessionId: target.sessionId, ...parent })
    this.send(client, {
      ...(parent.parentSessionId === undefined ? {} : { sessionId: parent.parentSessionId }),
      method: "Target.attachedToTarget",
      params: {
        sessionId: target.sessionId,
        targetInfo: { ...target.targetInfo, attached: true },
        waitingForDebugger: "waitingForDebugger" in target ? target.waitingForDebugger : false,
      },
    })
  }

  detach(client: Client, sessionId: string): void {
    const state = this.requireState(client)
    if (state.aliases.delete(sessionId)) return
    this.detachSession(client, state, sessionId, { notify: false })
  }

  detachTab(tabId: number, options: { readonly destroyed?: boolean } = {}): void {
    for (const [client, state] of this.states) {
      this.removeTargetAliases(state, (alias) => alias.tabId === tabId)
      for (const announced of state.announcements.values()) {
        if (announced.tabId === tabId) this.detachSession(client, state, announced.sessionId, options)
      }
    }
  }

  detachTarget(target: ChildTarget, options: { readonly notify?: boolean } = {}): void {
    for (const [client, state] of this.states) {
      this.removeTargetAliases(state, (alias) => alias.targetId === target.targetInfo.targetId)
      this.detachSession(client, state, target.sessionId, options)
    }
  }

  pruneInvisible(client: Client, canSeeTab: (tabId: number) => boolean): void {
    const state = this.requireState(client)
    this.removeTargetAliases(state, (alias) => !canSeeTab(alias.tabId))
    for (const announced of state.announcements.values()) {
      if (!canSeeTab(announced.tabId)) this.detachSession(client, state, announced.sessionId)
    }
  }

  sendToViewers(rootSessionId: string, event: CdpEvent, canSeeTab: (client: Client, tabId: number) => boolean): void {
    for (const [client, state] of this.states) {
      const announced = state.announcements.get(rootSessionId)
      if (!announced) continue
      if (!canSeeTab(client, announced.tabId)) {
        this.pruneInvisible(client, (tabId) => canSeeTab(client, tabId))
        continue
      }
      this.send(client, event)
    }
  }

  setAutoAttachParams(client: Client, params: JsonObject | undefined): void {
    const state = this.requireState(client)
    if (params === undefined) delete state.autoAttachParams
    else state.autoAttachParams = params
  }

  autoAttachParams(client: Client): JsonObject | undefined {
    return this.states.get(client)?.autoAttachParams
  }

  isCurrentIdleGeneration(generation: number): boolean {
    return this.states.size === 0 && this.connectionGeneration === generation
  }

  createBrowserAlias(client: Client): string {
    const aliasId = this.nextAlias("browser")
    this.requireState(client).aliases.set(aliasId, ClientCdpSessionAlias.Browser())
    return aliasId
  }

  createTargetAlias(client: Client, target: ConnectedTarget | ChildTarget): string {
    const aliasId = this.nextAlias("session")
    this.requireState(client).aliases.set(aliasId, ClientCdpSessionAlias.Target({
      tabId: target.tabId,
      targetId: target.targetInfo.targetId,
      ...("parentSessionId" in target ? { chromeSessionId: target.sessionId } : {}),
    }))
    return aliasId
  }

  alias(client: Client, aliasId: string): ClientCdpSessionAlias | undefined {
    return this.states.get(client)?.aliases.get(aliasId)
  }

  private detachSession(client: Client, state: CdpClientState, sessionId: string, options: {
    readonly notify?: boolean
    readonly destroyed?: boolean
  } = {}): void {
    const announced = state.announcements.get(sessionId)
    if (!announced) return
    state.announcements.delete(sessionId)
    this.removeTargetAliases(state, (alias) => alias.targetId === announced.targetId)
    // Descendants must disappear before their parent, including on replacement.
    for (const child of state.announcements.values()) {
      if (child.parentSessionId === sessionId) this.detachSession(client, state, child.sessionId, options)
    }
    this.retired(client, sessionId)
    if (options.notify === false) return
    if (options.destroyed && announced.parentSessionId === undefined) {
      this.send(client, { method: "Target.targetDestroyed", params: { targetId: announced.targetId } })
    }
    this.send(client, {
      ...(announced.parentSessionId === undefined ? {} : { sessionId: announced.parentSessionId }),
      method: "Target.detachedFromTarget",
      params: { sessionId, targetId: announced.targetId },
    })
  }

  private removeTargetAliases(state: CdpClientState, matches: (alias: Data.TaggedEnum.Value<ClientCdpSessionAlias, "Target">) => boolean): void {
    for (const [aliasId, alias] of state.aliases) {
      if (ClientCdpSessionAlias.$is("Target")(alias) && matches(alias)) state.aliases.delete(aliasId)
    }
  }

  private nextAlias(kind: "browser" | "session"): string {
    return `bc-client-${kind}-${this.nextAliasId++}`
  }

  private requireState(client: Client): CdpClientState {
    const state = this.states.get(client)
    if (!state) throw new Error("CDP client is not registered")
    return state
  }
}
