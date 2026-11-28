import type { Cdp } from "./cdp"
import { agentDriven, type TabActivity } from "./policy"

// window.print() opens the system print dialog, which only a person can close, and the page's script waits until then.
// On a tab the agent drives nobody may be watching, so there print() returns at once without a dialog. A person's own
// tab still prints. Like the passkey refusal, this outlives a person taking the tab over.
const REFUSE = `Object.defineProperty(globalThis, "print", { value: function print() {}, writable: true, configurable: true })`

export function guardPrint(cdp: Cdp, activity: Readonly<TabActivity>) {
  // Each attached session, and the refusal sent to it once the tab is agent-driven.
  const sessions = new Map<string | undefined, Promise<void> | undefined>()

  function refuse(sessionID: string | undefined) {
    const sent =
      sessions.get(sessionID) ??
      cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: REFUSE, runImmediately: true }, sessionID).then(() => undefined)

    sessions.set(sessionID, sent)

    return sent
  }

  function update() {
    if (!agentDriven(activity)) return Promise.resolve()

    return Promise.all(Array.from(sessions.keys(), refuse)).then(() => undefined)
  }

  return {
    attach: (sessionID?: string) => {
      sessions.set(sessionID, undefined)

      return update()
    },
    detach: (sessionID: string) => sessions.delete(sessionID),
    update,
  }
}
