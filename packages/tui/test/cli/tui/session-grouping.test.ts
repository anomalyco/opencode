import { describe, expect, test } from "bun:test"
import {
  flattenGroups,
  groupEntries,
  leafCount,
  mergeGroups,
  splitGroups,
  type TimelineNode,
} from "../../../src/routes/session/grouping/tree"

type Kind = "activity" | "exploration" | "reasoning" | "instructions"
type Entry = { id: string; path: Kind[] }

const entry = (id: string, ...path: Kind[]): Entry => ({ id, path })
const group = (entries: readonly Entry[]) => groupEntries(entries, (item) => item.path)
const ids = (nodes: readonly TimelineNode<Kind, Entry>[]) => flattenGroups(nodes).map((item) => item.id)

describe("session grouping tree", () => {
  test("leaves standalone entries unwrapped", () => {
    const entries = [entry("a"), entry("b")]
    expect(group(entries)).toEqual([
      { type: "entry", entry: entries[0], size: 1 },
      { type: "entry", entry: entries[1], size: 1 },
    ])
  })

  test("groups consecutive entries with the same path", () => {
    expect(group([entry("a", "exploration"), entry("b", "exploration")])).toMatchObject([
      {
        type: "group",
        kind: "exploration",
        size: 2,
        children: [
          { type: "entry", entry: { id: "a" }, size: 1 },
          { type: "entry", entry: { id: "b" }, size: 1 },
        ],
      },
    ])
  })

  test("creates nested groups from configured paths", () => {
    const nodes = group([
      entry("read", "activity", "exploration"),
      entry("thought", "activity", "reasoning"),
      entry("notice", "activity", "instructions"),
      entry("shell", "activity"),
    ])
    expect(nodes).toMatchObject([
      {
        type: "group",
        kind: "activity",
        size: 4,
        children: [
          { type: "group", kind: "exploration", size: 1 },
          { type: "group", kind: "reasoning", size: 1 },
          { type: "group", kind: "instructions", size: 1 },
          { type: "entry", entry: { id: "shell" }, size: 1 },
        ],
      },
    ])
    expect(ids(nodes)).toEqual(["read", "thought", "notice", "shell"])
  })

  test("standalone entries delimit compatible groups", () => {
    const nodes = group([entry("a", "exploration"), entry("text"), entry("b", "exploration")])
    expect(nodes.map((node) => (node.type === "group" ? node.kind : node.entry.id))).toEqual([
      "exploration",
      "text",
      "exploration",
    ])
  })

  test("direct children delimit nested subgroups without ending their outer group", () => {
    const nodes = group([
      entry("read-a", "activity", "exploration"),
      entry("shell", "activity"),
      entry("read-b", "activity", "exploration"),
    ])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      type: "group",
      kind: "activity",
      size: 3,
      children: [
        { type: "group", kind: "exploration", size: 1 },
        { type: "entry", entry: { id: "shell" } },
        { type: "group", kind: "exploration", size: 1 },
      ],
    })
  })

  test("counts depth-first leaves and never counts group wrappers", () => {
    const nodes = group([
      entry("a", "activity", "exploration"),
      entry("b", "activity", "exploration"),
      entry("c", "activity", "reasoning"),
      entry("d"),
    ])
    expect(leafCount(nodes)).toBe(4)
    expect(nodes[0]?.size).toBe(3)
    if (nodes[0]?.type !== "group") throw new Error("Expected activity group")
    expect(nodes[0].children[0]?.size).toBe(2)
  })

  test("merges both levels at a recursive seam", () => {
    const left = group([entry("shell", "activity"), entry("read-a", "activity", "exploration")])
    const right = group([entry("read-b", "activity", "exploration"), entry("thought", "activity", "reasoning")])
    const merged = mergeGroups(left, right)
    expect(merged).toMatchObject([
      {
        type: "group",
        kind: "activity",
        size: 4,
        children: [
          { type: "entry", entry: { id: "shell" } },
          { type: "group", kind: "exploration", size: 2 },
          { type: "group", kind: "reasoning", size: 1 },
        ],
      },
    ])
    expect(ids(merged)).toEqual(["shell", "read-a", "read-b", "thought"])
  })

  test("does not merge incompatible outer or inner seams", () => {
    expect(mergeGroups(group([entry("a", "exploration")]), group([entry("b", "reasoning")]))).toHaveLength(2)
    const merged = mergeGroups(
      group([entry("a", "activity", "exploration")]),
      group([entry("b", "activity", "reasoning")]),
    )
    expect(merged).toHaveLength(1)
    if (merged[0]?.type !== "group") throw new Error("Expected activity group")
    expect(merged[0].children).toHaveLength(2)
  })

  test("retains identities outside the recursive seam", () => {
    const left = group([entry("before"), entry("shell", "activity"), entry("read-a", "activity", "exploration")])
    const right = group([
      entry("read-b", "activity", "exploration"),
      entry("thought", "activity", "reasoning"),
      entry("after"),
    ])
    if (left[1]?.type !== "group" || right[0]?.type !== "group") throw new Error("Expected activity groups")
    const leftShell = left[1].children[0]
    const rightReasoning = right[0].children[1]
    const merged = mergeGroups(left, right)
    expect(merged[0]).toBe(left[0])
    expect(merged[2]).toBe(right[1])
    if (merged[1]?.type !== "group") throw new Error("Expected merged activity group")
    expect(merged[1].children[0]).toBe(leftShell)
    expect(merged[1].children[2]).toBe(rightReasoning)
  })

  test("does not mutate chunks while recursively merging", () => {
    const left = group([entry("a", "activity", "exploration")])
    const right = group([entry("b", "activity", "exploration")])
    const saved = structuredClone([left, right])
    mergeGroups(left, right)
    expect([left, right]).toEqual(saved)
  })

  test("merges empty chunks without sharing their root arrays", () => {
    const nodes = group([entry("a", "exploration")])
    expect(mergeGroups([], nodes)).toEqual(nodes)
    expect(mergeGroups([], nodes)).not.toBe(nodes)
    expect(mergeGroups(nodes, [])).toEqual(nodes)
    expect(mergeGroups(nodes, [])).not.toBe(nodes)
  })

  test("splits at every depth-first leaf boundary and rejoins canonically", () => {
    const entries = [
      entry("before"),
      entry("read-a", "activity", "exploration"),
      entry("read-b", "activity", "exploration"),
      entry("thought", "activity", "reasoning"),
      entry("shell", "activity"),
      entry("after"),
    ]
    const nodes = group(entries)
    for (let count = 0; count <= entries.length; count++) {
      const [left, right] = splitGroups(nodes, count)
      expect(ids(left)).toEqual(entries.slice(0, count).map((item) => item.id))
      expect(ids(right)).toEqual(entries.slice(count).map((item) => item.id))
      expect(leafCount(left)).toBe(count)
      expect(leafCount(right)).toBe(entries.length - count)
      expect(mergeGroups(left, right)).toEqual(nodes)
    }
  })

  test("rejects invalid split offsets", () => {
    const nodes = group([entry("a")])
    for (const count of [-1, 0.5, 2, Number.NaN]) expect(() => splitGroups(nodes, count)).toThrow(RangeError)
  })

  test("all two-way partitions reproduce a fresh projection", () => {
    const entries = [
      entry("a", "activity", "exploration"),
      entry("b", "activity", "exploration"),
      entry("c", "activity", "reasoning"),
      entry("d", "activity"),
      entry("e"),
      entry("f", "instructions"),
      entry("g", "instructions"),
    ]
    const whole = group(entries)
    for (let index = 0; index <= entries.length; index++) {
      expect(mergeGroups(group(entries.slice(0, index)), group(entries.slice(index)))).toEqual(whole)
    }
  })

  test("all three-way partitions merge associatively", () => {
    const entries = [
      entry("a", "activity", "exploration"),
      entry("b", "activity", "exploration"),
      entry("c", "activity", "reasoning"),
      entry("d", "activity"),
      entry("e"),
      entry("f", "instructions"),
      entry("g", "instructions"),
    ]
    const whole = group(entries)
    for (let first = 0; first <= entries.length; first++) {
      for (let second = first; second <= entries.length; second++) {
        const a = group(entries.slice(0, first))
        const b = group(entries.slice(first, second))
        const c = group(entries.slice(second))
        expect(mergeGroups(mergeGroups(a, b), c)).toEqual(whole)
        expect(mergeGroups(a, mergeGroups(b, c))).toEqual(whole)
      }
    }
  })

  test("all short path sequences preserve order, sizes, splits, and associative seams", () => {
    const paths: Kind[][] = [
      [],
      ["exploration"],
      ["reasoning"],
      ["activity"],
      ["activity", "exploration"],
      ["activity", "reasoning"],
    ]
    const sequences = paths.flatMap((first) =>
      paths.flatMap((second) => paths.flatMap((third) => paths.map((fourth) => [first, second, third, fourth]))),
    )
    sequences.forEach((sequence) => {
      const entries = sequence.map((path, index) => entry(String(index), ...path))
      const whole = group(entries)
      expect(ids(whole)).toEqual(["0", "1", "2", "3"])
      expect(leafCount(whole)).toBe(4)
      for (let first = 0; first <= entries.length; first++) {
        const [left, right] = splitGroups(whole, first)
        expect(mergeGroups(left, right)).toEqual(whole)
        for (let second = first; second <= entries.length; second++) {
          const a = group(entries.slice(0, first))
          const b = group(entries.slice(first, second))
          const c = group(entries.slice(second))
          expect(mergeGroups(mergeGroups(a, b), c)).toEqual(whole)
          expect(mergeGroups(a, mergeGroups(b, c))).toEqual(whole)
        }
      }
    })
  })

  test("supports deeper paths without special-casing two phases", () => {
    type DeepKind = "outer" | "middle" | "inner"
    const entries = [
      { id: "a", path: ["outer", "middle", "inner"] as DeepKind[] },
      { id: "b", path: ["outer", "middle", "inner"] as DeepKind[] },
    ]
    const nodes = groupEntries(entries, (item) => item.path)
    expect(nodes).toMatchObject([
      {
        type: "group",
        kind: "outer",
        size: 2,
        children: [
          {
            type: "group",
            kind: "middle",
            size: 2,
            children: [{ type: "group", kind: "inner", size: 2 }],
          },
        ],
      },
    ])
  })

  test("preserves duplicate leaves because ingestion identity belongs to the projection layer", () => {
    const duplicate = entry("same", "exploration")
    expect(ids(group([duplicate, duplicate]))).toEqual(["same", "same"])
  })
})
