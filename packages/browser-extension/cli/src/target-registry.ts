import { Schema } from "effect"
import { isJsonObject, type JsonObject, type TargetInfo } from "./protocol.ts"
import type { ChildTarget, ConnectedTarget, StoredFrameEvents } from "./relay-types.ts"

export type TargetOwnershipReservation = {
  readonly targetId: string
  readonly targetSessionId: string
  readonly tabId: number
  readonly sessionId: string
  readonly previousOpenCodeBrowserSessionId?: string
}

export type TargetOwnershipChange = {
  readonly targetIds: readonly string[]
  readonly tabIds: readonly number[]
}

export interface TargetOwnership {
  reserveTargetOwnership(targetId: string, sessionId: string): TargetOwnershipReservation
  rollbackTargetOwnership(reservation: TargetOwnershipReservation): TargetOwnershipChange
  commitTargetOwnership(options: {
    readonly reservation: TargetOwnershipReservation
    readonly previousAdoptedTargetId?: string
  }): TargetOwnershipChange
  releaseTargetOwnership(targetId: string, sessionId: string): TargetOwnershipChange
}

export class TargetOwnershipError extends Schema.TaggedError<TargetOwnershipError>()(
  "TargetRegistry.TargetOwnershipError",
  {
    message: Schema.String,
    reason: Schema.Literals(["not-found", "owned", "generation-changed"]),
    ownerSessionId: Schema.optionalKey(Schema.String),
  },
) {}

export class MemoryTargetOwnership implements TargetOwnership {
  private readonly owners = new Map<string, string>()

  reserveTargetOwnership(targetId: string, sessionId: string): TargetOwnershipReservation {
    const owner = this.owners.get(targetId)
    if (owner && owner !== sessionId) {
      throw targetOwnedError(owner)
    }
    this.owners.set(targetId, sessionId)
    return {
      targetId,
      targetSessionId: targetId,
      tabId: -1,
      sessionId,
      ...(owner ? { previousOpenCodeBrowserSessionId: owner } : {}),
    }
  }

  rollbackTargetOwnership(reservation: TargetOwnershipReservation): TargetOwnershipChange {
    if (this.owners.get(reservation.targetId) !== reservation.sessionId) {
      return emptyOwnershipChange
    }
    if (reservation.previousOpenCodeBrowserSessionId) {
      this.owners.set(reservation.targetId, reservation.previousOpenCodeBrowserSessionId)
    } else {
      this.owners.delete(reservation.targetId)
    }
    return ownershipChange(reservation.targetId, reservation.tabId)
  }

  commitTargetOwnership(options: {
    readonly reservation: TargetOwnershipReservation
    readonly previousAdoptedTargetId?: string
  }): TargetOwnershipChange {
    const changed = [options.reservation.targetId]
    if (options.previousAdoptedTargetId && options.previousAdoptedTargetId !== options.reservation.targetId) {
      if (this.owners.get(options.previousAdoptedTargetId) === options.reservation.sessionId) {
        this.owners.delete(options.previousAdoptedTargetId)
        changed.push(options.previousAdoptedTargetId)
      }
    }
    return { targetIds: changed, tabIds: [] }
  }

  releaseTargetOwnership(targetId: string, sessionId: string): TargetOwnershipChange {
    if (this.owners.get(targetId) !== sessionId) {
      return emptyOwnershipChange
    }
    this.owners.delete(targetId)
    return { targetIds: [targetId], tabIds: [] }
  }
}

export type ConnectedTargetInfoUpdate =
  | { readonly kind: "root"; readonly target: ConnectedTarget }
  | { readonly kind: "child"; readonly target: ChildTarget }

export type RootTargetChange =
  | { readonly kind: "added" | "updated"; readonly target: ConnectedTarget }
  | {
      readonly kind: "replaced"
      readonly target: ConnectedTarget
      readonly previous: ConnectedTarget
      readonly childSessionIds: readonly string[]
    }

export function shouldExposeChildTarget(target: ChildTarget): boolean {
  return target.targetInfo.type !== "page" || target.targetInfo.url !== ""
}

