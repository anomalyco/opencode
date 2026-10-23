import type { WebSocket } from "ws"
import type { CdpRequest, JsonObject, TargetInfo } from "./protocol.ts"
import { getObject, getString, sendCdpEvent } from "./relay-helpers.ts"
import type { ChildTarget } from "./relay-types.ts"
import { shouldExposeChildTarget, type TargetRegistry } from "./target-registry.ts"
import type { CdpClientPool } from "./cdp-client-pool.ts"

export function removeDefaultLightColorSchemeEmulation(message: CdpRequest): CdpRequest {
  if (message.method !== "Emulation.setEmulatedMedia") {
    return message
  }
  const features = Array.isArray(message.params?.features) ? message.params.features : []
  const isExplicit = features.some((feature) => {
    const object = getObject(feature)
    return object?.name === "__bc_explicit__"
  })
  if (isExplicit) {
    return {
      ...message,
      params: {
        ...message.params,
        features: features.filter((feature) => {
          const object = getObject(feature)
          return object?.name !== "__bc_explicit__"
        }),
      },
    }
  }
  const hasDefaultLightColorScheme = features.some((feature) => {
    const object = getObject(feature)
    return object?.name === "prefers-color-scheme" && object.value === "light"
  })
  if (!hasDefaultLightColorScheme) {
    return message
  }
  return {
    ...message,
    params: {
      ...message.params,
      features: features.filter((feature) => {
        const object = getObject(feature)
        return object?.name !== "prefers-color-scheme"
      }),
    },
  }
}

export function replayChildTargetsForParent<Client extends Pick<WebSocket, "send">>(options: {
  readonly socket: Client
  readonly parentSessionId: string
  readonly registry: TargetRegistry
  readonly clients: CdpClientPool<Client>
}): void {
  for (const target of options.registry.childTargets.values()) {
    if (target.parentSessionId === options.parentSessionId && shouldExposeChildTarget(target)) {
      replayFrameEventsForChild({ socket: options.socket, registry: options.registry, target })
      options.clients.announce(options.socket, target)
      replayChildFrameNavigation({ socket: options.socket, registry: options.registry, target })
    }
  }
}

function replayFrameEventsForChild(options: { readonly socket: Pick<WebSocket, "send">; readonly registry: TargetRegistry; readonly target: ChildTarget }): void {
  if (options.target.targetInfo.type !== "iframe") {
    return
  }
  const frameEvents = options.registry.tabFrameEvents.get(options.target.tabId)?.get(options.target.targetInfo.targetId)
  if (!frameEvents) {
    return
  }
  if (frameEvents.attached) {
    sendCdpEvent(options.socket, { sessionId: options.target.parentSessionId, method: "Page.frameAttached", params: frameEvents.attached })
  }
  if (frameEvents.navigated) {
    sendCdpEvent(options.socket, { sessionId: options.target.parentSessionId, method: "Page.frameNavigated", params: frameEvents.navigated })
  }
}

export function replayChildFrameNavigation(options: { readonly socket: Pick<WebSocket, "send">; readonly registry: TargetRegistry; readonly target: ChildTarget }): void {
  const navigationParams = childFrameNavigationParams({ registry: options.registry, target: options.target })
  if (!navigationParams) {
    return
  }
  // Stock Playwright does not apply Page.getFrameTree to child iframe sessions;
  // replay the current navigation on the child session so reconnects do not
  // leave OOPIF frames with an empty URL.
  sendCdpEvent(options.socket, { sessionId: options.target.sessionId, method: "Page.frameNavigated", params: navigationParams })
}

function childFrameNavigationParams(options: { readonly registry: TargetRegistry; readonly target: ChildTarget }): JsonObject | undefined {
  if (options.target.targetInfo.type !== "iframe") {
    return undefined
  }
  const frameEvents = options.registry.findFrameEventsForChild(options.target)
  const navigated = frameEvents?.navigated
  const frame = getObject(navigated?.frame)
  if (navigated && frame) {
    return {
      ...navigated,
      frame: {
        ...frame,
        id: options.target.targetInfo.targetId,
        url: options.target.targetInfo.url || (getString(frame, "url") ?? ""),
        ...(options.target.targetInfo.parentFrameId ? { parentId: options.target.targetInfo.parentFrameId } : {}),
      },
    }
  }
  if (!options.target.targetInfo.url) {
    return undefined
  }
  const gatedAPIFeatures: string[] = []
  return {
    frame: {
      id: options.target.targetInfo.targetId,
      loaderId: options.target.targetInfo.targetId,
      url: options.target.targetInfo.url,
      domainAndRegistry: "",
      securityOrigin: new URL(options.target.targetInfo.url).origin,
      mimeType: "text/html",
      adFrameStatus: { adFrameType: "none" },
      secureContextType: "Secure",
      crossOriginIsolatedContextType: "NotIsolated",
      gatedAPIFeatures,
      ...(options.target.targetInfo.parentFrameId ? { parentId: options.target.targetInfo.parentFrameId } : {}),
    },
  }
}

export function replayTargetCreated(options: { readonly socket: Pick<WebSocket, "send">; readonly targetInfos: readonly TargetInfo[] }): void {
  for (const targetInfo of options.targetInfos) {
    sendCdpEvent(options.socket, { method: "Target.targetCreated", params: { targetInfo } })
  }
}
