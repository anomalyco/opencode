import { expect, test } from "bun:test"
import type { SlotClaim } from "@opencode-ai/plugin/tui/context"
import { resolveSlots, type Claim, type PlacementKind } from "../src/plugin/structure"

// Type-level canaries, checked by `bun typecheck`: exactly one placement key,
// absolute paths only, and the render input follows the targeted path.
export const canaries = () => {
  const claims: SlotClaim[] = []
  claims.push({ append: "prompt.footer", render: (input) => (input.mode === "shell" ? null : null) })
  claims.push({ after: "prompt.footer.status", render: () => null })
  // @ts-expect-error two placement keys cannot coexist
  claims.push({ append: "prompt.footer", before: "prompt.footer.status", render: () => null })
  // @ts-expect-error replace does not combine with an anchor
  claims.push({ replace: "prompt.footer.status", after: "prompt.footer.file", render: () => null })
  // @ts-expect-error targets must be absolute published paths
  claims.push({ after: "status", render: () => null })
  // @ts-expect-error the render input is the targeted slot's input
  claims.push({ append: "prompt.footer", render: (input: { mode: number }) => null })
  return claims
}

// The resolver is generic over render values; strings make layout assertions
// read as layouts. Placements are written in the public claim shape and
// normalized here, like the plugin API does.
function claim(plugin: string, placement: Partial<Record<PlacementKind, string>>, render: string): Claim<string> {
  const kind = (["prepend", "append", "before", "after", "replace"] as const).find((item) => placement[item])!
  return { key: `${plugin}/${render}`, plugin, placement: { kind, target: placement[kind]! }, render }
}

// A host slot tree for tests: a node's children are its child slots, a leaf's
// content is its own name. Mirrors how nested <Slot> components mount.
type Node = { readonly path: string; readonly children?: ReadonlyArray<Node> }

function paths(nodes: ReadonlyArray<Node>, into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    into.add(node.path)
    paths(node.children ?? [], into)
  }
  return into
}

// Fold the tree with a resolution into the flat render order, mirroring the
// <Slot> component: before + (replace | prepend + own content + append) + after.
function layout(nodes: ReadonlyArray<Node>, resolved: ReturnType<typeof resolveSlots<string>>): ReadonlyArray<string> {
  return nodes.flatMap((node) => {
    const slotted = resolved.slotted.get(node.path)
    const own = node.children ? layout(node.children, resolved) : [leafName(node.path)]
    const inside = slotted?.replace
      ? [slotted.replace.render]
      : [
          ...(slotted?.prepend ?? []).map((item) => item.render),
          ...own,
          ...(slotted?.append ?? []).map((item) => item.render),
        ]
    return [
      ...(slotted?.before ?? []).map((item) => item.render),
      ...inside,
      ...(slotted?.after ?? []).map((item) => item.render),
    ]
  })
}

function leafName(path: string) {
  return path.slice(path.lastIndexOf(".") + 1)
}

function resolve(tree: ReadonlyArray<Node>, claims: ReadonlyArray<Claim<string>>) {
  return resolveSlots({ paths: paths(tree), claims })
}

const footer: Node[] = [
  {
    path: "prompt.footer",
    children: [{ path: "prompt.footer.status" }, { path: "prompt.footer.file" }],
  },
]

const tree: Node[] = [
  {
    path: "prompt.footer",
    children: [
      { path: "prompt.footer.left", children: [{ path: "prompt.footer.left.mode" }] },
      {
        path: "prompt.footer.right",
        children: [
          { path: "prompt.footer.right.directory" },
          { path: "prompt.footer.right.model" },
          { path: "prompt.footer.right.tokens" },
        ],
      },
    ],
  },
]

test("no claims renders the host tree in order", () => {
  const result = resolve(footer, [])
  expect(layout(footer, result)).toEqual(["status", "file"])
  expect(result.suppressed).toEqual([])
  expect(result.degraded).toEqual([])
})

test("prepend and append land inside a boundary's edges, several in enable order", () => {
  const result = resolve(footer, [
    claim("a", { append: "prompt.footer" }, "a1"),
    claim("b", { prepend: "prompt.footer" }, "b1"),
    claim("a", { append: "prompt.footer" }, "a2"),
  ])
  expect(layout(footer, result)).toEqual(["b1", "status", "file", "a1", "a2"])
})

test("before and after anchor to a slot, wherever the host keeps it", () => {
  const result = resolve(footer, [
    claim("a", { after: "prompt.footer.status" }, "chip"),
    claim("b", { before: "prompt.footer.status" }, "vim"),
  ])
  expect(layout(footer, result)).toEqual(["vim", "status", "chip", "file"])
})

