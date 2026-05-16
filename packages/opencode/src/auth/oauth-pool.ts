import {
  loadStoreFile,
  updateStore,
  updateStoreBestEffort,
  findOAuthRecord,
  recordIDsForNamespace,
  toMeta,
  type OAuthRecordMeta,
} from "./store"

export namespace OAuthPool {
  export async function snapshot(
    providerID: string,
    namespace = "default",
  ): Promise<{ records: OAuthRecordMeta[]; orderedIDs: string[]; activeID?: string }> {
    const store = await loadStoreFile()
    const provider = store.providers[providerID]
    if (!provider || provider.type !== "oauth") return { records: [], orderedIDs: [] }

    const normalized = namespace.trim() || "default"
    const records = provider.records.filter((r) => r.namespace === normalized).map(toMeta)
    const orderedIDs = recordIDsForNamespace(provider, normalized)
    const activeID = provider.active[normalized]

    return { records, orderedIDs, activeID }
  }

  export async function list(providerID: string, namespace = "default"): Promise<OAuthRecordMeta[]> {
    return snapshot(providerID, namespace).then((r) => r.records)
  }

  export async function orderedIDs(providerID: string, namespace = "default"): Promise<string[]> {
    return snapshot(providerID, namespace).then((r) => r.orderedIDs)
  }

  export async function moveToBack(providerID: string, namespace: string, recordID: string): Promise<void> {
    await updateStoreBestEffort((store) => {
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return { value: undefined, changed: false }
      const order = recordIDsForNamespace(provider, namespace)
      provider.order[namespace] = order.filter((id) => id !== recordID).concat(recordID)
      provider.active[namespace] = provider.order[namespace][0] ?? provider.active[namespace]
      return { value: undefined, changed: true }
    })
  }

  export async function recordOutcome(input: {
    providerID: string
    recordID: string
    statusCode: number
    ok: boolean
    cooldownUntil?: number
  }): Promise<void> {
    await updateStoreBestEffort((store) => {
      const provider = store.providers[input.providerID]
      if (!provider || provider.type !== "oauth") return { value: undefined, changed: false }

      const record = findOAuthRecord(provider, input.recordID)
      if (!record) return { value: undefined, changed: false }

      const now = Date.now()
      const prevCooldown =
        record.health.cooldownUntil && record.health.cooldownUntil > now ? record.health.cooldownUntil : undefined
      const cooldownUntil = input.ok ? undefined : (input.cooldownUntil ?? prevCooldown)

      record.health = {
        ...record.health,
        cooldownUntil,
        lastStatusCode: input.statusCode,
        lastErrorAt: input.ok ? undefined : now,
        successCount: record.health.successCount + (input.ok ? 1 : 0),
        failureCount: record.health.failureCount + (input.ok ? 0 : 1),
      }
      record.updatedAt = now
      return { value: undefined, changed: true }
    })
  }

  export async function markAccessExpired(providerID: string, namespace: string, recordID: string): Promise<void> {
    await updateStoreBestEffort((store) => {
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return { value: undefined, changed: false }
      const record = findOAuthRecord(provider, recordID)
      if (!record || record.namespace !== namespace) return { value: undefined, changed: false }
      record.access = ""
      record.expires = 0
      record.updatedAt = Date.now()
      return { value: undefined, changed: true }
    })
  }

  export async function getUsage(
    providerID: string,
    namespace = "default",
  ): Promise<
    Array<{
      id: string
      label?: string
      isActive: boolean
      health: {
        successCount: number
        failureCount: number
        lastStatusCode?: number
        cooldownUntil?: number
      }
    }>
  > {
    const store = await loadStoreFile()
    const provider = store.providers[providerID]
    if (!provider || provider.type !== "oauth") return []

    const ordered = recordIDsForNamespace(provider, namespace)
    const now = Date.now()
    const activeID =
      provider.active[namespace] ??
      ordered.find((id) => {
        const rec = provider.records.find((r) => r.id === id)
        return !rec?.health.cooldownUntil || rec.health.cooldownUntil <= now
      }) ??
      ordered[0]

    return provider.records
      .filter((r) => r.namespace === namespace)
      .map((r) => ({
        id: r.id,
        label: r.label,
        isActive: r.id === activeID,
        health: {
          successCount: r.health.successCount,
          failureCount: r.health.failureCount,
          lastStatusCode: r.health.lastStatusCode,
          cooldownUntil: r.health.cooldownUntil,
        },
      }))
  }

