/** Requests this recent count towards the snooze offers. */
export const RECENT_WINDOW = 120_000

/** This many requests from one device, or from this many devices, within `RECENT_WINDOW` offers a snooze. */
export const BUSY_THRESHOLD = 3

/** How long Snooze This Device lasts. */
export const SNOOZE_DEVICE = 60 * 60_000

/** How long Snooze All lasts. */
export const SNOOZE_ALL = 15 * 60_000

/** A device may replace its own waiting request at most this often, so a retry loop cannot make the toast flicker. */
export const REPLACE_INTERVAL = 3_000

/** What to do with a phone's new connection. */
export type Admission = "start" | "replace" | "refuse"

/**
 * Decides which nearby pairing requests reach the user, so a device on a public network cannot flood the desktop with
 * prompts. One request is asked about at a time; every request counts, refused or not, towards offering to snooze
 * the device or everything. A device is its network address: the name a phone sends is only for display, and anyone
 * can send any name.
 */
export function createGate(now: () => number = Date.now) {
  const recent: { device: string; at: number }[] = []
  const snoozed = new Map<string, number>()
  const all = { until: Number.NEGATIVE_INFINITY }

  const prune = () => {
    const cutoff = now() - RECENT_WINDOW

    while (recent.length && recent[0]!.at < cutoff) recent.shift()

    for (const [device, until] of snoozed) if (until <= now()) snoozed.delete(device)
  }

  return {
    /**
     * Records a request from `device` and decides it. `active` is the request being asked about, if any: another
     * device's is never interrupted, and the same device's is replaced only once it has shown a while.
     */
    admit(device: string, active?: { device: string; since: number }): Admission {
      prune()
      recent.push({ device, at: now() })

      if (all.until > now() || snoozed.has(device)) return "refuse"

      if (!active) return "start"

      if (active.device !== device) return "refuse"

      return now() - active.since >= REPLACE_INTERVAL ? "replace" : "refuse"
    },
    /** Which snoozes the prompt for `device` offers: only once requests have been busy enough to need one. */
    offers(device: string) {
      prune()

      return {
        device: recent.filter((request) => request.device === device).length >= BUSY_THRESHOLD,
        all: new Set(recent.map((request) => request.device)).size >= BUSY_THRESHOLD,
      }
    },
    snooze(scope: "device" | "all", device: string) {
      if (scope === "all") all.until = now() + SNOOZE_ALL
      else snoozed.set(device, now() + SNOOZE_DEVICE)
    },
    /** Forgets every snooze and count, as turning discovery off and on again does. */
    clear() {
      recent.length = 0
      snoozed.clear()
      all.until = Number.NEGATIVE_INFINITY
    },
  }
}
