import { describe, expect, test } from "bun:test"
import {
  describePeer,
  formatPeerMessage,
  resolveMessageTargets,
  resolvePeers,
  resolveTarget,
  type Peer,
  type ResolveInput,
} from "@/session/peers"

const DIR = "/repo"
const NOW = 1_000_000

function session(id: string, over: Partial<ResolveInput["sessions"][number]> = {}) {
  return {
    id,
    directory: DIR,
    title: `session ${id}`,
    updatedAt: NOW - 5_000,
    ...over,
  }
}

function baseInput(over: Partial<ResolveInput> = {}): ResolveInput {
  return {
    sessions: [],
    statuses: new Map(),
    pendingPermission: new Set(),
    loops: [],
    callerID: "me",
    directory: DIR,
    now: NOW,
    ...over,
  }
}

function resolve(over: Partial<ResolveInput> = {}) {
  return resolvePeers(baseInput(over))
}

function resolveMsg(over: Partial<ResolveInput> = {}) {
  return resolveMessageTargets(baseInput(over))
}

describe("resolvePeers", () => {
  test("a busy session in the same directory is a peer", () => {
    const peers = resolve({
      sessions: [session("me"), session("other", { title: "Merge five specsync worktrees into main" })],
      statuses: new Map([["other", { type: "busy" }]]),
    })
    expect(peers).toHaveLength(1)
    expect(peers[0].sessionID).toBe("other")
    expect(peers[0].title).toBe("Merge five specsync worktrees into main")
    expect(peers[0].status).toBe("busy")
  })

  test("a quiet repo returns nothing", () => {
    const peers = resolve({ sessions: [session("me"), session("other")] })
    expect(peers).toEqual([])
  })

  // A directory accumulates abandoned sessions. A warning that fires on every
  // one of them is a warning nobody reads.
  test("an idle session is not a peer", () => {
    const peers = resolve({
      sessions: [session("me"), session("stale", { updatedAt: NOW - 86_400_000 })],
      statuses: new Map([["stale", { type: "idle" }]]),
    })
    expect(peers).toEqual([])
  })

  test("a session waiting on permission is a peer, distinguishably", () => {
    const peers = resolve({
      sessions: [session("me"), session("blocked")],
      statuses: new Map([["blocked", { type: "idle" }]]),
      pendingPermission: new Set(["blocked"]),
    })
    expect(peers).toHaveLength(1)
    expect(peers[0].status).toBe("awaiting-permission")
  })

  test("a session in another directory is not a peer", () => {
    const peers = resolve({
      sessions: [session("me"), session("elsewhere", { directory: "/other-repo" })],
      statuses: new Map([["elsewhere", { type: "busy" }]]),
    })
    expect(peers).toEqual([])
  })

  test("the caller is not its own peer", () => {
    const peers = resolve({
      sessions: [session("me")],
      statuses: new Map([["me", { type: "busy" }]]),
    })
    expect(peers).toEqual([])
  })

  // Otherwise every fan-out reads as a collision, and the signal is loudest
  // exactly when the run is doing the right thing.
  test("the caller's own subagents are not peers, at any depth", () => {
    const peers = resolve({
      sessions: [
        session("me"),
        session("reviewer", { parentID: "me" }),
        session("reviewers-helper", { parentID: "reviewer" }),
      ],
      statuses: new Map([
        ["reviewer", { type: "busy" }],
        ["reviewers-helper", { type: "busy" }],
      ]),
    })
    expect(peers).toEqual([])
  })

  test("another lineage's subagent is still a peer", () => {
    const peers = resolve({
      sessions: [session("me"), session("sibling"), session("their-coder", { parentID: "sibling" })],
      statuses: new Map([["their-coder", { type: "busy" }]]),
    })
    expect(peers.map((peer) => peer.sessionID)).toEqual(["their-coder"])
  })

  test("a session driven by a live loop counts even between turns", () => {
    const peers = resolve({
      sessions: [session("me"), session("auto", { title: "auto: openspec backlog" })],
      statuses: new Map([["auto", { type: "idle" }]]),
      loops: [{ id: "loop_1", sessionID: "auto", status: "running", iteration: 7 }],
    })
    expect(peers).toHaveLength(1)
    expect(peers[0].loopID).toBe("loop_1")
    expect(peers[0].loopIteration).toBe(7)
  })

  test("a finished loop does not keep a session alive", () => {
    const peers = resolve({
      sessions: [session("me"), session("done")],
      statuses: new Map([["done", { type: "idle" }]]),
      loops: [{ id: "loop_1", sessionID: "done", status: "completed", iteration: 3 }],
    })
    expect(peers).toEqual([])
  })

  test("what needs attention sorts above what is merely working", () => {
    const peers = resolve({
      sessions: [session("me"), session("busy"), session("blocked"), session("stuck")],
      statuses: new Map([
        ["busy", { type: "busy" }],
        ["blocked", { type: "busy" }],
        ["stuck", { type: "busy" }],
      ]),
      pendingPermission: new Set(["blocked"]),
      loops: [{ id: "loop_1", sessionID: "stuck", status: "stalled", iteration: 2 }],
    })
    expect(peers.map((peer) => peer.sessionID)).toEqual(["stuck", "blocked", "busy"])
  })

  // Cycles cannot happen through the API, but an inconsistent store must not
  // hang the resolver — a peers lookup runs on every queue iteration.
  test("a parent cycle terminates", () => {
    const peers = resolve({
      sessions: [session("me"), session("a", { parentID: "b" }), session("b", { parentID: "a" })],
      statuses: new Map([
        ["a", { type: "busy" }],
        ["b", { type: "busy" }],
      ]),
    })
    expect(peers.map((peer) => peer.sessionID).sort()).toEqual(["a", "b"])
  })
})