export class TargetRegistry {
  readonly targets = new Map<string, ConnectedTarget>()
  readonly tabTargets = new Map<number, ConnectedTarget>()
  readonly targetsByTargetId = new Map<string, ConnectedTarget>()
  readonly childTargets = new Map<string, ChildTarget>()
  readonly childTargetsByTargetId = new Map<string, ChildTarget>()
  readonly tabFrameEvents = new Map<number, Map<string, StoredFrameEvents>>()
  private readonly pendingOwnershipReservations = new Map<string, TargetOwnershipReservation>()
  private readonly stagedRootTargets = new Map<number, ConnectedTarget>()

  clear(): void {
    this.targets.clear()
    this.tabTargets.clear()
    this.targetsByTargetId.clear()
    this.childTargets.clear()
    this.childTargetsByTargetId.clear()
    this.tabFrameEvents.clear()
    this.pendingOwnershipReservations.clear()
    this.stagedRootTargets.clear()
  }

  addRootTarget(target: ConnectedTarget, options: {
    readonly preserveChildParentSessionId?: string
    readonly preserveFrameEvents?: boolean
  } = {}): RootTargetChange {
    const existingForTab = this.tabTargets.get(target.tabId)
    const generationChanged = existingForTab !== undefined && (
      existingForTab.sessionId !== target.sessionId ||
      existingForTab.targetInfo.targetId !== target.targetInfo.targetId
    )
    const nextTarget = generationChanged ? this.inheritRootOwnership(target, existingForTab) : target
    const detached = generationChanged
      ? this.detachRootTargetState(target.tabId, options)
      : undefined
    const childSessionIds = detached?.childSessionIds ?? []
    if (existingForTab && !generationChanged) {
      this.targets.delete(existingForTab.sessionId)
      this.targetsByTargetId.delete(existingForTab.targetInfo.targetId)
    }
    const existingForTargetId = this.targetsByTargetId.get(nextTarget.targetInfo.targetId)
    if (existingForTargetId) {
      this.targets.delete(existingForTargetId.sessionId)
      this.tabTargets.delete(existingForTargetId.tabId)
    }
    this.targets.set(nextTarget.sessionId, nextTarget)
    this.tabTargets.set(nextTarget.tabId, nextTarget)
    this.targetsByTargetId.set(nextTarget.targetInfo.targetId, nextTarget)
    return generationChanged
      ? { kind: "replaced", target: nextTarget, previous: existingForTab, childSessionIds }
      : { kind: existingForTab ? "updated" : "added", target: nextTarget }
  }

  stageRootTarget(target: ConnectedTarget): ConnectedTarget {
    const existing = this.tabTargets.get(target.tabId)
    const staged = existing ? this.inheritRootOwnership(target, existing) : target
    this.stagedRootTargets.set(target.tabId, staged)
    this.tabFrameEvents.delete(target.tabId)
    return staged
  }

  private inheritRootOwnership(target: ConnectedTarget, existing: ConnectedTarget): ConnectedTarget {
    const pendingReservation = this.pendingOwnershipReservations.get(existing.targetInfo.targetId)
    const inheritedOpenCodeBrowserSessionId = pendingReservation
      ? pendingReservation.previousOpenCodeBrowserSessionId
      : existing.opencodeBrowserSessionId
    const { opencodeBrowserSessionId: _incomingOwner, ...targetWithoutOwner } = target
    return {
      ...targetWithoutOwner,
      owner: existing.owner,
      ...(inheritedOpenCodeBrowserSessionId ? { opencodeBrowserSessionId: inheritedOpenCodeBrowserSessionId } : {}),
    }
  }

  stagedRootTarget(tabId: number): ConnectedTarget | undefined {
    return this.stagedRootTargets.get(tabId)
  }

  routingRootTarget(tabId: number): ConnectedTarget | undefined {
    return this.stagedRootTargets.get(tabId) ?? this.tabTargets.get(tabId)
  }

  commitStagedRootTarget(tabId: number, sessionId: string): RootTargetChange | undefined {
    const staged = this.stagedRootTargets.get(tabId)
    if (!staged || staged.sessionId !== sessionId) return undefined
    this.stagedRootTargets.delete(tabId)
    return this.addRootTarget(staged, {
      preserveChildParentSessionId: staged.sessionId,
      preserveFrameEvents: true,
    })
  }

