// Attribute a renderer .cpuprofile's self time to original source files through the build's
// source maps. Run with: bun scripts/profile-by-source.ts <profile.cpuprofile> [out/renderer/assets]
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { TraceMap, originalPositionFor } from "C:/Users/Lukem/.local/share/opencode/worktree/6c1049/quiet-wolf-2/node_modules/.bun/@jridgewell+trace-mapping@0.3.31/node_modules/@jridgewell/trace-mapping/dist/trace-mapping.mjs"

const profilePath = process.argv[2]!
const assets = process.argv[3] ?? "out/renderer/assets"
const profile = JSON.parse(readFileSync(profilePath, "utf8"))
const maps = new Map<string, TraceMap>()
for (const name of readdirSync(assets).filter((f) => f.endsWith(".js.map"))) {
  maps.set(name.slice(0, -4), new TraceMap(JSON.parse(readFileSync(join(assets, name), "utf8"))))
}

const nodes = new Map<number, any>()
for (const n of profile.nodes) nodes.set(n.id, n)
const self = new Map<string, number>()
const byPkg = new Map<string, number>()
const group = (source: string) => {
  const n = source.replace(/\\/g, "/")
  const nm = n.match(/node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)(?:\/dist\/([^/]+))?/)
  if (nm) return nm[1] === "effect" ? `effect/${(nm[2] ?? "").replace(/\.js$/, "")}` : nm[1]
  const pk = n.match(/packages\/([^/]+)\/src\/(.+)$/)
  return pk ? `${pk[1]}/${pk[2]}` : n.slice(-50)
}
const parent = new Map<number, number>()
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
const resolve = (frame: any) => {
  const name = frame.functionName
  if (name === "(program)" || name === "(garbage collector)") return { label: name, fn: name }
  const file = frame.url.split("/").pop()
  const map = maps.get(file)
  if (!map) return { label: `(no map) ${file}`, fn: name }
  const pos = originalPositionFor(map, { line: frame.lineNumber + 1, column: frame.columnNumber })
  return { label: pos.source ? group(pos.source) : `(unmapped) ${file}`, fn: pos.name ?? name }
}
const labelOf = (frame: any) => resolve(frame).label
// A sample belongs to the render phase once Solid's root is on the stack; everything before that is
// module evaluation, everything after the first render is later work (hydration, effects, timers).
const stackHas = (id: number, test: (label: string, fn: string) => boolean) => {
  for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) {
    const resolved = resolve(nodes.get(cur).callFrame)
    if (test(resolved.label, resolved.fn)) return true
  }
  return false
}
const phases = { evaluate: new Map<string, number>(), render: new Map<string, number>(), later: new Map<string, number>() }
let phase: keyof typeof phases = "evaluate"
let t = 0
let total = 0
for (let i = 0; i < profile.samples.length; i++) {
  const dt = (profile.timeDeltas[i] ?? 0) / 1000
  t += dt
  const node = nodes.get(profile.samples[i])
  if (node.callFrame.functionName === "(idle)") {
    if (phase === "render" && dt > 5) phase = "later"
    continue
  }
  total += dt
  if (phase === "evaluate" && stackHas(node.id, (label, fn) => label === "solid-js" && (fn === "render" || fn === "createRoot")))
    phase = "render"
  const label = labelOf(node.callFrame)
  const bucket = phases[phase]
  bucket.set(label, (bucket.get(label) ?? 0) + dt)
  self.set(label, (self.get(label) ?? 0) + dt)
  const pkg = label.split("/").slice(0, label.startsWith("effect/") || label.startsWith("@") ? 2 : 1).join("/")
  byPkg.set(pkg, (byPkg.get(pkg) ?? 0) + dt)
}
console.log(`busy ${total.toFixed(0)} ms over ${t.toFixed(0)} ms`)
void phases
// Timeline: 25 ms buckets with the top sources, so module evaluation, render and hydration show as bands.
const buckets = new Map<number, Map<string, number>>()
t = 0
for (let i = 0; i < profile.samples.length; i++) {
  const dt = (profile.timeDeltas[i] ?? 0) / 1000
  t += dt
  const node = nodes.get(profile.samples[i])
  if (node.callFrame.functionName === "(idle)") continue
  const b = Math.floor(t / 25) * 25
  const m = buckets.get(b) ?? new Map()
  const label = labelOf(node.callFrame).replace(/^(\.\.\/)+/, "")
  m.set(label, (m.get(label) ?? 0) + dt)
  buckets.set(b, m)
}
console.log("\n== timeline (25 ms buckets) ==")
for (const [b, m] of [...buckets].sort((a, c) => a[0] - c[0])) {
  const busy = [...m.values()].reduce((a, c) => a + c, 0)
  if (busy < 1) continue
  const top = [...m].sort((a, c) => c[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(" | ")
  console.log(String(b).padStart(5), busy.toFixed(0).padStart(3), top)
}
console.log("\n== by package (all) ==")
for (const [k, v] of [...byPkg].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(v.toFixed(1).padStart(7), k)

