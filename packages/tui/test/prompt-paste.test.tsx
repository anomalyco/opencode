import { expect, test } from "bun:test"
import { takeDraft } from "../src/component/prompt/draft-stash"
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

test.each(["whole", "fragment"])("undo submits the restored %s paste chip", async (kind) => {
  const sessionID = `ses_paste_${crypto.randomUUID()}`
  const prompted = Promise.withResolvers<string>()
  await using setup = await createAppFixture({
    args: { sessionID },
    fetch: async (url, request) => {
      const location = { directory }
      if (url.pathname === "/api/agent") return json({ location, data: [agent("build")] })
      if (url.pathname === "/api/model") return json({ location, data: [model("Paste Model")] })
      if (url.pathname === `/api/session/${sessionID}`) return json({ data: session(sessionID) })
      if (url.pathname.endsWith("/message") || url.pathname.endsWith("/inbox")) return json({ data: [], cursor: {} })
      if (url.pathname.endsWith("/prompt")) {
        prompted.resolve((await request.json()).text)
        return json({ data: {} })
      }
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Paste Model"))
  const pasted = "one\ntwo\nthree\nfour"
  const text = () => setup.renderer.currentFocusedEditor?.plainText
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
  expect(await prompted.promise).toBe(kind === "whole" ? `${pasted} ` : "[Pasted ~4 ")
})
