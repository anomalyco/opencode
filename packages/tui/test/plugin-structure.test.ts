import { expect, test } from "bun:test"
import type { RegionClaim } from "@opencode-ai/plugin/tui/context"
import { resolveStructure, type Claim, type Part, type Placement } from "../src/plugin/structure"

// Type-level canaries, checked by `bun typecheck`: the placement sum and the
// part union are exclusive — nonsense shapes must not compile.
export const canaries = () => {
  const claims: RegionClaim<"prompt.footer">[] = []
  claims.push({ at: "end", render: () => null })
  // @ts-expect-error two placement keys cannot coexist
  claims.push({ at: "end", before: "status", render: () => null })
  // @ts-expect-error replace does not combine with an anchor
  claims.push({ replace: "status", after: "file", render: () => null })
  // @ts-expect-error a part is a leaf or a container, never both
  const hybrid: Part<string> = { id: "x", render: "x", parts: [] }
  return { claims, hybrid }
}

// The resolver is generic over render types; strings make ordering
// assertions read as layouts.
function claim(plugin: string, placement: Placement, render?: string): Claim<string> {
  return { key: `${plugin}/${render ?? JSON.stringify(placement)}`, plugin, placement, render: render ?? plugin }
}

function layout(result: ReturnType<typeof resolveStructure<string, string>>) {
  return result.entries.map((entry) => (entry.kind === "part" ? entry.id : entry.claim.render))
}

const footer: Part<string>[] = [
  { id: "status", render: "status" },
  { id: "file", render: "file" },
]

const tree: Part<string>[] = [
  { id: "left", parts: [{ id: "mode", render: "mode" }] },
  {
    id: "right",
    parts: [
      { id: "directory", render: "directory" },
      { id: "model", render: "model" },
      { id: "tokens", render: "tokens" },
    ],
  },
]

test("no claims renders the host parts in order", () => {
  const result = resolveStructure<string, string>({ region: "prompt.footer", parts: footer, claims: [] })
  expect(layout(result)).toEqual(["status", "file"])
  expect(result.suppressed).toEqual([])
  expect(result.degraded).toEqual([])
})

test("edge claims land at the region's edges, several in enable order", () => {
  const result = resolveStructure({
    region: "prompt.footer",
    parts: footer,
    claims: [
      claim("a", { at: "end" }, "a1"),
      claim("b", { at: "start" }, "b1"),
      claim("a", { at: "end" }, "a2"),
    ],
  })
  expect(layout(result)).toEqual(["b1", "status", "file", "a1", "a2"])
})

test("before and after anchor to a part, wherever the host keeps it", () => {
  const result = resolveStructure({
    region: "prompt.footer",
    parts: footer,
    claims: [claim("a", { after: "status" }, "chip"), claim("b", { before: "status" }, "vim")],
  })
  expect(layout(result)).toEqual(["vim", "status", "chip", "file"])
})

test("a missing anchor degrades to the end instead of disappearing", () => {
  const result = resolveStructure({
    region: "prompt.footer",
    parts: footer,
    claims: [claim("a", { after: "tokens" }, "chip")],
  })
  expect(layout(result)).toEqual(["status", "file", "chip"])
  expect(result.degraded.map((item) => item.render)).toEqual(["chip"])
})

test("replacing a part swaps content but keeps the position and its anchors", () => {
  const result = resolveStructure({
    region: "prompt.footer",
    parts: footer,
    claims: [claim("a", { replace: "status" }, "fancy-status"), claim("b", { after: "status" }, "chip")],
  })
  expect(layout(result)).toEqual(["fancy-status", "chip", "file"])
  expect(result.suppressed).toEqual([])
})

test("same target: the last-enabled claim wins and the loser is recorded", () => {
  const first = claim("a", { replace: "status" }, "first")
  const second = claim("b", { replace: "status" }, "second")
  const result = resolveStructure({ region: "prompt.footer", parts: footer, claims: [first, second] })
  expect(layout(result)).toEqual(["second", "file"])
  expect(result.suppressed).toEqual([{ claim: first, by: second }])
})

test("container takeover suppresses everything anchored in the subtree", () => {
  const takeover = claim("theme", { replace: "right" }, "my-right")
  const chip = claim("pr", { after: "model" }, "chip")
  const inner = claim("x", { replace: "tokens" }, "cost")
  const result = resolveStructure({ region: "prompt.footer", parts: tree, claims: [takeover, chip, inner] })
  expect(layout(result)).toEqual(["mode", "my-right"])
  expect(result.suppressed).toEqual([
    { claim: chip, by: takeover },
    { claim: inner, by: takeover },
  ])
})

test("hierarchy beats timeline: an ancestor takeover wins over a later descendant claim", () => {
  // The descendant replace was enabled after the container takeover; the
  // container still wins because its target contains the descendant's.
  const inner = claim("x", { replace: "model" }, "swap-model")
  const outer = claim("theme", { replace: "right" }, "my-right")
  const result = resolveStructure({ region: "prompt.footer", parts: tree, claims: [outer, inner] })
  expect(layout(result)).toEqual(["mode", "my-right"])
  expect(result.suppressed).toEqual([{ claim: inner, by: outer }])
})

test("root takeover: nothing original survives, all other claims suppressed", () => {
  const theme = claim("powerline", { replace: "prompt.footer" }, "powerline")
  const chip = claim("pr", { at: "end" }, "chip")
  const result = resolveStructure({ region: "prompt.footer", parts: tree, claims: [chip, theme] })
  expect(layout(result)).toEqual(["powerline"])
  expect(result.suppressed).toEqual([{ claim: chip, by: theme }])
})

test("root takeover at the same node: last enabled wins", () => {
  const first = claim("a", { replace: "home.footer" }, "first")
  const second = claim("b", { replace: "home.footer" }, "second")
  const result = resolveStructure<string, string>({ region: "home.footer", parts: [], claims: [first, second] })
  expect(layout(result)).toEqual(["second"])
  expect(result.suppressed).toEqual([{ claim: first, by: second }])
})

test("containers flatten in order and anchors on a container wrap its whole span", () => {
  const result = resolveStructure({
    region: "prompt.footer",
    parts: tree,
    claims: [claim("a", { before: "right" }, "divider"), claim("b", { after: "right" }, "clock")],
  })
  expect(layout(result)).toEqual(["mode", "divider", "directory", "model", "tokens", "clock"])
})