  addChildTarget(target: ChildTarget): readonly ChildTarget[] {
    const replaced: ChildTarget[] = []
    const existingForSession = this.childTargets.get(target.sessionId)
    if (existingForSession && existingForSession.targetInfo.targetId !== target.targetInfo.targetId) {
      replaced.push(existingForSession)
      this.detachChildTargetState(existingForSession.sessionId)
    }
    const existingForTargetId = this.childTargetsByTargetId.get(target.targetInfo.targetId)
    if (existingForTargetId && existingForTargetId.sessionId !== target.sessionId) {
      replaced.push(existingForTargetId)
      this.detachChildTargetState(existingForTargetId.sessionId)
    }
    this.childTargets.set(target.sessionId, target)
    this.childTargetsByTargetId.set(target.targetInfo.targetId, target)
    return replaced
  }

  rootTargetCount(): number {
    return this.targets.size
  }

  listRootTargets(): ConnectedTarget[] {
    return Array.from(this.targets.values())
  }

  getRootTargetByTabId(tabId: number): ConnectedTarget | undefined {
    return this.tabTargets.get(tabId)
  }

  getRootTargetBySessionId(sessionId: string): ConnectedTarget | undefined {
    return this.targets.get(sessionId) ?? this.listRootTargets().find((target) => {
      return target.opencodeBrowserSessionId === sessionId
    })
  }

  reserveTargetOwnership(targetId: string, sessionId: string): TargetOwnershipReservation {
    const target = this.targetsByTargetId.get(targetId)
    if (!target) {
      throw new TargetOwnershipError({ reason: "not-found", message: `Target detached before adoption: ${targetId}` })
    }
    const owner = target.opencodeBrowserSessionId
    if (owner && owner !== sessionId) {
      throw targetOwnedError(owner)
    }
    this.addRootTarget({ ...target, opencodeBrowserSessionId: sessionId })
    const reservation = {
      targetId,
      targetSessionId: target.sessionId,
      tabId: target.tabId,
      sessionId,
      ...(owner ? { previousOpenCodeBrowserSessionId: owner } : {}),
    }
    this.pendingOwnershipReservations.set(targetId, reservation)
    return reservation
  }

  rollbackTargetOwnership(reservation: TargetOwnershipReservation): TargetOwnershipChange {
    this.pendingOwnershipReservations.delete(reservation.targetId)
    const target = this.targetsByTargetId.get(reservation.targetId)
    if (!target || target.sessionId !== reservation.targetSessionId || target.opencodeBrowserSessionId !== reservation.sessionId) {
      return emptyOwnershipChange
    }
    const { opencodeBrowserSessionId: _owner, ...unowned } = target
    this.addRootTarget(reservation.previousOpenCodeBrowserSessionId
      ? { ...unowned, opencodeBrowserSessionId: reservation.previousOpenCodeBrowserSessionId }
      : unowned)
    return ownershipChange(target.targetInfo.targetId, target.tabId)
  }

  commitTargetOwnership(options: {
    readonly reservation: TargetOwnershipReservation
    readonly previousAdoptedTargetId?: string
  }): TargetOwnershipChange {
    this.pendingOwnershipReservations.delete(options.reservation.targetId)
    const target = this.targetsByTargetId.get(options.reservation.targetId)
    if (!target || target.sessionId !== options.reservation.targetSessionId || target.opencodeBrowserSessionId !== options.reservation.sessionId) {
      throw new TargetOwnershipError({
        reason: "generation-changed",
        message: `Target detached or changed during adoption: ${options.reservation.targetId}`,
      })
    }
    const targetIds = [target.targetInfo.targetId]
    const tabIds = [target.tabId]
    if (options.previousAdoptedTargetId && options.previousAdoptedTargetId !== target.targetInfo.targetId) {
      const released = this.releaseTargetOwnership(options.previousAdoptedTargetId, options.reservation.sessionId)
      targetIds.push(...released.targetIds)
      tabIds.push(...released.tabIds)
    }
    return { targetIds: Array.from(new Set(targetIds)), tabIds: Array.from(new Set(tabIds)) }
  }

