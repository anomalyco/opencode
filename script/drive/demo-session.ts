import { readFileSync } from "node:fs"
import { Effect, Stream } from "effect"
import { Llm, OpenCodeDriver } from "opencode-drive"

// Serves the debug bar's Demo controls: an isolated server whose simulated model answers each `[demo:<action> <speed>×]`
// prompt with a scripted reply. Shell, edit, read and subagent calls run for real inside the throwaway project.
// Run from the repository root with `opencode-drive run script/drive/demo-session.ts`; see demo-session.md.
const state = process.env.DEMO_STATE

const tides = [
  "#!/bin/sh",
  'delay=$(awk "BEGIN { print 0.22 / ${1:-1} }")',
  "for station in Breakwater 'North Mole' 'Lantern Quay' 'Saltmarsh Gate' 'Pilot Steps' 'Fishery Slip' 'East Buoy' 'Harbor Mouth'; do",
  '  printf "✓ %-16s high water within 4 cm\\n" "$station"',
  '  sleep "$delay"',
  "done",
  'printf "\\n8 passed, 0 failed\\n"',
].join("\n")

const preview = [
  "#!/bin/sh",
  'delay=$(awk "BEGIN { print 0.9 / ${1:-1} }")',
  'printf "Lantern preview starting on http://127.0.0.1:4173\\n"',
  "for frame in 1 2 3 4 5 6 7 8 9 10 11 12; do",
  '  sleep "$delay"',
  '  printf "rebuilt beacon map (%s/12)\\n" "$frame"',
  "done",
  'printf "preview idle\\n"',
].join("\n")

const build = [
  "#!/bin/sh",
  "count=${1:-8}",
  'delay=$(awk "BEGIN { print 0.07 / ${2:-1} }")',
  "label=${3:-module}",
  "i=1",
  'while [ "$i" -le "$count" ]; do',
  '  printf "  %s %02d/%02d  compiled in %dms\\n" "$label" "$i" "$count" $((i * 37 % 90 + 8))',
  '  sleep "$delay"',
  "  i=$((i+1))",
  "done",
  'printf "\\n%s: %d built, 0 warnings\\n" "$label" "$count"',
].join("\n")

const harbor = [
  "export const lantern = {",
  '  name: "North Mole",',
  "  intervalMs: 4000,",
  '  color: "amber",',
  "}",
  "",
  "export function nextFlash(at: number) {",
  "  return at + lantern.intervalMs",
  "}",
  "",
].join("\n")

const paragraph =
  "The harbor wakes before the town does. Fishing boats slip their moorings while the lanterns along the North Mole " +
  "are still turning, and the tide tables pinned inside the pilot's hut are already out of date by a few minutes. " +
  "Most mornings the fog lifts in layers: first the masts, then the roofs of the net sheds, and finally the long " +
  "breakwater, which always seems farther away than it is. By the time the bakery opens, the first catch is on ice."

const code = [
  "Here is the scheduler that keeps the lanterns in phase:",
  "",
  "```ts",
  "type Lantern = { name: string; intervalMs: number; offsetMs: number }",
  "",
  "export function schedule(lanterns: Lantern[], now: number) {",
  "  return lanterns",
  "    .map((lantern) => {",
  "      const elapsed = (now - lantern.offsetMs) % lantern.intervalMs",
  "      return { name: lantern.name, nextFlash: now + lantern.intervalMs - elapsed }",
  "    })",
  "    .toSorted((a, b) => a.nextFlash - b.nextFlash)",
  "}",
  "",
  "export function inPhase(a: Lantern, b: Lantern) {",
  "  return a.intervalMs === b.intervalMs && a.offsetMs === b.offsetMs",
  "}",
  "```",
  "",
  "Each lantern keeps its own interval, so the sort decides which one flashes next.",
].join("\n")

