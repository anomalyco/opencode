/** @jsxImportSource @opentui/solid */
// Regression coverage for #40953. Form and permission prompts expose their
// option navigation and primary action as named keymap commands, so a TUI
// plugin can discover and dispatch them through the reachable command registry.
// The suite guards that those commands are reachable and dispatchable while
// their owning prompt state is active, that they disappear once that state or
// the prompt itself goes away, and that the existing keyboard bindings keep
// invoking the same component-owned handlers.
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { PermissionRequest } from "@opencode-ai/client"
import { ClipboardProvider } from "../../../src/context/clipboard"
import type { FormWithLocation } from "../../../src/context/data"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider, useData } from "../../../src/context/data"
import { LocationProvider, useLocation } from "../../../src/context/location"
import { ThemeProvider } from "../../../src/context/theme"
import { Keymap } from "../../../src/context/keymap"
import { ConfigProvider } from "../../../src/config"
import { ToastProvider } from "../../../src/ui/toast"
import { tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { createApi, createEventStream, createFetch, directory, json } from "../../fixture/tui-client"

// Mirrors how ../../../src/plugin/api.tsx exposes the keymap to plugins:
// `context.keymap.commands` is `host.keymapState.commands` and
// `context.keymap.dispatch` is `host.keymap.dispatch`, both sourced from
// `Keymap.useState()` / `Keymap.use()` -- exactly what this probe reads.
function CommandRegistryProbe(props: {
  onReady: (registry: { ids: () => readonly string[]; dispatch: (id: string, input?: string) => void }) => void
}) {
  const state = Keymap.useState()
  const keymap = Keymap.use()
  props.onReady({
    ids: () => state.commands().flatMap((command) => (command.id ? [command.id] : [])),
    dispatch: keymap.dispatch,
  })
  return null
}

function SyncLocation(props: { onReady: (data: ReturnType<typeof useData>) => void }) {
  const data = useData()
  const location = useLocation()
  location.set(data.location.default())
  props.onReady(data)
  return null
}

const optionForm = {
  id: "frm_test",
  sessionID: "ses_test",
  title: "Pick one",
  fields: [
    {
      key: "choice",
      type: "string",
      title: "Choice",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
  ],
} satisfies FormWithLocation

// Two fields walk the prompt through every state that owns `form.action`:
// selectable options, then a textual answer, then review.
const stagedForm = {
  id: "frm_test",
  sessionID: "ses_test",
  title: "Two steps",
  fields: [
    {
      key: "choice",
      type: "string",
      title: "Choice",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
    {
      key: "note",
      type: "string",
      title: "Note",
      default: "hi",
    },
  ],
} satisfies FormWithLocation

// `custom` adds a "Type your own answer" row, so selecting it hands the primary
// action from the option layer to the answer-edit layer.
const customForm = {
  id: "frm_test",
  sessionID: "ses_test",
  title: "Pick or type",
  fields: [
    {
      key: "choice",
      type: "string",
      title: "Choice",
      custom: true,
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
  ],
} satisfies FormWithLocation

// External fields never render selectable rows, so the prompt goes straight to
// the external state and then to review once acknowledged.
const externalForm = {
  id: "frm_test",
  sessionID: "ses_test",
  title: "Authorization required",
  fields: [
    {
      key: "authorization",
      type: "external",
      url: "https://example.com/authorize",
      title: "Authorize access",
    },
  ],
} satisfies FormWithLocation

// A string field without options is textual, so the prompt starts in the
// textarea-owned layer instead of the option layer.
const textForm = {
  id: "frm_test",
  sessionID: "ses_test",
  title: "Describe it",
  fields: [
    {
      key: "note",
      type: "string",
      title: "Note",
      default: "hi",
    },
  ],
} satisfies FormWithLocation

async function mountForm(root: string, form: FormWithLocation = optionForm) {
  const state = path.join(root, "state")
  await mkdir(state, { recursive: true })

  const replies: unknown[] = []
  const copied: string[] = []
  const events = createEventStream()
  const transport = createFetch(
    (url, request) =>
      url.pathname === "/api/session/ses_test/form/frm_test/reply"
        ? request.json().then((answer) => {
            replies.push(answer)
            return new Response(null, { status: 204 })
          })
        : undefined,
    events,
  )
  const config = createTuiResolvedConfig()

  const { FormPrompt } = await import("../../../src/routes/session/form")

  let registry = { ids: () => [] as readonly string[], dispatch: (_id: string, _input?: string) => {} }

  function Harness() {
    return (
      <TestTuiContexts
        directory={root}
        paths={{
          home: root,
          state,
          worktree: root,
        }}
      >
        <ClipboardProvider
          value={{
            write(text) {
              copied.push(text)
              return Promise.resolve()
            },
          }}
        >
          <ConfigProvider config={config}>
            <Keymap.Provider>
              <ClientProvider api={createApi(transport.fetch)}>
                <ThemeProvider mode="dark" source={{ discover: () => Promise.resolve({}) }}>
                  <ToastProvider>
                    <CommandRegistryProbe onReady={(value) => (registry = value)} />
                    <FormPrompt form={form} />
                  </ToastProvider>
                </ThemeProvider>
              </ClientProvider>
            </Keymap.Provider>
          </ConfigProvider>
        </ClipboardProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 20, kittyKeyboard: true })
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes(form.title))
  return { app, replies, copied, registry: () => registry }
}

// `parentID` makes the prompt route a rejection through `RejectPrompt` instead
// of replying immediately, the same way a subagent permission behaves.
async function mountPermission(root: string, options?: { parentID: string }) {
  const events = createEventStream()
  const replies: unknown[] = []
  const transport = createFetch((url, request) => {
    if (url.pathname === "/api/session/ses_test/permission/perm_test/reply")
      return request.json().then((reply) => {
        replies.push(reply)
        return new Response(null, { status: 204 })
      })
    if (options && url.pathname === "/api/session/ses_test")
      return json({
        data: {
          id: "ses_test",
          parentID: options.parentID,
          projectID: "proj_test",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
          title: "Subagent",
          location: { directory },
        },
      })
    return undefined
  }, events)
  const config = createTuiResolvedConfig()
  const request = {
    id: "perm_test",
    sessionID: "ses_test",
    action: "shell",
    resources: ["echo hi"],
  } satisfies PermissionRequest

  const { PermissionPrompt } = await import("../../../src/routes/session/permission")

  let registry = { ids: () => [] as readonly string[], dispatch: (_id: string, _input?: string) => {} }
  let data!: ReturnType<typeof useData>

  function Harness() {
    return (
      <TestTuiContexts directory={root}>
        <ConfigProvider config={config}>
          <ClientProvider api={createApi(transport.fetch)}>
            <DataProvider>
              <LocationProvider>
                <SyncLocation onReady={(value) => (data = value)} />
                <Keymap.Provider>
                  <ThemeProvider mode="dark" source={{ discover: () => Promise.resolve({}) }}>
                    <ToastProvider>
                      <CommandRegistryProbe onReady={(value) => (registry = value)} />
                      <PermissionPrompt request={request} />
                    </ToastProvider>
                  </ThemeProvider>
                </Keymap.Provider>
              </LocationProvider>
            </DataProvider>
          </ClientProvider>
        </ConfigProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 80, height: 20, kittyKeyboard: true })
  app.renderer.start()
  await app.waitForFrame((frame) => frame.includes("Permission required"))
  if (options) {
    events.emit({
      id: "evt_session_created",
      created: 0,
      type: "session.created",
      location: { directory },
      durable: { aggregateID: "ses_test", seq: 1, version: 1 },
      data: {
        sessionID: "ses_test",
        projectID: "proj_test",
        location: { directory },
        slug: "ses-test",
        version: "0.0.0",
        parentID: options.parentID,
      },
    })
    await app.waitFor(() => data.session.get("ses_test")?.parentID === options.parentID)
  }
  return { app, replies, registry: () => registry }
}

test("form: keyboard option navigation and return still work", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path)
  try {
    // Row 0 ("yes") is selected by default; move down to row 1 ("no"), then
    // back up to row 0, then submit via Return.
    prompt.app.mockInput.pressKey("down")
    prompt.app.mockInput.pressKey("up")
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { choice: "yes" } }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("form: vim option navigation keys still work", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path)
  try {
    // j/k share a command with down/up, so they must keep moving the selection.
    prompt.app.mockInput.pressKey("j")
    prompt.app.mockInput.pressKey("k")
    prompt.app.mockInput.pressKey("j")
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { choice: "no" } }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("form: option.previous/next/action are discoverable through the plugin-facing command registry", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path)
  try {
    const ids = prompt.registry().ids()
    expect(ids).toContain("form.option.previous")
    expect(ids).toContain("form.option.next")
    expect(ids).toContain("form.action")
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("form: dispatching option commands and form.action selects an answer like the keyboard does", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path)
  try {
    // Same journey as the keyboard test above, driven only through the
    // plugin-facing registry: row 0 ("yes") -> row 1 ("no") -> select.
    prompt.registry().dispatch("form.option.next")
    prompt.registry().dispatch("form.action")
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { choice: "no" } }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("form: dispatching form.option.previous moves the selection back", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path)
  try {
    prompt.registry().dispatch("form.option.next")
    prompt.registry().dispatch("form.option.previous")
    prompt.registry().dispatch("form.action")
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { choice: "yes" } }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("form: form.action runs the handler owned by the current state across transitions", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, stagedForm)
  try {
    // Option state: form.action picks the highlighted row and advances a field.
    expect(prompt.registry().ids()).toContain("form.option.next")
    expect(prompt.registry().ids()).toContain("form.action")
    prompt.registry().dispatch("form.option.next")
    prompt.registry().dispatch("form.action")
    await prompt.app.waitForFrame((frame) => frame.includes("Note"))

    // Textual state: the answer-edit layer now owns form.action, and the option
    // commands are gone, so the option handler cannot still be dispatched.
    expect(prompt.registry().ids()).toContain("form.action")
    expect(prompt.registry().ids()).not.toContain("form.option.next")
    expect(prompt.registry().ids()).not.toContain("form.option.previous")
    prompt.registry().dispatch("form.action")
    await prompt.app.waitForFrame((frame) => frame.includes("Review"))
    expect(prompt.replies).toEqual([])

    // Review state: form.action submits instead of advancing.
    expect(prompt.registry().ids()).toContain("form.action")
    expect(prompt.registry().ids()).not.toContain("form.option.next")
    prompt.registry().dispatch("form.action")
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { choice: "no", note: "hi" } }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("form: form.action hands the primary action to the answer-edit layer for a custom answer", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, customForm)
  try {
    // Move past both options onto the "Type your own answer" row.
    prompt.registry().dispatch("form.option.next")
    prompt.registry().dispatch("form.option.next")
    prompt.registry().dispatch("form.action")
    await prompt.app.waitFor(() => !prompt.registry().ids().includes("form.option.next"))
    expect(prompt.registry().ids()).toContain("form.action")

    await prompt.app.mockInput.typeText("maybe")
    await prompt.app.waitForFrame((frame) => frame.includes("maybe"))
    prompt.registry().dispatch("form.action")
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { choice: "maybe" } }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("form: form.action acknowledges an external action and submits the review", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, externalForm)
  try {
    // Copy marks the external action ready without launching a browser.
    prompt.app.mockInput.pressKey("c")
    await prompt.app.waitForFrame((frame) => frame.includes("press enter to confirm"))
    expect(prompt.copied).toEqual(["https://example.com/authorize"])
    // The external state has no selectable rows, so option navigation must not
    // leak into it.
    expect(prompt.registry().ids()).toContain("form.action")
    expect(prompt.registry().ids()).not.toContain("form.option.next")

    prompt.registry().dispatch("form.action")
    await prompt.app.waitForFrame((frame) => frame.includes("Acknowledged"))
    expect(prompt.replies).toEqual([])
    expect(prompt.registry().ids()).toContain("form.action")
    expect(prompt.registry().ids()).not.toContain("form.option.previous")

    prompt.registry().dispatch("form.action")
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { authorization: true } }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("form: form.action commits a textual answer and submits the review", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, textForm)
  try {
    // The textarea layer owns the primary action while the field is textual.
    expect(prompt.registry().ids()).toContain("form.action")
    expect(prompt.registry().ids()).not.toContain("form.option.next")

    prompt.registry().dispatch("form.action")
    await prompt.app.waitForFrame((frame) => frame.includes("Review"))
    expect(prompt.replies).toEqual([])

    prompt.registry().dispatch("form.action")
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { note: "hi" } }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("form: keyboard return still commits a textual answer and submits the review", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path, textForm)
  try {
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitForFrame((frame) => frame.includes("Review"))
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ answer: { note: "hi" } }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("form: prompt commands are not reachable once the form unmounts", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountForm(tmp.path)
  const registry = prompt.registry()
  try {
    expect(registry.ids()).toContain("form.option.next")
    expect(registry.ids()).toContain("form.action")
  } finally {
    prompt.app.renderer.destroy()
  }
  expect(registry.ids()).not.toContain("form.option.previous")
  expect(registry.ids()).not.toContain("form.option.next")
  expect(registry.ids()).not.toContain("form.action")
})

test("permission: keyboard option navigation and return still work", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPermission(tmp.path)
  try {
    // Default selection is "once"; move right to "reject", back left to
    // "once", then confirm via Return.
    prompt.app.mockInput.pressKey("right")
    prompt.app.mockInput.pressKey("left")
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ reply: "once" }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("permission: vim option navigation keys still work", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPermission(tmp.path)
  try {
    // h/l share a command with left/right, so they must keep moving selection.
    prompt.app.mockInput.pressKey("l")
    prompt.app.mockInput.pressKey("h")
    prompt.app.mockInput.pressKey("l")
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ reply: "reject" }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("permission: option.previous/next/action are discoverable through the plugin-facing command registry", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPermission(tmp.path)
  try {
    const ids = prompt.registry().ids()
    expect(ids).toContain("permission.option.previous")
    expect(ids).toContain("permission.option.next")
    expect(ids).toContain("permission.action")
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("permission: dispatching option commands and permission.action replies like the keyboard does", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPermission(tmp.path)
  try {
    prompt.registry().dispatch("permission.option.next")
    prompt.registry().dispatch("permission.action")
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ reply: "reject" }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("permission: dispatching permission.option.previous moves the selection back", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPermission(tmp.path)
  try {
    prompt.registry().dispatch("permission.option.next")
    prompt.registry().dispatch("permission.option.previous")
    prompt.registry().dispatch("permission.action")
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ reply: "once" }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("permission: permission.action confirms a rejection with the typed message", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPermission(tmp.path, { parentID: "ses_parent" })
  try {
    prompt.registry().dispatch("permission.option.next")
    prompt.registry().dispatch("permission.action")
    await prompt.app.waitForFrame((frame) => frame.includes("Reject permission"))
    // The rejection stage has no option list, so only the primary action moves
    // with it.
    expect(prompt.registry().ids()).toContain("permission.action")
    expect(prompt.registry().ids()).not.toContain("permission.option.previous")
    expect(prompt.registry().ids()).not.toContain("permission.option.next")

    await prompt.app.mockInput.typeText("try ls")
    await prompt.app.waitForFrame((frame) => frame.includes("try ls"))
    prompt.registry().dispatch("permission.action")
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ reply: "reject", message: "try ls" }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("permission: keyboard return still confirms a rejection", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPermission(tmp.path, { parentID: "ses_parent" })
  try {
    prompt.app.mockInput.pressKey("right")
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitForFrame((frame) => frame.includes("Reject permission"))
    await prompt.app.mockInput.typeText("try ls")
    await prompt.app.waitForFrame((frame) => frame.includes("try ls"))
    prompt.app.mockInput.pressEnter()
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ reply: "reject", message: "try ls" }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("permission: cancelling a rejection returns permission.action to the option prompt", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPermission(tmp.path, { parentID: "ses_parent" })
  try {
    prompt.registry().dispatch("permission.option.next")
    prompt.registry().dispatch("permission.action")
    await prompt.app.waitForFrame((frame) => frame.includes("Reject permission"))
    expect(prompt.registry().ids()).toContain("permission.action")

    prompt.app.mockInput.pressEscape()
    await prompt.app.waitFor(() => prompt.registry().ids().includes("permission.option.next"))
    // The rejection handler is gone, so permission.action selects an option
    // again instead of confirming a rejection.
    prompt.registry().dispatch("permission.action")
    await prompt.app.waitFor(() => prompt.replies.length === 1)
    expect(prompt.replies).toEqual([{ reply: "once" }])
  } finally {
    prompt.app.renderer.destroy()
  }
})

test("permission: prompt commands are not reachable once the permission prompt unmounts", async () => {
  await using tmp = await tmpdir()
  const prompt = await mountPermission(tmp.path)
  const registry = prompt.registry()
  try {
    expect(registry.ids()).toContain("permission.option.next")
    expect(registry.ids()).toContain("permission.action")
  } finally {
    prompt.app.renderer.destroy()
  }
  expect(registry.ids()).not.toContain("permission.option.previous")
  expect(registry.ids()).not.toContain("permission.option.next")
  expect(registry.ids()).not.toContain("permission.action")
})
