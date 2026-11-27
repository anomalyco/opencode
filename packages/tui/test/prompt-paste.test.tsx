import { expect, test } from "bun:test"
import { saveDraft, takeDraft } from "../src/component/prompt/draft-stash"
import { emptyPrompt, type PromptFile, type PromptInfo } from "../src/prompt/history"
import { tmpdir } from "./fixture/fixture"
import path from "node:path"
import { createAppFixture } from "./fixture/app"
import { agent, model, session } from "./fixture/local"
import { directory, json } from "./fixture/tui-client"

test("the prompt keeps pasted control characters and drops escape sequences", async () => {
  // Other app tests can leave a home draft in the process-wide stash.
  takeDraft(undefined)
  await using setup = await createAppFixture()
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("commands"))
  await setup.mockInput.typeText("x")
  await setup.waitForFrame((frame) => frame.includes("x"))
  await setup.mockInput.pasteBracketedText("a\fb\u001b[31mc\u0000d")
  await setup.waitForFrame((frame) => frame.includes("xa^Lbc^@d"))
  expect(setup.renderer.currentFocusedEditor?.plainText).toBe("xa\fbc\0d")
})

async function promptApp(seed?: PromptInfo) {
  const sessionID = `ses_paste_${crypto.randomUUID()}`
  const prompted = Promise.withResolvers<any>()
  if (seed) saveDraft(sessionID, { prompt: seed, cursor: Infinity })
  const setup = await createAppFixture({
    args: { sessionID },
    fetch: async (url, request) => {
      const location = { directory }
      if (url.pathname === "/api/agent") return json({ location, data: [agent("build")] })
      if (url.pathname === "/api/model") return json({ location, data: [model("Paste Model")] })
      if (url.pathname === `/api/session/${sessionID}`) return json({ data: session(sessionID) })
      if (url.pathname.endsWith("/message") || url.pathname.endsWith("/inbox")) return json({ data: [], cursor: {} })
      if (url.pathname.endsWith("/prompt")) {
        prompted.resolve(await request.json())
        return json({ data: {} })
      }
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Paste Model"))
  return { setup, prompted: prompted.promise, text: () => setup.renderer.currentFocusedEditor?.plainText }
}

test.each(["whole", "fragment"])("undo submits the restored %s paste chip", async (kind) => {
  const { setup, prompted, text } = await promptApp()
  await using _ = setup
  const pasted = "one\ntwo\nthree\nfour"
  await setup.mockInput.pasteBracketedText(pasted)
  await setup.waitFor(() => text() === "[Pasted ~4 lines] ")
  if (kind === "fragment") {
    setup.mockInput.pressBackspace() // Remove the space after the chip.
    setup.mockInput.pressKey("w", { ctrl: true }) // Leave a fragment of the chip.
  }
  setup.mockInput.pressKey("u", { ctrl: true })
  await setup.waitFor(() => text() === "")
  setup.mockInput.pressKey("z", { super: true })
  await setup.waitFor(() => text() === (kind === "whole" ? "[Pasted ~4 lines] " : "[Pasted ~4 "))
  setup.mockInput.pressEnter()
  expect((await prompted).text).toBe(kind === "whole" ? `${pasted} ` : "[Pasted ~4 ")
})

test("a pasted image that reuses a wide label gets a chip as wide as the label", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "a.png")
  await Bun.write(file, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  const uri = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`
  // "[图片 1]" is 6 string units and 8 cells.
  const label = "[图片 1]"
  const { setup, prompted, text } = await promptApp({
    ...emptyPrompt(),
    text: `${label} `,
    files: [{ uri, name: "a.png", mention: { start: 0, end: 8, text: label } }],
  })
  await using _ = setup
  await setup.waitFor(() => text() === `${label} `)
  await setup.mockInput.pasteBracketedText(file)
  await setup.waitFor(() => text() === `${label} ${label} `)
  setup.mockInput.pressEnter()
  expect((await prompted).files.map((file: PromptFile) => file.mention)).toEqual([
    { start: 0, end: 8, text: label },
    { start: 9, end: 17, text: label },
  ])
})

// A one-row prompt that missed the growth would show only the cursor's line.
test.each([
  ["a plugin append", "ALPHA\nBRAVO\nCHARLIE\nDELTA"],
  ["an inline paste", "ALPHA\nBRAVO"],
])("%s grows the prompt in the first frame that shows it", async (kind, lines) => {
  const { setup, text } = await promptApp()
  await using _ = setup
  if (kind === "an inline paste") await setup.mockInput.pasteBracketedText(lines)
  else
    setup.events.emit({
      id: "evt_append",
      created: 1,
      type: "tui.prompt.append",
      data: { text: lines },
      location: { directory },
    })
  const frame = await setup.waitForFrame((frame) => lines.split("\n").some((line) => frame.includes(line)))
  for (const line of lines.split("\n")) expect(frame).toContain(line)
  expect(setup.renderer.currentFocusedEditor?.cursorOffset).toBe(text()?.length)
})

const mention = (text: string) => ({ start: 4, end: 4 + text.length, text })
test.each([
  ["files", { uri: "file:///repo/a.ts", name: "a.ts", mention: mention("@a.ts") }],
  ["agents", { name: "explore", mention: mention("@explore") }],
  ["skills", { id: "review", mention: mention("@review") }],
] as const)("undo submits the restored %s chip with its attachment", async (kind, part) => {
  const { setup, prompted, text } = await promptApp({
    ...emptyPrompt(),
    text: `see ${part.mention.text} `,
    [kind]: [structuredClone(part)],
  })
  await using _ = setup
  await setup.waitFor(() => text() === `see ${part.mention.text} `)
  setup.mockInput.pressKey("u", { ctrl: true })
  await setup.waitFor(() => text() === "")
  setup.mockInput.pressKey("z", { super: true })
  await setup.waitFor(() => text() === `see ${part.mention.text} `)
  setup.mockInput.pressEnter()
  expect((await prompted)[kind]).toEqual([part])
})
