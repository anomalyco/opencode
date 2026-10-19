/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RunFormBody } from "../../src/mini/footer.form"
import { RUN_THEME_FALLBACK } from "../../src/mini/theme"
import type { FormReply, MiniFormRequest } from "../../src/mini/types"

const request: MiniFormRequest = {
  id: "frm_screen_reader",
  sessionID: "ses_screen_reader",
  title: "Deployment",
  fields: [
    {
      key: "target",
      type: "string",
      title: "Target",
      options: [
        { value: "stage", label: "Staging" },
        { value: "prod", label: "Production" },
      ],
    },
  ],
}

async function press(screenReader: boolean, ...keys: string[]) {
  const replies: FormReply[] = []
  const app = await testRender(
    () => (
      <RunFormBody
        request={request}
        theme={RUN_THEME_FALLBACK.footer}
        onReply={(reply) => {
          replies.push(reply)
        }}
        onCancel={() => {}}
        screenReader={screenReader}
      />
    ),
    { width: 60, height: 12, kittyKeyboard: true },
  )
  try {
    await app.renderOnce()
    for (const key of keys) {
      if (key === "enter") app.mockInput.pressEnter()
      else app.mockInput.pressKey(key)
      await app.renderOnce()
    }
    return replies
  } finally {
    app.renderer.destroy()
  }
}

test("a digit submits the choice outside screen reader mode", async () => {
  expect((await press(false, "2"))[0]?.answer).toEqual({ target: "prod" })
})

test("a digit only selects in screen reader mode and Enter confirms", async () => {
  expect(await press(true, "2")).toEqual([])
  expect((await press(true, "2", "enter"))[0]?.answer).toEqual({ target: "prod" })
})
