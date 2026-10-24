import { expect, test } from "bun:test"
import path from "node:path"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
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

test("clicking a pasted image expands its path without submitting the attachment", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "one image.png")
  await Bun.write(file, new Uint8Array([1, 2, 3]))
  const sessionID = `ses_image_path_${crypto.randomUUID()}`
  const submitted = Promise.withResolvers<unknown>()
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  await using setup = await createAppFixture({
    width: 100,
    height: 30,
    args: { sessionID },
    fetch: async (url, request) => {
      if (url.pathname === `/api/session/${sessionID}`)
        return json({ data: session(sessionID, { providerID: "provider", id: "model" }) })
      if (url.pathname === `/api/session/${sessionID}/message` || url.pathname === `/api/session/${sessionID}/inbox`)
        return json({ data: [], cursor: {} })
      if (url.pathname === "/api/agent")
        return json({ location, data: [agent("build")] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ ...model("model"), name: "Demo Model" }] })
      if (url.pathname === `/api/session/${sessionID}/prompt`) {
        submitted.resolve(await request.json())
        return json({ data: {} })
      }
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Demo Model"))
  await setup.mockInput.pasteBracketedText(`"${file}"`)
  const frame = await setup.waitForFrame((frame) => frame.includes("[Image 1]"))
  const rows = frame.split("\n")
  const row = rows.findIndex((line) => line.includes("[Image 1]"))
  await setup.mockMouse.click(rows[row].indexOf("[Image 1]") + 2, row)
  await setup.waitFor(() => setup.renderer.currentFocusedEditor?.plainText === `"${file}" `)
  setup.mockInput.pressEnter()
  expect(await submitted.promise).toMatchObject({ text: `"${file}" `, files: [] })
})