  releaseTargetOwnership(targetId: string, sessionId: string): TargetOwnershipChange {
    const target = this.targetsByTargetId.get(targetId)
    if (!target || target.opencodeBrowserSessionId !== sessionId) {
      return emptyOwnershipChange
    }
    const { opencodeBrowserSessionId: _owner, ...released } = target
    this.addRootTarget(released)
    return ownershipChange(target.targetInfo.targetId, target.tabId)
  }

  detachRootTargetState(tabId: number, options: {
    readonly preserveChildParentSessionId?: string
    readonly preserveFrameEvents?: boolean
  } = {}): { readonly target: ConnectedTarget; readonly childSessionIds: string[] } | undefined {
    this.stagedRootTargets.delete(tabId)
    const target = this.tabTargets.get(tabId)
    // Resolve the entire staged subtree before recursive detach mutates the indexes.
    const preservedSessionIds = new Set<string>()
    if (options.preserveChildParentSessionId !== undefined) {
      preservedSessionIds.add(options.preserveChildParentSessionId)
      for (const parentSessionId of preservedSessionIds) {
        for (const child of this.childTargets.values()) {
          if (child.tabId === tabId && child.parentSessionId === parentSessionId) {
            preservedSessionIds.add(child.sessionId)
          }
        }
      }
    }
    const childSessionIds = Array.from(this.childTargets.values())
      .filter((child) => child.tabId === tabId && !preservedSessionIds.has(child.sessionId))
      .map((child) => child.sessionId)
    if (target) {
      this.targets.delete(target.sessionId)
      this.tabTargets.delete(tabId)
      this.targetsByTargetId.delete(target.targetInfo.targetId)
      this.pendingOwnershipReservations.delete(target.targetInfo.targetId)
    }
    if (!options.preserveFrameEvents) this.tabFrameEvents.delete(tabId)
    for (const sessionId of childSessionIds) this.detachChildTargetState(sessionId)
    return target ? { target, childSessionIds } : undefined
  }

  detachChildTargetState(sessionId: string): ChildTarget | undefined {
    const target = this.childTargets.get(sessionId)
    this.childTargets.delete(sessionId)
    if (target) {
      this.childTargetsByTargetId.delete(target.targetInfo.targetId)
    }
    for (const child of this.childTargets.values()) {
      if (child.parentSessionId === sessionId) this.detachChildTargetState(child.sessionId)
    }
    return target
  }

  updateTargetUrl(tabId: number, url: string): void {
    const staged = this.stagedRootTargets.get(tabId)
    if (staged) {
      this.stagedRootTargets.set(tabId, { ...staged, targetInfo: { ...staged.targetInfo, title: url, url }, crashed: false })
      return
    }
    const target = this.tabTargets.get(tabId)
    if (!target) {
      return
    }
    this.addRootTarget({ ...target, targetInfo: { ...target.targetInfo, title: url, url }, crashed: false })
  }

  /** Record or lift a protected-frame debugger block. Returns the target only when its state changed. */
  markRootTargetProtectedUi(tabId: number, protectedUi: boolean): ConnectedTarget | undefined {
    const target = this.tabTargets.get(tabId)
    if (!target || (target.protectedUi === true) === protectedUi) {
      return undefined
    }
    const updated: ConnectedTarget = { ...target, protectedUi }
    this.addRootTarget(updated)
    return updated
  }

  markRootTargetCrashed(tabId: number): ConnectedTarget | undefined {
    const staged = this.stagedRootTargets.get(tabId)
    if (staged) {
      const crashed = { ...staged, crashed: true }
      this.stagedRootTargets.set(tabId, crashed)
      return crashed
    }
    const target = this.tabTargets.get(tabId)
    if (!target) {
      return undefined
    }
    const crashed: ConnectedTarget = { ...target, crashed: true }
    this.addRootTarget(crashed)
    return crashed
  }

  updateConnectedTargetInfo(options: { readonly tabId: number; readonly targetInfo: TargetInfo }): ConnectedTargetInfoUpdate | undefined {
    if (this.childTargetsByTargetId.has(options.targetInfo.targetId)) {
      this.updateChildTargetInfo(options.targetInfo)
      const target = this.childTargetsByTargetId.get(options.targetInfo.targetId)
      return target ? { kind: "child", target } : undefined
    }
    const root = this.stagedRootTargets.get(options.tabId) ?? this.tabTargets.get(options.tabId)
    if (root?.targetInfo.targetId !== options.targetInfo.targetId) {
      return undefined
    }
    this.updateRootTargetInfo(options.tabId, options.targetInfo)
    const target = this.tabTargets.get(options.tabId)
    return target ? { kind: "root", target } : undefined
  }