export default OpenCodeDriver.use(
  {
    opencode: { dev: process.env.OPENCODE_DEV ?? process.cwd() },
    tui: { viewport: { cols: 100, rows: 30 } },
    llm: { requestTimeout: 3_600_000, settlementTimeout: 5_000 },
    config: {
      autoupdate: false,
      username: "Demo",
      agents: { surveyor: { mode: "subagent", description: "Surveys a part of the harbor" } },
    },
    project: {
      git: true,
      files: {
        "README.md": "# Harbor\nLantern schedules and tide checks for a fictional harbor.\n",
        "src/harbor.ts": harbor,
        "src/tides.ts": "export const stations = ['Breakwater', 'North Mole', 'Lantern Quay']\n",
        "src/fleet.ts": "export const boats = ['Gannet', 'Kittiwake', 'Shearwater']\n",
        "docs/pilots.md": "# Pilot steps\nBoard at the pilot steps two hours before high water.\n",
        "scripts/tides.sh": tides,
        "scripts/preview.sh": preview,
        "scripts/build.sh": build,
      },
    },
  },
  ({ llm, artifacts, directory }) =>
    Effect.gen(function* () {
      yield* llm.title(() => Effect.succeed("Timeline demo"))
      yield* llm.serve((request) => {
        const body = JSON.stringify(request.body)
        if (body.includes("You are a subagent spawned")) return child(rate(body))
        const turn = demoTurn(request.body)
        if (!turn) return reply("Noted. The harbor log is up to date.", 1)
        if (turn.action === "random") return randomTurn(turn.seed, turn.step, turn.speed, directory)
        return respond(turn.action, turn.step, turn.speed, directory)
      })
      const session = yield* Effect.promise(() => createSession(artifacts, directory))
      console.log(`Demo session ${session.id} in ${directory}`)
      if (state)
        yield* Effect.promise(() => Bun.write(state, JSON.stringify({ ...session.server, session: session.id })))
      return yield* Effect.never
    }),
)

function respond(action: string, step: number, speed: number, directory: string) {
  const call = (name: string, input: Record<string, string | boolean>, index = 0) =>
    Llm.toolCall({ index, id: `call_${crypto.randomUUID().replaceAll("-", "")}`, name, input })
  const text = (value: string, chunk = 3) => Llm.text(value, { delay: 16 / speed, chunkSize: chunk })
  const think = (value: string) => Llm.reasoning(value, { delay: 24 / speed, chunkSize: 4 })
  const tools = (...outputs: Llm.Output[]) => Stream.make(...outputs, Llm.finish("tool-calls"))

  switch (action) {
    case "paragraph":
      return Stream.make(think("Describing the morning harbor."), text(paragraph))
    case "code":
      return Stream.make(text(code, 6))
    case "shell":
      if (step === 0)
        return tools(
          text("Running the tide checks."),
          call("shell", {
            command: `sh scripts/tides.sh ${speed}`,
            description: "Run tide checks",
            workdir: directory,
          }),
        )
      return Stream.make(text("All eight stations are within tolerance."))
    case "patch":
      if (step === 0)
        return tools(text("Retiming the North Mole lantern."), call("patch", { patchText: patch(directory) }))
      return Stream.make(text("The lantern interval is updated."))
    case "turn":
      return Stream.make(
        think(
          "Checking the tide tables against the lantern schedule. The North Mole runs on a four second interval, " +
            "the Lantern Quay on six, so they line up every twelve seconds. High water is at 06:40, which means " +
            "the pilot boat leaves at 04:40 and needs both lanterns in phase before then.",
        ),
        Llm.pause(1_500 / speed),
        text("Both lanterns are in phase before the pilot boat leaves."),
      )
    case "short":
      return Stream.make(text("Sure. The harbor is quiet today."))
    case "long":
    case "message":
    case "steer":
      return longReply(step, speed, directory)
    case "burst":
      if (step === 0)
        return tools(
          Llm.text("Reading the harbor files.", { delay: 4 / speed, chunkSize: 2 }),
          ...["README.md", "src/harbor.ts", "src/tides.ts", "src/fleet.ts", "docs/pilots.md"].map((file, index) =>
            call("read", { path: `${directory}/${file}` }, index),
          ),
        )
      return Stream.make(
        Llm.text(
          "Five files: the lantern config, the tide stations, the fleet roster, the pilot notes and the readme.",
          { delay: 4 / speed, chunkSize: 1 },
        ),
      )
    case "queue":
      return Stream.make(text("Next on the list: repaint the pilot steps before the spring tides."))
    case "subagent":
      if (step === 0)
        return tools(
          text("Sending a surveyor to the breakwater."),
          call("subagent", {
            agent: "surveyor",
            description: "Survey the breakwater",
            prompt: `[demo:child ${speed}×] Walk the breakwater and report any loose stones.`,
            background: true,
          }),
        )
      return Stream.make(text("The survey runs in the background. I'll report back when it lands."))
    case "notice":
      return Stream.make(text("That finished. The results are in the harbor log."))
    case "background":
      if (step === 0)
        return tools(
          text("Starting the lantern preview."),
          call("shell", {
            command: `sh scripts/preview.sh ${speed}`,
            description: "Lantern preview",
            workdir: directory,
            background: true,
          }),
        )
      return Stream.make(text("The preview is starting in the background."))
  }
  return reply("Noted.", speed)
}

