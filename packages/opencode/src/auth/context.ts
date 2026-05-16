import { AsyncLocalStorage } from "node:async_hooks"

type Store = {
  oauthRecordByProvider: Map<string, string>
  sessionID?: string
}

const storage = new AsyncLocalStorage<Store>()

export function getOAuthRecordID(providerID: string): string | undefined {
  return storage.getStore()?.oauthRecordByProvider.get(providerID)
}

export function getSessionID(): string | undefined {
  return storage.getStore()?.sessionID
}

export function withSessionID<T>(sessionID: string, fn: () => T): T {
  const current = storage.getStore()
  return storage.run(
    {
      oauthRecordByProvider: new Map(current?.oauthRecordByProvider ?? []),
      sessionID,
    },
    fn,
  )
}

export function withOAuthRecord<T>(providerID: string, recordID: string, fn: () => T): T {
  const current = storage.getStore()
  const next: Store = {
    oauthRecordByProvider: new Map(current?.oauthRecordByProvider ?? []),
    sessionID: current?.sessionID,
  }
  next.oauthRecordByProvider.set(providerID, recordID)

  return storage.run(next, fn)
}
