export * as DebuggerHub from "./debugger-hub"

// One chrome.debugger attachment per tab, shared by everything in this extension that drives tabs:
// opencode sessions (browser.* tools) and the Browser Control relay. Chrome allows a single attachment
// per extension per tab, so each user registers as an owner and the tab detaches when the last one leaves.

const owners = new Map<number, Set<string>>()
const pending = new Map<number, Promise<void>>()
const RELAY_KEY = "browserControlAttached"

/** Attaches `owner` to the tab, attaching the debugger only for the first owner. */
export async function attach(tabId: number, owner: string) {
  const current = owners.get(tabId)
  if (current?.size) {
    current.add(owner)
    return
  }
  const inflight = pending.get(tabId)
  if (inflight) {
    await inflight
    owners.get(tabId)?.add(owner)
    return
  }
  const attaching = chrome.debugger
    .attach({ tabId }, "1.3")
    .catch(async (error: unknown) => {
      // After a service worker restart this extension's earlier attachment survives; probing proves it.
      if (!/already attached/i.test(message(error)) || !(await ownedByUs(tabId)))
        throw new Error(
          /already attached/i.test(message(error))
            ? "Another debugger (DevTools or another extension) is attached to this tab. Ask the user to close it, then retry."
            : `Could not attach to this tab: ${message(error)}`,
        )
    })
    .then(() => {
      owners.set(tabId, new Set([...(owners.get(tabId) ?? []), owner]))
    })
    .finally(() => pending.delete(tabId))
  pending.set(tabId, attaching)
  await attaching
  void persist()
}

/** Removes `owner`; the debugger detaches once no owner remains. */
export async function detach(tabId: number, owner: string) {
  const current = owners.get(tabId)
  current?.delete(owner)
  void persist()
  if (current?.size) return
  owners.delete(tabId)
  await chrome.debugger.detach({ tabId }).catch(() => undefined)
}

export function isOwner(tabId: number, owner: string) {
  return owners.get(tabId)?.has(owner) ?? false
}

export function tabsOwnedBy(owner: string) {
  return Array.from(owners, ([tabId, set]) => (set.has(owner) ? tabId : undefined)).filter(
    (tabId): tabId is number => tabId !== undefined,
  )
}

/**
 * Restores relay ownership after a service worker restart: Chrome keeps the attachments, the worker's
 * memory does not. Opencode pages re-register on their next command.
 */
export async function restore() {
  const stored = ((await chrome.storage.session.get(RELAY_KEY))[RELAY_KEY] ?? []) as number[]
  await Promise.all(
    stored.map(async (tabId) => {
      if (!(await ownedByUs(tabId))) return
      owners.set(tabId, new Set([...(owners.get(tabId) ?? []), "relay"]))
    }),
  )
}

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === undefined) return
  owners.delete(source.tabId)
  void persist()
})

function persist() {
  return chrome.storage.session.set({ [RELAY_KEY]: tabsOwnedBy("relay") }).catch(() => undefined)
}

/** Chrome's attached flag includes DevTools and other extensions; a command only succeeds for ours. */
async function ownedByUs(tabId: number) {
  return chrome.debugger.sendCommand({ tabId }, "Target.getTargetInfo").then(
    () => true,
    () => false,
  )
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