describe("resolveMessageTargets", () => {
  test("an idle session IS a valid message target, unlike resolvePeers", () => {
    const input = {
      sessions: [session("me"), session("idle-friend")],
      statuses: new Map([["idle-friend", { type: "idle" as const }]]),
    }
    expect(resolve(input)).toEqual([])
    const targets = resolveMsg(input)
    expect(targets).toHaveLength(1)
    expect(targets[0].sessionID).toBe("idle-friend")
    expect(targets[0].status).toBe("idle")
  })

  test("still excludes the caller and its descendants", () => {
    const targets = resolveMsg({
      sessions: [session("me"), session("my-subagent", { parentID: "me" })],
      statuses: new Map([["my-subagent", { type: "idle" as const }]]),
    })
    expect(targets).toEqual([])
  })

  test("still scoped to the same directory", () => {
    const targets = resolveMsg({
      sessions: [session("me"), session("elsewhere", { directory: "/other-repo" })],
      statuses: new Map([["elsewhere", { type: "idle" as const }]]),
    })
    expect(targets).toEqual([])
  })
})

function peer(sessionID: string, title: string, over: Partial<Peer> = {}): Peer {
  return { sessionID, title, status: "busy", idleForMs: 0, ...over }
}

describe("resolveTarget", () => {
  test("resolves by exact session id", () => {
    const peers = [peer("a", "Alpha work"), peer("b", "Beta work")]
    const result = resolveTarget(peers, "b")
    expect(result).toEqual({ ok: true, peer: peers[1] })
  })

  test("resolves by an unambiguous title prefix", () => {
    const peers = [peer("a", "Alpha work"), peer("b", "Beta work")]
    const result = resolveTarget(peers, "beta")
    expect(result).toEqual({ ok: true, peer: peers[1] })
  })

  test("refuses an ambiguous title prefix rather than guessing", () => {
    const peers = [peer("a", "Merge worktrees into main"), peer("b", "Merge specsync worktrees")]
    const result = resolveTarget(peers, "merge")
    expect(result.ok).toBe(false)
    if (!result.ok && result.reason === "ambiguous") {
      expect(result.matches.map((p) => p.sessionID).sort()).toEqual(["a", "b"])
    } else {
      throw new Error("expected an ambiguous result")
    }
  })

  test("reports not-found for no match", () => {
    const result = resolveTarget([peer("a", "Alpha work")], "nonexistent")
    expect(result).toEqual({ ok: false, reason: "not-found" })
  })

  test("an id that is also a title-prefix collision still resolves by id", () => {
    // Exact session-id match short-circuits before title matching, so an id
    // that happens to prefix-match another peer's title is not ambiguous.
    const peers = [peer("alpha", "Alpha work"), peer("b", "alpha-adjacent task")]
    const result = resolveTarget(peers, "alpha")
    expect(result).toEqual({ ok: true, peer: peers[0] })
  })
})

describe("formatPeerMessage", () => {
  test("carries sender provenance separate from the message text", () => {
    const text = formatPeerMessage({ sessionID: "ses_1", title: "Finishing specsync" }, "please review commit abc")
    expect(text).toContain("ses_1")
    expect(text).toContain("Finishing specsync")
    expect(text).toContain("please review commit abc")
    expect(text).toContain("not a user")
  })
})

describe("describePeer", () => {
  test("names the session, its title, and what is driving it", () => {
    const line = describePeer({
      sessionID: "ses_1",
      title: "Finishing specsync and merging worktrees",
      status: "busy",
      agent: "build",
      provider: "local",
      model: "qwen3-coder",
      loopID: "loop_1",
      loopIteration: 4,
      idleForMs: 90_000,
    })
    expect(line).toContain("ses_1")
    expect(line).toContain("Finishing specsync and merging worktrees")
    expect(line).toContain("busy")
    expect(line).toContain("iteration 4")
    expect(line).toContain("2m ago")
  })
})