function child(speed: number) {
  return Stream.make(
    Llm.reasoning("Walking the breakwater from the harbor mouth.", { delay: 30 / speed, chunkSize: 3 }),
    Llm.pause(1_200 / speed),
    Llm.text(
      "The breakwater is sound. Two capstones near the East Buoy have shifted a few centimetres and should be reset " +
        "at the next low spring tide.",
      { delay: 40 / speed, chunkSize: 3 },
    ),
  )
}

// Tool boundaries let the real runner deliver steers before requesting the next section.
// A newly delivered steer starts another long continuation instead of ending with an acknowledgement.
function longReply(step: number, speed: number, directory: string) {
  const text = (value: string) => Llm.text(value, { delay: 16 / speed, chunkSize: 3 })
  const sections = [
    `${paragraph}\n\n${sentences.slice(0, 6).join(" ")}\n\n${sentences.slice(6).join(" ")}`,
    `${sentences.slice(4).join(" ")}\n\n${paragraph}\n\n${sentences.slice(0, 4).join(" ")}`,
    `${paragraph}\n\n${sentences.slice(2, 9).join(" ")}\n\n${summaries.join(" ")}`,
  ]
  const output = text(sections[Math.min(step, sections.length - 1)]!)
  if (step >= 2) return Stream.make(Llm.pause(600 / speed), output)
  return Stream.make(
    Llm.pause(600 / speed),
    output,
    Llm.toolCall({
      index: 0,
      id: `call_${crypto.randomUUID().replaceAll("-", "")}`,
      name: step === 0 ? "read" : "shell",
      input: step === 0
        ? { path: `${directory}/docs/pilots.md` }
        : { command: `sh scripts/tides.sh ${speed}`, description: "Check harbor tides", workdir: directory },
    }),
    Llm.finish("tool-calls"),
  )
}

function reply(value: string, speed: number) {
  return Stream.make(Llm.text(value, { delay: 16 / speed, chunkSize: 3 }))
}

// Toggles the lantern interval, so every press produces a real diff.
function patch(directory: string) {
  const path = `${directory}/src/harbor.ts`
  const [from, to] = readFileSync(path, "utf8").includes("intervalMs: 6000") ? [6000, 4000] : [4000, 6000]
  return [
    "*** Begin Patch",
    `*** Update File: ${path}`,
    "@@",
    `-  intervalMs: ${from},`,
    `+  intervalMs: ${to},`,
    "*** End Patch",
  ].join("\n")
}

function rate(body: string) {
  const match = body.match(/\[demo:[a-z]+ ([\d.]+)×\]/)
  return match ? Number(match[1]) || 1 : 1
}

// Typed prompts carry no tag, so they stream at the speed of the latest Demo control.
let lastSpeed = 1

// The newest user message picks the action; assistant messages after it count the steps already taken this turn.
// A Demo control's tag names its action, a background notice gets a short acknowledgement, "short" and "code" in
// typed text pick those replies, and any other typed prompt gets a random turn seeded by the conversation so far.
function demoTurn(body: unknown) {
  const messages = typeof body === "object" && body !== null && "messages" in body ? body.messages : undefined
  if (!Array.isArray(messages)) return
  const last = messages.findLastIndex((message) => message?.role === "user")
  if (last < 0) return
  const step = messages.slice(last + 1).filter((message) => message?.role === "assistant").length
  const text = userText(messages[last])
  const match = text.match(/\[demo:([a-z]+) ([\d.]+)×\]/)
  if (match) {
    lastSpeed = Number(match[2]) || 1
    return { action: match[1], speed: lastSpeed, step, seed: 0 }
  }
  const pick = (action: string) => ({ action, speed: lastSpeed, step, seed: 0 })
  if (/<(subagent|shell) /.test(text)) return pick("notice")
  if (/\bshort\b/i.test(text)) return pick("short")
  if (/\bcode\b/i.test(text)) return pick("code")
  if (/\brandom\b/i.test(text))
    return { action: "random", speed: lastSpeed, step, seed: hash(JSON.stringify(messages.slice(0, last + 1))) }
  return pick("long")
}

