import { expect, test } from "bun:test"
import path from "node:path"
import { type FetchRequest, LiveWidget, ManualClock, type Node, program, type Transport } from "../src/index.js"
import { LIVE } from "./limits.js"

// The live guidance's examples, by their heading, so the doc can't drift from what runs.
const guidance = await Bun.file(path.resolve(import.meta.dir, "../docs/live-guidance.md")).text()
const example = (heading: string) => {
  const section = guidance.slice(guidance.indexOf(heading))
  return section.slice(section.indexOf("```js\n") + 6, section.indexOf("\n```", section.indexOf("```js\n")))
}

const texts = (node: Node | undefined): string[] =>
  node
    ? [...(node.type === "text" ? [node.text] : []), ...("children" in node ? node.children.flatMap(texts) : [])]
    : []

test("the game example plays and submits its score", async () => {
  const clock = new ManualClock()
  const widget = LiveWidget.start(
    program(example("## Example: a small game"), "live"),
    { title: "Catch", seconds: 2 },
    { clock, ...LIVE },
  )
  const taps = { hits: 0 }
  for (let frame = 0; !texts(widget.view).some((text) => text.startsWith("You caught")); frame++) {
    await widget.when((current) => current.frameRequested || texts(current.view).some((text) => text.startsWith("You")))
    if (!widget.frameRequested) break
    const ball = widget.drawings.get("0/:court")?.find((command) => command[0] === "circle")
    if (ball && frame % 10 === 0) {
      widget.event({
        id: "0/:court",
        type: "pointer",
        value: { kind: "down", x: ball[1], y: ball[2], width: 300, height: 240 },
      })
      taps.hits++
    }
    await clock.advance(16)
    widget.frame({ t: frame / 60, dt: 0.016, width: 300, height: 240, scale: 2, pointer: null, dark: false })
    await widget.when((current) => !current.frameRequested || current.ended !== undefined)
  }
  await widget.when((current) => texts(current.view).some((text) => text.startsWith("You caught")))
  widget.event({ id: "0/1", type: "press" })
  const end = await widget.done
  expect(end.type).toBe("submit")
  expect(end.type === "submit" && (end.value as { score: number }).score).toBeGreaterThan(5)
})

test("the dashboard example polls, refreshes on demand and when resumed, and shows errors", async () => {
  const requests: FetchRequest[] = []
  const status = { code: 200, stars: 40 }
  const transport: Transport = async (request) => {
    requests.push(request)
    status.stars++
    return {
      status: status.code,
      headers: { "content-type": "application/json" },
      body: new TextEncoder().encode(
        JSON.stringify({ stargazers_count: status.stars, forks_count: 3, open_issues_count: 7 }),
      ),
    }
  }
  const clock = new ManualClock()
  const widget = LiveWidget.start(
    program(example("## Example: a live dashboard"), "live"),
    { repo: "anomalyco/opencode", seconds: 30 },
    { clock, ...LIVE, transport, capabilities: { https: { hosts: ["api.github.com"] } } },
  )
  const showing = (text: string) => widget.when((current) => texts(current.view).includes(text))
  await showing("★ 41")
  expect(texts(widget.view)).toContain("Open issues 7")
  expect(requests[0]).toEqual({
    url: "https://api.github.com/repos/anomalyco/opencode",
    method: "GET",
    headers: { accept: "application/vnd.github+json" },
  })
  await clock.advance(30_000)
  await showing("★ 42")
  widget.event({ id: "0/3", type: "press" })
  await showing("★ 43")
  widget.pause()
  await clock.advance(120_000)
  expect(requests).toHaveLength(3)
  status.code = 503
  widget.resume()
  await showing("Couldn't refresh: GitHub answered 503")
  expect(texts(widget.view)).toContain("★ 43")
  await widget.stop()
})