  updateRootTargetInfo(tabId: number, targetInfo: TargetInfo): void {
    const staged = this.stagedRootTargets.get(tabId)
    if (staged?.targetInfo.targetId === targetInfo.targetId) {
      this.stagedRootTargets.set(tabId, { ...staged, targetInfo })
      return
    }
    const target = this.tabTargets.get(tabId)
    if (!target) {
      return
    }
    const updated: ConnectedTarget = { ...target, targetInfo }
    this.targets.set(updated.sessionId, updated)
    this.tabTargets.set(tabId, updated)
    this.targetsByTargetId.delete(target.targetInfo.targetId)
    this.targetsByTargetId.set(targetInfo.targetId, updated)
  }

  updateChildTargetInfo(targetInfo: TargetInfo): void {
    const target = this.childTargetsByTargetId.get(targetInfo.targetId)
    if (!target) {
      return
    }
    const updated: ChildTarget = { ...target, targetInfo }
    this.childTargets.set(updated.sessionId, updated)
    this.childTargetsByTargetId.delete(target.targetInfo.targetId)
    this.childTargetsByTargetId.set(targetInfo.targetId, updated)
  }

  rememberFrameEvent(options: {
    readonly tabId: number
    readonly frameId: string
    readonly attached?: JsonObject
    readonly navigated?: JsonObject
  }): void {
    const frameEvents = this.tabFrameEvents.get(options.tabId) ?? new Map<string, StoredFrameEvents>()
    const existing = frameEvents.get(options.frameId)
    const attached = options.attached ?? existing?.attached
    const navigated = options.navigated ?? existing?.navigated
    const next: StoredFrameEvents = {
      frameId: options.frameId,
      ...(attached ? { attached } : {}),
      ...(navigated ? { navigated } : {}),
    }
    frameEvents.set(options.frameId, next)
    this.tabFrameEvents.set(options.tabId, frameEvents)
  }

  allTargetInfos(options: {
    readonly isRestrictedTarget: (targetInfo: TargetInfo) => boolean
    readonly isVisibleTarget?: (target: ConnectedTarget | ChildTarget) => boolean
  }): TargetInfo[] {
    return [...this.targets.values(), ...this.childTargets.values()].flatMap((target) => {
      if (!(options.isVisibleTarget?.(target) ?? true)) return []
      if (options.isRestrictedTarget(target.targetInfo)) return []
      return [{ ...target.targetInfo, attached: true }]
    })
  }

  findFrameEventsForChild(target: ChildTarget): StoredFrameEvents | undefined {
    const frameEvents = this.tabFrameEvents.get(target.tabId)
    if (!frameEvents) {
      return undefined
    }
    const exactMatch = frameEvents.get(target.targetInfo.targetId)
    if (exactMatch) {
      return exactMatch
    }
    return Array.from(frameEvents.values()).find((candidate) => {
      const frame = isJsonObject(candidate.navigated?.frame) ? candidate.navigated.frame : undefined
      if (!frame) {
        return false
      }
      const parentMatches = !target.targetInfo.parentFrameId || frame.parentId === target.targetInfo.parentFrameId
      const urlMatches = !target.targetInfo.url || frame.url === target.targetInfo.url
      return parentMatches && urlMatches
    })
  }
}

const emptyOwnershipChange: TargetOwnershipChange = { targetIds: [], tabIds: [] }

function ownershipChange(targetId: string, tabId: number): TargetOwnershipChange {
  return { targetIds: [targetId], tabIds: tabId < 0 ? [] : [tabId] }
}

function targetOwnedError(owner: string): Error {
  return new TargetOwnershipError({
    reason: "owned",
    ownerSessionId: owner,
    message: `Target is already adopted by session ${owner}. Use that session, or reset/delete it to release the tab before adopting it elsewhere.`,
  })
}
