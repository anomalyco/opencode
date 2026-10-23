import { ClientCdpSessionAlias, type CdpClientPool } from "./cdp-client-pool.ts"
import { canClientSeeTarget } from "./cdp-visibility.ts"
import type { CdpRequest, TargetInfo } from "./protocol.ts"
import { getString, isRestrictedTarget } from "./relay-helpers.ts"
import type { ChildTarget, ConnectedTarget } from "./relay-types.ts"
import { shouldExposeChildTarget, type TargetRegistry } from "./target-registry.ts"

const rootRoutableBrowserContextMethods = new Set([
  "Browser.grantPermissions",
  "Browser.resetPermissions",
  "Storage.getCookies",
  "Storage.setCookies",
  "Storage.clearCookies",
])

export function isRootRoutableBrowserContextMethod(method: string): boolean {
  return rootRoutableBrowserContextMethods.has(method)
}

export type CdpRoutedSession = {
  readonly tabId: number
  readonly rootSessionId: string
  readonly chromeSessionId?: string
}

export class CdpRouter<Client extends object> {
  constructor(
    private readonly clients: CdpClientPool<Client>,
    private readonly registry: TargetRegistry,
  ) {}

  canSeeTarget(client: Client, target: ConnectedTarget): boolean {
    return this.clients.has(client) && this.canSessionSeeTarget(this.clients.sessionId(client), target)
  }

  canSessionSeeTarget(clientSessionId: string | undefined, target: ConnectedTarget): boolean {
    return canClientSeeTarget({
      clientSessionId,
      targetOwnerSessionId: target.opencodeBrowserSessionId,
      targetOwner: target.owner,
      clientHasOwnedTarget: clientSessionId !== undefined && this.registry
        .listRootTargets()
        .some((candidate) => candidate.opencodeBrowserSessionId === clientSessionId),
    })
  }

  canSeeTab(client: Client, tabId: number): boolean {
    const rootTarget = this.registry.tabTargets.get(tabId)
    return rootTarget ? this.canSeeTarget(client, rootTarget) : false
  }

  preferredRoot(client: Client, browserContextId?: string): ConnectedTarget | undefined {
    const clientSessionId = this.clients.sessionId(client)
    const candidates = this.registry.listRootTargets().filter((target) => {
      if (target.crashed) return false
      if (browserContextId !== undefined && target.targetInfo.browserContextId !== browserContextId) return false
      return clientSessionId !== undefined
        ? target.opencodeBrowserSessionId === clientSessionId
        : this.canSeeTarget(client, target)
    })
    if (candidates.length === 0) return undefined
    if (clientSessionId !== undefined || candidates.length === 1) return candidates[0]
    const contexts = new Set(candidates.map((target) => target.targetInfo.browserContextId))
    // CDP omits browserContextId for the singleton default context. Matching
    // absence is therefore a validated default-context identity, not a guess.
    if (contexts.size === 1) {
      return candidates[0]
    }
    return undefined
  }

  isBrowserAlias(client: Client, sessionId: string): boolean {
    return ClientCdpSessionAlias.$is("Browser")(this.clients.alias(client, sessionId))
  }

  visibleRoots(client: Client): ConnectedTarget[] {
    return this.registry.listRootTargets().filter((target) => this.canSeeTarget(client, target))
  }

  rootForSession(client: Client, sessionId: string): ConnectedTarget | undefined {
    const target = this.registry.targets.get(sessionId)
    return target && this.canSeeTarget(client, target) ? target : undefined
  }

  targetForAttach(client: Client, targetId: string): ConnectedTarget | ChildTarget | undefined {
    const root = this.registry.targetsByTargetId.get(targetId)
    if (root) return this.canSeeTarget(client, root) ? root : undefined
    const child = this.registry.childTargetsByTargetId.get(targetId)
    return child && this.canSeeTab(client, child.tabId) ? child : undefined
  }

