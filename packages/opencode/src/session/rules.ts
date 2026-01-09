import { Rules } from "../config/rules"
import { Instance } from "../project/instance"
import { GlobalBus } from "@/bus/global"
import { Log } from "../util/log"
import { Session } from "."
import path from "path"

interface InjectedRule {
  filePath: string
  content: string
  injectedAt: number
  callIDs: Set<string>
}

const injectedRules = new Map<string, Map<string, InjectedRule>>()
const pendingRules = new Map<string, InjectedRule[]>()

export namespace SessionRules {
  const log = Log.create({ service: "session.rules" })

  async function updateSessionRules(sessionID: string) {
    const sessionRules = injectedRules.get(sessionID)
    const paths = sessionRules ? Array.from(sessionRules.keys()) : []
    log.info("updating session rules", { sessionID, count: paths.length })
    await Session.update(sessionID, (draft) => {
      draft.rules = paths
    }).catch((e) => {
      log.error("failed to update session rules", { sessionID, error: e })
    })
  }

  export async function getMatchingRules(filepath: string, sessionID: string, callID?: string): Promise<string[]> {
    const rulesFromPath = await Rules.loadForFile(filepath)

    const sessionRules = injectedRules.get(sessionID) ?? new Map()
    const matchedRules: InjectedRule[] = []

    const matching = rulesFromPath.filter((rule) => {
      if (!rule.paths || rule.paths.length === 0) return true
      const patterns = Rules.matchRulesForFile([rule], filepath)
      return patterns.length > 0
    })

    log.info("matched rules for file", { filepath, count: matching.length })

    let changed = false
    for (const rule of matching) {
      const existing = sessionRules.get(rule.filePath)

      if (existing) {
        if (callID) {
          if (!existing.callIDs.has(callID)) {
            log.debug("linking existing rule to new call", { filePath: rule.filePath, callID })
            existing.callIDs.add(callID)
          }
        }
        continue
      }

      log.info("injecting rule", { filePath: rule.filePath, callID })
      const injected = {
        filePath: rule.filePath,
        content: rule.content,
        injectedAt: Date.now(),
        callIDs: new Set(callID ? [callID] : []),
      }
      sessionRules.set(rule.filePath, injected)
      matchedRules.push(injected)
      changed = true
    }

    injectedRules.set(sessionID, sessionRules)

    if (changed) {
      await updateSessionRules(sessionID)
    }

    if (matchedRules.length > 0) {
      const existing = pendingRules.get(sessionID) ?? []
      for (const rule of matchedRules) {
        if (!existing.some((r) => r.filePath === rule.filePath)) {
          existing.push(rule)
        }
      }
      pendingRules.set(sessionID, existing)
    }

    return matchedRules.map((r) => r.content)
  }

  export async function notifyFileInContext(filepath: string, sessionID: string, callID: string): Promise<string[]> {
    let resolvedPath = filepath
    if (!path.isAbsolute(resolvedPath)) {
      resolvedPath = path.join(Instance.directory, resolvedPath)
    }

    return await getMatchingRules(resolvedPath, sessionID, callID)
  }

  export async function onCallPruned(sessionID: string, callID: string) {
    const sessionRules = injectedRules.get(sessionID)
    if (!sessionRules) return

    let changed = false
    for (const [filePath, rule] of sessionRules.entries()) {
      if (rule.callIDs.delete(callID)) {
        log.debug("removed call from rule", { filePath, callID })
        if (rule.callIDs.size === 0) {
          log.info("pruning rule (no active calls)", { filePath })
          sessionRules.delete(filePath)
          changed = true
        }
      }
    }

    if (changed) {
      await updateSessionRules(sessionID)
    }
  }

  export function consumePendingRules(sessionID: string): InjectedRule[] {
    const rules = pendingRules.get(sessionID) ?? []
    if (rules.length > 0) {
      log.debug("consuming pending rules", { sessionID, count: rules.length })
    }
    pendingRules.delete(sessionID)
    return rules
  }

  export async function clearSessionRules(sessionID: string): Promise<void> {
    log.info("clearing session rules", { sessionID })
    injectedRules.delete(sessionID)
    pendingRules.delete(sessionID)
    await Session.update(sessionID, (draft) => {
      draft.rules = []
    }).catch(() => {})
  }
}

GlobalBus.on("event", (event) => {
  if (event.payload.type === "session.compacted") {
    void SessionRules.clearSessionRules(event.payload.properties.sessionID)
  }
})