function userText(message: { content?: unknown }) {
  if (typeof message.content === "string") return message.content
  if (!Array.isArray(message.content)) return ""
  return message.content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n")
}

function hash(value: string) {
  let result = 2166136261
  for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619)
  return result >>> 0
}

// A 5–10 s turn at 1×: reasoning, then three to five tool steps (one to three shells, often a patch and parallel
// reads, sometimes a background subagent or shell) with prose, lists and code between them, then a summary. The
// seed fixes the plan, so every request in the turn rebuilds the same one and plays its next step.
function randomTurn(seed: number, step: number, speed: number, directory: string) {
  // The plan comes from the turn's seed; each step's text from its own, so steps never repeat each other.
  const plan = mulberry(seed)
  const random = mulberry(seed ^ Math.imul(step + 1, 0x9e3779b9))
  const int = (min: number, max: number, source = random) => min + Math.floor(source() * (max - min + 1))
  const one = <T>(items: readonly T[]) => items[int(0, items.length - 1)]
  const some = <T>(items: readonly T[], count: number) =>
    items
      .map((item) => ({ item, key: random() }))
      .toSorted((a, b) => a.key - b.key)
      .slice(0, count)
      .map((entry) => entry.item)
  const bursty = plan() < 0.5
  const stream = (value: string) =>
    bursty
      ? Llm.text(value, { delay: int(25, 40) / speed, chunkSize: int(12, 28) })
      : Llm.text(value, { delay: 10 / speed, chunkSize: 10 })
  const pause = () => (bursty ? [Llm.pause(int(100, 300) / speed)] : [])
  const call = (name: string, input: Record<string, string | boolean>, index = 0) =>
    Llm.toolCall({ index, id: `call_${crypto.randomUUID().replaceAll("-", "")}`, name, input })
  const prose = () => `${some(sentences, int(3, 5)).join(" ")}\n\n`
  const list = () =>
    `${one(headings)}\n\n${some(items, int(3, 6))
      .map((item, index) => `${index + 1}. ${item}`)
      .join("\n")}\n\n`
  const block = () => `${one(intros)}\n\n\`\`\`ts\n${one(snippets)}\n\`\`\`\n\n`
  const piece = () => one([prose, prose, list, block])()
  const lead = (first: boolean) => [
    ...(first ? [Llm.reasoning(one(thoughts), { delay: 14 / speed, chunkSize: 6 }), ...pause()] : []),
    ...Array.from({ length: int(1, 2) }, () => [stream(piece()), ...pause()]).flat(),
  ]

  const picked = [
    ...Array.from({ length: int(1, 3, plan) }, () => "shell"),
    ...(plan() < 0.7 ? ["patch"] : []),
    ...(plan() < 0.7 ? ["reads"] : []),
    ...(plan() < 0.35 ? [plan() < 0.5 ? "subagent" : "background"] : []),
  ]
  // At least three tool steps, so even a short plan scrolls past a screen.
  const kinds = [...picked, ...["patch", "reads"].filter((kind) => !picked.includes(kind))]
    .slice(0, Math.max(3, picked.length))
    .toSorted(() => plan() - 0.5)
    .slice(0, 5)
  const kind = kinds[step]
  if (kind === undefined) return Stream.make(stream(`${one(summaries)}\n\n${prose()}${random() < 0.5 ? list() : ""}`))
  const outputs = lead(step === 0)
  const tools = (...calls: Llm.Output[]) => Stream.make(...outputs, ...calls, Llm.finish("tool-calls"))
  if (kind === "shell") {
    const label = one(["lanterns", "tides", "charts", "moorings", "beacons"])
    return tools(
      stream(`Building the ${label}.`),
      call("shell", {
        command: `sh scripts/build.sh ${int(6, 12)} ${speed} ${label}`,
        description: `Build ${label}`,
        workdir: directory,
      }),
    )
  }
  if (kind === "patch")
    return tools(stream("Retiming the North Mole lantern."), call("patch", { patchText: patch(directory) }))
  if (kind === "reads")
    return tools(
      stream("Reading the harbor files."),
      ...files.slice(0, int(2, files.length)).map((file, at) => call("read", { path: `${directory}/${file}` }, at)),
    )
  if (kind === "subagent")
    return tools(
      call("subagent", {
        agent: "surveyor",
        description: "Survey the breakwater",
        prompt: `[demo:child ${speed}×] Walk the breakwater and report any loose stones.`,
        background: true,
      }),
    )
  return tools(
    call("shell", {
      command: `sh scripts/preview.sh ${speed}`,
      description: "Lantern preview",
      workdir: directory,
      background: true,
    }),
  )
}