test("a missing anchor degrades to the nearest surviving ancestor's end", () => {
  const result = resolve(footer, [claim("a", { after: "prompt.footer.tokens" }, "chip")])
  expect(layout(footer, result)).toEqual(["status", "file", "chip"])
  expect(result.degraded).toEqual([
    { claim: claim("a", { after: "prompt.footer.tokens" }, "chip"), to: "prompt.footer" },
  ])
})

test("an additive claim with no surviving ancestor is suppressed", () => {
  const result = resolve(footer, [claim("a", { append: "session.composer.top" }, "chip")])
  expect(layout(footer, result)).toEqual(["status", "file"])
  expect(result.suppressed).toEqual([{ claim: claim("a", { append: "session.composer.top" }, "chip") }])
})

test("a missing replacement is suppressed, never degraded into a widget", () => {
  const result = resolve(footer, [claim("a", { replace: "prompt.footer.tokens" }, "cost")])
  expect(layout(footer, result)).toEqual(["status", "file"])
  expect(result.suppressed).toEqual([{ claim: claim("a", { replace: "prompt.footer.tokens" }, "cost") }])
  expect(result.degraded).toEqual([])
})

test("replacing a slot swaps content but keeps the boundary and its outside anchors", () => {
  const fancy = claim("a", { replace: "prompt.footer.status" }, "fancy-status")
  const result = resolve(footer, [fancy, claim("b", { after: "prompt.footer.status" }, "chip")])
  expect(layout(footer, result)).toEqual(["fancy-status", "chip", "file"])
  expect(result.suppressed).toEqual([])
})

test("inside contributions to a replaced boundary are suppressed", () => {
  const takeover = claim("a", { replace: "prompt.footer" }, "powerline")
  const badge = claim("b", { append: "prompt.footer" }, "badge")
  const result = resolve(footer, [badge, takeover])
  expect(layout(footer, result)).toEqual(["powerline"])
  expect(result.suppressed).toEqual([{ claim: badge, by: takeover }])
})

test("same target: the last-enabled replacement wins and the loser is recorded", () => {
  const first = claim("a", { replace: "prompt.footer.status" }, "first")
  const second = claim("b", { replace: "prompt.footer.status" }, "second")
  const result = resolve(footer, [first, second])
  expect(layout(footer, result)).toEqual(["second", "file"])
  expect(result.suppressed).toEqual([{ claim: first, by: second }])
})

test("container takeover suppresses everything anchored in the subtree", () => {
  const takeover = claim("theme", { replace: "prompt.footer.right" }, "my-right")
  const chip = claim("pr", { after: "prompt.footer.right.model" }, "chip")
  const inner = claim("x", { replace: "prompt.footer.right.tokens" }, "cost")
  const result = resolve(tree, [takeover, chip, inner])
  expect(layout(tree, result)).toEqual(["mode", "my-right"])
  expect(result.suppressed).toEqual([
    { claim: inner, by: takeover },
    { claim: chip, by: takeover },
  ])
})

test("hierarchy beats timeline: an ancestor takeover wins over a later descendant claim", () => {
  // The descendant replace was enabled after the container takeover; the
  // container still wins because its path contains the descendant's.
  const inner = claim("x", { replace: "prompt.footer.right.model" }, "swap-model")
  const outer = claim("theme", { replace: "prompt.footer.right" }, "my-right")
  const result = resolve(tree, [outer, inner])
  expect(layout(tree, result)).toEqual(["mode", "my-right"])
  expect(result.suppressed).toEqual([{ claim: inner, by: outer }])
})

test("root takeover: nothing original survives, all inside claims suppressed", () => {
  const theme = claim("powerline", { replace: "prompt.footer" }, "powerline")
  const chip = claim("pr", { append: "prompt.footer" }, "chip")
  const result = resolve(tree, [chip, theme])
  expect(layout(tree, result)).toEqual(["powerline"])
  expect(result.suppressed).toEqual([{ claim: chip, by: theme }])
})

test("a degraded claim landing inside a replaced boundary is suppressed, not shown", () => {
  const takeover = claim("theme", { replace: "prompt.footer.right" }, "my-right")
  const stray = claim("pr", { after: "prompt.footer.right.gone" }, "chip")
  const result = resolve(tree, [takeover, stray])
  expect(layout(tree, result)).toEqual(["mode", "my-right"])
  expect(result.suppressed).toEqual([{ claim: stray, by: takeover }])
  expect(result.degraded).toEqual([])
})

test("anchors on a container wrap its whole span", () => {
  const result = resolve(tree, [
    claim("a", { before: "prompt.footer.right" }, "divider"),
    claim("b", { after: "prompt.footer.right" }, "clock"),
  ])
  expect(layout(tree, result)).toEqual(["mode", "divider", "directory", "model", "tokens", "clock"])
})
