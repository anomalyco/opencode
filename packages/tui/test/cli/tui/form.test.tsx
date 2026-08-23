/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onMount, Show } from "solid-js"
import { DataProvider, useData, type FormWithLocation } from "../../../src/context/data"
import { ClientProvider } from "../../../src/context/client"
import { ThemeProvider } from "../../../src/context/theme"
import { Keymap } from "../../../src/context/keymap"
import { ConfigProvider } from "../../../src/config"
import { ToastProvider } from "../../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createApi, createEventStream, createFetch, json } from "../../fixture/tui-client"

async function mountForm(
  root: string,
  width = 80,
  fields?: FormWithLocation["fields"],
  height = 20,
  clipboardText?: string,
  response?: { reply?: 404 | 409; cancel?: 404 | 409; syncFailure?: boolean },
) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })

  const replies: unknown[] = []
  const cancellations: unknown[] = []
  const copied: string[] = []
  let terminal = false
  let formLists = 0
  const events = createEventStream()
  const config = createTuiResolvedConfig()
  const form = {
    id: "frm_test",
    sessionID: "ses_test",
    title: "Authorization required",
    fields: fields ?? [
      {
        key: "authorization",
        type: "external",
        url: "https://example.com/authorize",
        title: "Authorize access",
      },
    ],
  } satisfies FormWithLocation
  const failure = (status: 404 | 409) => {
    terminal = true
    return json(
      {
        _tag: status === 404 ? "FormNotFoundError" : "FormAlreadySettledError",
        id: form.id,
        message: status === 404 ? `Form not found: ${form.id}` : `Form already settled: ${form.id}`,
      },
      { status },
    )
  }
  const transport = createFetch((url, request) => {
    if (url.pathname === "/api/session/ses_test/form" && request.method === "GET")
      return response?.syncFailure && formLists++ > 0
        ? json({ message: "Could not refresh forms" }, { status: 500 })
        : json({ data: terminal ? [] : [form] })
    if (url.pathname === "/api/session/ses_test/form/frm_test/reply")
      return request.json().then((answer) => {
        replies.push(answer)
        return response?.reply ? failure(response.reply) : new Response(null, { status: 204 })
      })
    if (url.pathname === "/api/session/ses_test/form/frm_test/cancel") {
      cancellations.push(true)
      return response?.cancel ? failure(response.cancel) : new Response(null, { status: 204 })
    }
  }, events)
  const { FormPrompt } = await import("../../../src/routes/session/form")

  function CurrentForm() {
    const data = useData()
    onMount(() => void data.session.form.sync(form.sessionID))
    return (
      <Show when={data.session.form.list(form.sessionID)?.[0]} keyed fallback={<text>Composer ready</text>}>
        {(current) => <FormPrompt form={current} />}
      </Show>
    )
  }

  function Harness() {
    return (
      <TestTuiContexts
        directory={root}
        paths={{
          home: root,
          state,
          worktree: root,
        }}
        clipboard={{
          async read() {
            return clipboardText === undefined ? undefined : { data: clipboardText, mime: "text/plain" }
          },
          write(text) {
            copied.push(text)
            return Promise.resolve()
          },
        }}
      >
        <ConfigProvider config={config}>
          <Keymap.Provider>
            <ClientProvider api={createApi(transport.fetch)}>
              <DataProvider>
                <ThemeProvider mode="dark" source={emptyThemeSource}>
                  <ToastProvider>{response ? <CurrentForm /> : <FormPrompt form={form} />}</ToastProvider>
                </ThemeProvider>
              </DataProvider>
            </ClientProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width, height, kittyKeyboard: true })
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Authorization required"))
  return { app, cancellations, copied, replies }
}

function mountRecoveringForm(root: string, response: { reply?: 404 | 409; cancel?: 404 | 409; syncFailure?: boolean }) {
  return mountForm(
    root,
    80,
    [{ key: "target", type: "string", options: [{ value: "staging", label: "Staging" }] }],
    20,
    undefined,
    response,
  )
}

test("restores the composer when terminal-form revalidation fails", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountRecoveringForm(tmp.path, { reply: 404, syncFailure: true })
  try {
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitForFrame((frame) => frame.includes("Composer ready"))

    expect(prompt.replies).toHaveLength(1)
  } finally {
    prompt.app.renderer.destroy()
  }
})