function mulberry(seed: number) {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const files = ["README.md", "src/harbor.ts", "src/tides.ts", "src/fleet.ts", "docs/pilots.md"]

const thoughts = [
  "Working out which lanterns drift out of phase before the spring tide, and what to rebuild first.",
  "The pilot boat leaves two hours before high water, so the beacon map has to be current by then.",
  "Checking the mooring charts against last week's survey before touching the lantern config.",
]

const sentences = [
  "The North Mole lantern runs on a four second interval, and the Lantern Quay on six.",
  "Fog usually lifts in layers here: masts first, then the net sheds, then the breakwater.",
  "The tide tables in the pilot's hut lag the gauges by a few minutes every morning.",
  "Two capstones near the East Buoy shifted during the last storm and need resetting.",
  "Fishing boats slip their moorings while the lanterns along the mole are still turning.",
  "The harbor master wants every beacon in phase before the pilot boat leaves.",
  "Spring tides bring the water within a hand's width of the quay steps.",
  "The beacon map rebuilds whenever a lantern's interval or colour changes.",
  "Gannet and Kittiwake share the inner berth, so their mooring lines cross at low water.",
  "The saltmarsh gate only opens in the hour either side of high water.",
  "Most of the fleet is back before noon, when the wind turns onshore.",
  "The amber lanterns read better through fog than the old white ones did.",
]

const headings = ["**Next steps**", "**What changed**", "**Before the spring tide**", "**Open questions**"]

const items = [
  "Reset the two capstones by the East Buoy at the next low tide.",
  "Bring the Lantern Quay into phase with the North Mole.",
  "Repaint the pilot steps before the equinox.",
  "Check the saltmarsh gate hinges after the storm.",
  "Move Shearwater to the outer berth for the week.",
  "Re-run the tide checks once the new gauge is fitted.",
  "Swap the last white lantern for amber.",
  "Add the breakwater survey to the harbor log.",
]

const intros = ["The schedule helper now reads:", "Here is the phase check:", "The berth assignment looks like this:"]

const snippets = [
  [
    "export function nextFlash(lantern: { intervalMs: number; offsetMs: number }, now: number) {",
    "  const elapsed = (now - lantern.offsetMs) % lantern.intervalMs",
    "  return now + lantern.intervalMs - elapsed",
    "}",
  ].join("\n"),
  [
    "export const inPhase = (a: Lantern, b: Lantern) =>",
    "  a.intervalMs === b.intervalMs && a.offsetMs === b.offsetMs",
    "",
    "export function drift(lanterns: Lantern[]) {",
    "  return lanterns.filter((lantern) => !inPhase(lantern, lanterns[0]))",
    "}",
  ].join("\n"),
  [
    "const berths = new Map([",
    '  ["inner", ["Gannet", "Kittiwake"]],',
    '  ["outer", ["Shearwater"]],',
    "])",
    "",
    "export function berthOf(boat: string) {",
    "  return [...berths].find(([, boats]) => boats.includes(boat))?.[0]",
    "}",
  ].join("\n"),
]

const summaries = [
  "All the lanterns are rebuilt and in phase, and the tide checks pass.",
  "The beacon map is current, the patch is in, and the builds are clean.",
  "Everything the pilot boat needs is ready ahead of high water.",
]

// Drive's SDK client trails the server protocol, so the session is created over plain HTTP with the isolated
// server's own registration.
async function createSession(artifacts: string, directory: string) {
  const registration: { url: string; password?: string } = await Bun.file(
    `${artifacts}/home/.local/state/opencode/service-local.json`,
  ).json()
  const headers = {
    "content-type": "application/json",
    ...(registration.password ? { authorization: `Basic ${btoa(`opencode:${registration.password}`)}` } : {}),
  }
  const response = await fetch(`${registration.url}/api/session`, {
    method: "POST",
    headers,
    // An explicit agent and model, so the composer can send before it has resolved the defaults.
    body: JSON.stringify({
      title: "Timeline demo",
      location: { directory },
      agent: "build",
      model: { providerID: "simulation", id: "gpt-sim-model" },
    }),
  })
  const created = (await response.json()) as { data: { id: string } }
  return { id: created.data.id, server: registration }
}