  export async function setActive(providerID: string, namespace: string, recordID: string): Promise<boolean> {
    return updateStore((store) => {
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return { value: false, changed: false }

      const record = findOAuthRecord(provider, recordID)
      if (!record || record.namespace !== namespace) return { value: false, changed: false }

      const order = recordIDsForNamespace(provider, namespace)
      provider.order[namespace] = [recordID, ...order.filter((id) => id !== recordID)]
      provider.active[namespace] = recordID

      return { value: true, changed: true }
    })
  }

  export async function updateRecord(
    providerID: string,
    recordID: string,
    namespace: string,
    update: { access?: string; refresh?: string; expires?: number; label?: string },
  ): Promise<boolean> {
    return updateStore((store) => {
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return { value: false, changed: false }

      const record = provider.records.find((r) => r.id === recordID && r.namespace === namespace)
      if (!record) return { value: false, changed: false }

      if (update.access !== undefined) record.access = update.access
      if (update.refresh !== undefined) record.refresh = update.refresh
      if (update.expires !== undefined) record.expires = update.expires
      if (update.label !== undefined) record.label = update.label
      record.updatedAt = Date.now()

      return { value: true, changed: true }
    })
  }

  export async function removeRecord(
    providerID: string,
    recordID: string,
    namespace = "default",
  ): Promise<{ removed: boolean; remaining: number }> {
    return updateStore<{ removed: boolean; remaining: number }>((store) => {
      const provider = store.providers[providerID]
      if (!provider || provider.type !== "oauth") return { value: { removed: false, remaining: 0 }, changed: false }

      const index = provider.records.findIndex((r) => r.id === recordID && r.namespace === namespace)
      if (index === -1) return { value: { removed: false, remaining: provider.records.length }, changed: false }

      provider.records.splice(index, 1)

      const order = provider.order[namespace] ?? []
      provider.order[namespace] = order.filter((id) => id !== recordID)

      if (provider.active[namespace] === recordID) {
        const remaining = recordIDsForNamespace(provider, namespace)
        provider.active[namespace] = remaining[0]
      }

      const remaining = provider.records.filter((r) => r.namespace === namespace).length
      if (remaining === 0) {
        delete provider.order[namespace]
        delete provider.active[namespace]
      }

      if (provider.records.length === 0) {
        delete store.providers[providerID]
      }

      return { value: { removed: true, remaining }, changed: true }
    })
  }

  export async function fetchAnthropicUsage(
    providerID: string,
    namespace = "default",
    recordID?: string,
  ): Promise<{
    fiveHour?: { utilization: number; resetsAt?: string }
    sevenDay?: { utilization: number; resetsAt?: string }
    sevenDaySonnet?: { utilization: number; resetsAt?: string }
  } | null> {
    if (providerID !== "anthropic") return null

    const store = await loadStoreFile()
    const provider = store.providers[providerID]
    if (!provider || provider.type !== "oauth") return null

    const ordered = recordIDsForNamespace(provider, namespace)
    const now = Date.now()
    const activeID =
      recordID ??
      provider.active[namespace] ??
      ordered.find((id) => {
        const rec = provider.records.find((r) => r.id === id)
        return !rec?.health.cooldownUntil || rec.health.cooldownUntil <= now
      }) ??
      ordered[0]
    const record = provider.records.find((r) => r.id === activeID && r.namespace === namespace)
    if (!record?.access) return null

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
      const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${record.access}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
        signal: controller.signal,
      })

      if (!response.ok) return null

      const data = (await response.json()) as {
        five_hour?: { utilization: number; resets_at?: string }
        seven_day?: { utilization: number; resets_at?: string }
        seven_day_sonnet?: { utilization: number; resets_at?: string }
      }

      return {
        fiveHour: data.five_hour
          ? { utilization: Math.round(data.five_hour.utilization), resetsAt: data.five_hour.resets_at }
          : undefined,
        sevenDay: data.seven_day
          ? { utilization: Math.round(data.seven_day.utilization), resetsAt: data.seven_day.resets_at }
          : undefined,
        sevenDaySonnet: data.seven_day_sonnet
          ? { utilization: Math.round(data.seven_day_sonnet.utilization), resetsAt: data.seven_day_sonnet.resets_at }
          : undefined,
      }
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }
}