for (const status of [404, 409] as const) {
  test(`restores the composer after a terminal ${status} reply`, async () => {
    await using tmp = await tmpdir()
    const prompt = await mountRecoveringForm(tmp.path, { reply: status })
    try {
      prompt.app.mockInput.pressEnter()
      await prompt.app.waitForFrame((frame) => frame.includes("Composer ready"))

      expect(prompt.replies).toHaveLength(1)
      expect(prompt.app.captureCharFrame()).not.toContain("Form not found")
      expect(prompt.app.captureCharFrame()).not.toContain("Form already settled")
    } finally {
      prompt.app.renderer.destroy()
    }
  })

  test(`restores the composer after a terminal ${status} cancellation`, async () => {
    await using tmp = await tmpdir()
    const prompt = await mountRecoveringForm(tmp.path, { cancel: status })
    try {
      prompt.app.mockInput.pressEscape()
      await prompt.app.waitForFrame((frame) => frame.includes("Composer ready"))

      expect(prompt.cancellations).toHaveLength(1)
      expect(prompt.app.captureCharFrame()).not.toContain("Form not found")
      expect(prompt.app.captureCharFrame()).not.toContain("Form already settled")
    } finally {
      prompt.app.renderer.destroy()
    }
  })
}

test("requires explicit acknowledgement before submitting an external field", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path)
  try {
    prompt.app.mockInput.pressKey("right")
    await prompt.app.waitForFrame((frame) => frame.includes("(acknowledgement required)"))
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitForFrame((frame) => frame.includes("External action must be acknowledged"))
    expect(prompt.replies).toEqual([])

    prompt.app.mockInput.pressKey("left")
    prompt.app.mockInput.pressKey("c")
    await prompt.app.waitForFrame((frame) => frame.includes("press enter to confirm"))
    expect(prompt.copied).toEqual(["https://example.com/authorize"])
    expect(prompt.replies).toEqual([])

    prompt.app.mockInput.pressEnter()
    await prompt.app.waitForFrame((frame) => frame.includes("Acknowledged"))
    expect(prompt.replies).toEqual([])

    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { authorization: true } }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("includes external acknowledgements in progress", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 32)
  try {
    expect(prompt.app.captureCharFrame()).toContain("0/1")
    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("shows a compact confirmation summary", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [
    {
      key: "targets",
      type: "multiselect",
      options: [{ value: "staging", label: "Staging" }],
      default: ["staging"],
    },
  ])
  try {
    prompt.app.mockInput.pressArrow("right")
    await prompt.app.waitForFrame((frame) => frame.includes("enter submit"))

    const frame = prompt.app.captureCharFrame()
    expect(frame).not.toContain("Review")
    expect(frame).not.toContain("Submit answers")

    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { targets: ["staging"] } }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("confirmation fits wrapped answers before offering scroll", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(
    tmp.path,
    48,
    [
      {
        key: "targets",
        title: "Include",
        type: "multiselect",
        options: [
          {
            value: "a very long selected deliverable that wraps",
            label: "A very long selected deliverable that wraps",
          },
        ],
        default: ["a very long selected deliverable that wraps"],
      },
      {
        key: "priority",
        title: "Priority",
        type: "multiselect",
        options: [{ value: "now", label: "Now" }],
        default: ["now"],
      },
    ],
    40,
  )
  try {
    expect(prompt.app.captureCharFrame()).toContain("Include  Priority  Submit")
    prompt.app.mockInput.pressArrow("right")
    prompt.app.mockInput.pressArrow("right")
    await prompt.app.waitForFrame((frame) => frame.includes("Priority: Now") && frame.includes("enter submit"))

    const frame = prompt.app.captureCharFrame()
    expect(frame).not.toContain("↑↓ scroll")
    const lines = frame.split("\n")
    expect(lines.findIndex((line) => line.includes("enter submit"))).toBeLessThan(20)
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("pasting on a custom choice opens its editor without submitting", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [
    {
      key: "target",
      type: "string",
      options: [{ value: "staging", label: "Staging" }],
      custom: true,
    },
  ])
  try {
    await prompt.app.mockInput.pasteBracketedText("production\nwest")
    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor?.plainText === "production\nwest")

    await prompt.app.waitForFrame((frame) => frame.includes("production"))
    expect(prompt.app.captureCharFrame()).not.toContain("Type your own answer")
    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("clipboard shortcut opens a custom choice editor without submitting", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(
    tmp.path,
    80,
    [
      {
        key: "target",
        type: "string",
        options: [{ value: "staging", label: "Staging" }],
        custom: true,
      },
    ],
    20,
    "production\nwest",
  )
  try {
    prompt.app.mockInput.pressKey("v", { ctrl: true })
    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor?.plainText === "production\nwest")

    await prompt.app.waitForFrame((frame) => frame.includes("production"))
    expect(prompt.app.captureCharFrame()).not.toContain("Type your own answer")
    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("typing a custom multiselect answer selects it before commit", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [
    {
      key: "targets",
      type: "multiselect",
      options: [{ value: "staging", label: "Staging" }],
      custom: true,
      minItems: 1,
    },
  ])
  try {
    prompt.app.mockInput.pressArrow("down")
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor !== null)
    await prompt.app.mockInput.typeText("production")
    await prompt.app.waitForFrame((frame) => frame.includes("[✓] production"))

    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("up leaves a custom editor only from its first visual line", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [
    {
      key: "targets",
      type: "multiselect",
      options: [{ value: "staging", label: "Staging" }],
      custom: true,
    },
  ])
  try {
    prompt.app.mockInput.pressArrow("down")
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor !== null)
    const editor = prompt.app.renderer.currentFocusedEditor
    editor?.setText("production\nwest")
    if (editor) editor.cursorOffset = editor.plainText.length
    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor?.visualCursor.visualRow === 1)

    prompt.app.mockInput.pressArrow("up")
    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor?.visualCursor.visualRow === 0)
    expect(prompt.app.renderer.currentFocusedEditor).not.toBeNull()

    prompt.app.mockInput.pressArrow("up")
    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor === null)
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitForFrame((frame) => frame.includes("[✓] Staging"))
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("typing on the highlighted custom option opens it without losing burst input", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [
    {
      key: "targets",
      type: "multiselect",
      options: [{ value: "staging", label: "Staging" }],
      custom: true,
    },
  ])
  try {
    prompt.app.mockInput.pressArrow("down")
    await prompt.app.mockInput.typeText("production target")
    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor?.plainText === "production target")
    await prompt.app.waitForFrame((frame) => frame.includes("[✓] production target"))

    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("enter on an empty custom multiselect option clearly enters editing", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [
    {
      key: "targets",
      type: "multiselect",
      options: [{ value: "staging", label: "Staging" }],
      custom: true,
      minItems: 1,
    },
  ])
  try {
    prompt.app.mockInput.pressArrow("down")
    await prompt.app.waitForFrame((frame) => frame.includes("enter edit"))

    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor !== null)
    await prompt.app.waitForFrame((frame) => frame.includes("[✓] Type your own answer") && frame.includes("enter done"))
    expect(prompt.app.captureCharFrame()).toContain("esc close")
    expect(prompt.app.captureCharFrame()).not.toContain("↑↓ select")

    prompt.app.mockInput.pressEscape()
    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor === null)
    await prompt.app.waitForFrame((frame) => frame.includes("[ ] Type your own answer"))

    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor !== null)
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor === null)
    await prompt.app.waitForFrame((frame) => frame.includes("[ ] Type your own answer"))
    expect(prompt.app.captureCharFrame()).not.toContain("Select at least")

    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("defers multiselect validation until submission", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [
    {
      key: "targets",
      type: "multiselect",
      options: [{ value: "staging", label: "Staging" }],
      required: true,
      minItems: 1,
    },
    {
      key: "priority",
      type: "multiselect",
      options: [{ value: "now", label: "Now" }],
    },
  ])
  try {
    prompt.app.mockInput.pressEnter()
    prompt.app.mockInput.pressEnter()
    prompt.app.mockInput.pressArrow("right")
    await prompt.app.waitForFrame((frame) => frame.includes("[ ] Now"))
    expect(prompt.app.captureCharFrame()).not.toContain("Select at least")

    prompt.app.mockInput.pressArrow("right")
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitForFrame((frame) => frame.includes("Select at least"))
    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("submits an optional empty multiselect as an omitted answer", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [
    {
      key: "targets",
      type: "multiselect",
      options: [{ value: "staging", label: "Staging" }],
      minItems: 1,
    },
    {
      key: "priority",
      type: "multiselect",
      options: [{ value: "now", label: "Now" }],
      default: ["now"],
    },
  ])
  try {
    prompt.app.mockInput.pressEnter()
    prompt.app.mockInput.pressEnter()
    prompt.app.mockInput.pressArrow("right")
    prompt.app.mockInput.pressArrow("right")
    prompt.app.mockInput.pressEnter()

    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { priority: ["now"] } }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("typing a custom single-select answer selects it without submitting", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [
    {
      key: "target",
      type: "string",
      options: [{ value: "staging", label: "Staging" }],
      custom: true,
    },
  ])
  try {
    prompt.app.mockInput.pressArrow("down")
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor !== null)
    await prompt.app.mockInput.typeText("production")
    await prompt.app.waitForFrame((frame) => frame.includes("production"))

    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("committing a custom multiselect answer keeps one editable custom row", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [
    {
      key: "targets",
      type: "multiselect",
      options: [{ value: "staging", label: "Staging" }],
      custom: true,
    },
  ])
  try {
    await prompt.app.mockInput.pasteBracketedText("production")
    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor?.plainText === "production")
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitForFrame((frame) => frame.includes("2. [✓] production"))

    const frame = prompt.app.captureCharFrame()
    expect(frame).not.toContain("Type your own answer")
    expect(frame).not.toContain("3.")
    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("text fields retain default paste behavior", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [{ key: "notes", type: "string" }])
  try {
    await prompt.app.mockInput.pasteBracketedText("normal paste")

    expect(prompt.app.renderer.currentFocusedEditor?.plainText).toBe("normal paste")
    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("pasting on a choice without custom answers does not open an editor", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [
    {
      key: "target",
      type: "string",
      options: [{ value: "staging", label: "Staging" }],
    },
  ])
  try {
    await prompt.app.mockInput.pasteBracketedText("production")

    expect(prompt.app.renderer.currentFocusedEditor).toBeNull()
    expect(prompt.app.captureCharFrame()).not.toContain("production")
    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("space toggles the selected multiselect option", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [
    {
      key: "targets",
      type: "multiselect",
      options: [
        { value: "staging", label: "Staging" },
        { value: "production", label: "Production" },
      ],
    },
  ])
  try {
    prompt.app.mockInput.pressKey(" ")
    await prompt.app.waitForFrame((frame) => frame.includes("[✓] Staging"))
    expect(prompt.replies).toEqual([])

    prompt.app.mockInput.pressKey(" ")
    await prompt.app.waitForFrame((frame) => frame.includes("[ ] Staging"))
    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("keeps a visible space between a multiselect marker and wrapped label", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 58, [
    {
      key: "targets",
      type: "multiselect",
      options: [
        {
          value: "responsive verification across narrow and wide terminal layouts",
          label: "Responsive verification across narrow and wide terminal layouts",
        },
      ],
      default: ["responsive verification across narrow and wide terminal layouts"],
    },
  ])
  try {
    expect(prompt.app.captureCharFrame()).toContain("[✓] Responsive verification")
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("space activates the custom multiselect option", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [
    {
      key: "targets",
      type: "multiselect",
      options: [{ value: "staging", label: "Staging" }],
      custom: true,
    },
  ])
  try {
    prompt.app.mockInput.pressArrow("down")
    prompt.app.mockInput.pressKey(" ")

    await prompt.app.waitFor(() => prompt.app.renderer.currentFocusedEditor !== null)
    await prompt.app.waitForFrame((frame) => frame.includes("[✓] Type your own answer"))
    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("space does not select a single-choice option", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, 80, [
    {
      key: "target",
      type: "string",
      options: [{ value: "staging", label: "Staging" }],
    },
  ])
  try {
    prompt.app.mockInput.pressKey(" ")
    expect(prompt.app.captureCharFrame()).not.toContain("Staging ✓")
    expect(prompt.replies).toEqual([])
  } finally {
    prompt.app.renderer.destroy()
  }
})
