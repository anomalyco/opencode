import { AsyncLocalStorage } from "node:async_hooks"

type Store = {
  oauthRecordByProvider: Map<string, string>
}

const storage = new AsyncLocalStorage<Store>()

export function getOAuthRecordID(providerID: string): string | undefined {
  return storage.getStore()?.oauthRecordByProvider.get(providerID)
}

export function withOAuthRecord<T>(providerID: string, recordID: string, fn: () => T): T {
  const current = storage.getStore()
  const next: Store = {
    oauthRecordByProvider: new Map(current?.oauthRecordByProvider ?? []),
  }
  next.oauthRecordByProvider.set(providerID, recordID)

  return storage.run(next, fn)
}