  targetInfo(client: Client, options: {
    readonly targetId?: string
    readonly sessionId?: string
  }): ConnectedTarget | ChildTarget | undefined {
    const alias = options.sessionId ? this.clients.alias(client, options.sessionId) : undefined
    const aliasedTargetId = ClientCdpSessionAlias.$is("Target")(alias) ? alias.targetId : undefined
    const target = (options.targetId
      ? this.registry.targetsByTargetId.get(options.targetId) ?? this.registry.childTargetsByTargetId.get(options.targetId)
      : undefined) ??
      (aliasedTargetId
        ? this.registry.targetsByTargetId.get(aliasedTargetId) ?? this.registry.childTargetsByTargetId.get(aliasedTargetId)
        : undefined) ??
      (options.sessionId
        ? this.registry.targets.get(options.sessionId) ?? this.registry.childTargets.get(options.sessionId)
        : undefined)
    if (!target) return undefined
    return "owner" in target
      ? this.canSeeTarget(client, target) ? target : undefined
      : this.canSeeTab(client, target.tabId) ? target : undefined
  }

  session(client: Client, requestedSessionId: string): CdpRoutedSession | undefined {
    const sessionAlias = this.clients.alias(client, requestedSessionId)
    if (ClientCdpSessionAlias.$is("Browser")(sessionAlias)) return undefined
    const alias = ClientCdpSessionAlias.$is("Target")(sessionAlias) ? sessionAlias : undefined
    const target = alias
      ? this.registry.targetsByTargetId.get(alias.targetId) ?? this.registry.childTargetsByTargetId.get(alias.targetId)
      : this.registry.targets.get(requestedSessionId) ?? this.registry.childTargets.get(requestedSessionId)
    if (!target || !this.canSeeTab(client, target.tabId)) return undefined
    const rootSessionId = this.registry.tabTargets.get(target.tabId)?.sessionId
    if (!rootSessionId) return undefined
    const expectedChromeSessionId = "owner" in target ? undefined : target.sessionId
    if (alias && (alias.tabId !== target.tabId || alias.chromeSessionId !== expectedChromeSessionId)) return undefined
    return {
      tabId: target.tabId,
      rootSessionId,
      ...(expectedChromeSessionId ? { chromeSessionId: expectedChromeSessionId } : {}),
    }
  }

  resolveCommandRoute(client: Client, message: CdpRequest): CdpRoutedSession {
    const browserAlias = message.sessionId !== undefined && this.isBrowserAlias(client, message.sessionId)
    const rootRoutable = isRootRoutableBrowserContextMethod(message.method) && (!message.sessionId || browserAlias)
    const requestedBrowserContextId = getString(message.params, "browserContextId")
    const preferredRoot = rootRoutable ? this.preferredRoot(client, requestedBrowserContextId) : undefined
    const route = rootRoutable && preferredRoot
      ? { tabId: preferredRoot.tabId, rootSessionId: preferredRoot.sessionId }
      : message.sessionId
      ? this.session(client, message.sessionId)
      : undefined
    if (route) return route
    throw new Error(rootRoutable
      ? requestedBrowserContextId !== undefined
        ? `A healthy visible root target in browser context ${requestedBrowserContextId} is required for ${message.method}`
        : this.clients.sessionId(client) === undefined
        ? `Exactly one visible browser context is required for ${message.method}`
        : `A healthy session-owned root target is required for ${message.method}`
      : message.sessionId
      ? `Unknown CDP session ${message.sessionId} for ${message.method}`
      : `CDP sessionId is required for ${message.method}`)
  }

  reconcileClient(client: Client): void {
    this.clients.pruneInvisible(client, (tabId) => this.canSeeTab(client, tabId))
  }

  visibleTargetInfos(client: Client): TargetInfo[] {
    return this.registry.allTargetInfos({
      isRestrictedTarget,
      isVisibleTarget: (target) => {
        return this.canSeeTab(client, target.tabId) && ("owner" in target || shouldExposeChildTarget(target))
      },
    })
  }
}
