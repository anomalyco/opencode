import { describe, expect, test } from "bun:test"
import { Subagent } from "@/acp/subagent"

const fixture = await Bun.file(`${import.meta.dir}/fixtures/subagents-v1.json`).json()

describe("acp subagent wire contract", () => {
  test("decodes and encodes the version-1 fixture", () => {
    expect(Subagent.decodeSnapshot(fixture.snapshot)).toEqual(fixture.snapshot)
    expect(Subagent.encodeSnapshot(fixture.snapshot)).toEqual(fixture.snapshot)
    expect(Subagent.decodeUpdate(fixture.update)).toEqual(fixture.update)
    expect(Subagent.encodeUpdate(fixture.update)).toEqual(fixture.update)
  })

  test("rejects an unsupported node phase", () => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes[1].phase = "waiting"

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
  })

  test("rejects a node without its workspace directory", () => {
    const snapshot = structuredClone(fixture.snapshot)
    delete snapshot.nodes[1].cwd

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
  })

  test.each(["-0.35", "NaN", "Infinity"])("rejects a non-serializable direct cost of %s", (amount) => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes[1].directCost.amount = amount

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
  })

  test("serializes a finite direct cost as a decimal string", () => {
    expect(Subagent.serializeDirectCost(1.2, "USD")).toEqual({ amount: "1.2", currency: "USD" })
  })

  ;[-0.35, Number.NaN, Number.POSITIVE_INFINITY].forEach((amount) => {
    test(`rejects an unrepresentable direct cost of ${amount}`, () => {
      expect(() => Subagent.serializeDirectCost(amount, "USD")).toThrow()
    })
  })

  test("rejects a cross-root parent", () => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes[1].rootSessionId = "other-root"

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
  })

  test("rejects duplicate session identities", () => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes[1].sessionId = "root"

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
  })

  test("accepts an empty collection of root graphs", () => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes = []

    expect(Subagent.decodeSnapshot(snapshot)).toEqual(snapshot)
  })

  test("accepts multiple valid root graphs", () => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes.push({
      runId: "other-root",
      sessionId: "other-root",
      rootSessionId: "other-root",
      phase: "completed",
      cwd: "/workspace/other-repo",
    })

    expect(Subagent.decodeSnapshot(snapshot)).toEqual(snapshot)
  })

  test("rejects a root group without its canonical root", () => {
    const snapshot = structuredClone(fixture.snapshot)
    snapshot.nodes = [
      {
        runId: "root-alias",
        sessionId: "root-alias",
        rootSessionId: "root",
        phase: "completed",
        cwd: "/workspace/repo",
      },
    ]

    expect(() => Subagent.decodeSnapshot(snapshot)).toThrow()
  })

  test("rejects a ninth descendant depth", () => {
    expect(() =>
      Subagent.decodeSnapshot({
        generation: "generation-a",
        revision: 0,
        nodes: Array.from({ length: 10 }, (_, depth) => ({
          runId: `node-${depth}`,
          sessionId: `node-${depth}`,
          rootSessionId: "node-0",
          ...(depth > 0 ? { parentSessionId: `node-${depth - 1}` } : {}),
          phase: "completed",
          cwd: "/workspace/repo",
        })),
      }),
    ).toThrow()
  })

  test("rejects a root with 301 descendants", () => {
    expect(() =>
      Subagent.decodeSnapshot({
        generation: "generation-a",
        revision: 0,
        nodes: [
          {
            runId: "root",
            sessionId: "root",
            rootSessionId: "root",
            phase: "running",
            cwd: "/workspace/repo",
          },
          ...Array.from({ length: 301 }, (_, index) => ({
            runId: `child-${index}`,
            sessionId: `child-${index}`,
            rootSessionId: "root",
            parentSessionId: "root",
            phase: "completed",
            cwd: "/workspace/repo",
          })),
        ],
      }),
    ).toThrow()
  })
})
