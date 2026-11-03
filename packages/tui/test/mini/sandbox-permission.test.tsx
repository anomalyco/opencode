/** @jsxImportSource @opentui/solid */
import { ScrollBoxRenderable, TextRenderable, type Renderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { expect, test } from "bun:test"
import { RunPermissionBody } from "../../src/mini/footer.permission"
import { RUN_THEME_FALLBACK } from "../../src/mini/theme"
import type { MiniPermissionRequest, PermissionReply } from "../../src/mini/types"

function descendants(root: Renderable): Renderable[] {
  return root.getChildren().flatMap((child) => [child, ...descendants(child)])
}

test.each([100, 44])(
  "mini escape approvals scroll, acknowledge one invocation and reset for concurrent requests at %s columns",
  async (width) => {
    const command = [
      "cat > /outside/world.c <<'EOF'",
      ...Array.from({ length: 20 }, (_, i) => `line ${i}`),
      "EOF",
    ].join("\n")
    const [request, setRequest] = createSignal<MiniPermissionRequest>({
      id: "per_escape",
      sessionID: "ses_sandbox",
      action: "sandbox.exec",
      resources: [command],
      metadata: { command, cwd: "/server/workspace", justification: "Create the requested outside file" },
    })
    const replies: PermissionReply[] = []
    const app = await testRender(
      () => (
        <RunPermissionBody
          request={request()}
          theme={RUN_THEME_FALLBACK.footer}
          block={RUN_THEME_FALLBACK.block}
          onReply={(reply) => {
            replies.push(reply)
          }}
        />
      ),
      { width, height: 18, kittyKeyboard: true },
    )
    try {
      await app.renderOnce()
      const scroll = descendants(app.renderer.root).find(
        (item): item is ScrollBoxRenderable => item instanceof ScrollBoxRenderable,
      )
      if (!scroll) throw new Error("Permission scrollbox missing")
      const details = app.renderer.root.findDescendantById("mini.permission.details")
      if (!details) throw new Error("Permission details missing")
      expect(details.y + details.height).toBeLessThanOrEqual(scroll.viewport.y)
      expect(app.captureCharFrame()).toContain("Allow once")
      expect(app.captureCharFrame()).toContain("Reason:")
      expect(app.captureCharFrame()).toContain("Directory:")
      expect(app.captureCharFrame()).toContain("Approval applies")
      expect(app.captureCharFrame()).not.toContain("Always allow")
      expect(scroll.scrollHeight).toBeGreaterThan(scroll.viewport.height)
      // OpenTUI's mock KeyCodes omit PageDown; send its terminal sequence.
      app.mockInput.pressKey("\x1b[6~")
      await app.renderOnce()
      expect(scroll.scrollTop).toBeGreaterThan(0)
      scroll.scrollTo(scroll.scrollHeight)
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("Approval applies")
      expect(app.captureCharFrame()).toContain("Reason:")
      expect(app.captureCharFrame()).toContain("Directory:")
      const actions = descendants(app.renderer.root)
        .filter((item): item is TextRenderable => item instanceof TextRenderable)
        .find((item) => item.plainText === "Allow once")
      if (!actions) throw new Error("Approval action missing")
      expect(scroll.viewport.y + scroll.viewport.height).toBeLessThanOrEqual(actions.y)
      app.mockInput.pressEnter()
      await app.renderOnce()
      expect(replies).toEqual([
        {
          sessionID: "ses_sandbox",
          requestID: "per_escape",
          decision: "once",
          experimental: { acknowledgeSandbox: true },
        },
      ])
      setRequest({ ...request(), id: "per_second" })
      await app.renderOnce()
      expect(scroll.scrollTop).toBe(0)
      expect(app.captureCharFrame()).toContain("Allow once")
      app.mockInput.pressArrow("right")
      app.mockInput.pressEnter()
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("Reject")
      expect(replies).toHaveLength(1)
    } finally {
      app.renderer.destroy()
    }
  },
)

test.each([100, 44])("mini confirms session-prefix scope before saving at %s columns", async (width) => {
  const replies: PermissionReply[] = []
  const app = await testRender(
    () => (
      <RunPermissionBody
        request={{
          id: "per_prefix",
          sessionID: "ses_prefix",
          action: "sandbox.exec",
          resources: ["npm install one"],
          save: ["npm install"],
          metadata: { command: "npm install one", cwd: "/workspace", justification: "Download a dependency" },
        }}
        theme={RUN_THEME_FALLBACK.footer}
        block={RUN_THEME_FALLBACK.block}
        onReply={(reply) => {
          replies.push(reply)
        }}
      />
    ),
    { width, height: 18, kittyKeyboard: true },
  )
  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Allow prefix for session")
    expect(app.captureCharFrame()).toContain("Reject")
    const initialDetails = app.renderer.root.findDescendantById("mini.permission.details")
    if (!initialDetails) throw new Error("Permission details missing")
    const initialScope = descendants(initialDetails).find(
      (item): item is TextRenderable => item instanceof TextRenderable && item.plainText.startsWith("This command"),
    )
    if (!initialScope) throw new Error("Initial scope missing")
    app.mockInput.pressArrow("right")
    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(replies).toEqual([])
    expect(app.captureCharFrame()).toContain("npm install")
    expect(app.captureCharFrame()).toContain("/workspace")
    const details = app.renderer.root.findDescendantById("mini.permission.details")
    if (!details) throw new Error("Confirmation details missing")
    const scope = descendants(details).find(
      (item): item is TextRenderable =>
        item instanceof TextRenderable && item.plainText.startsWith("Matching commands"),
    )
    if (!scope) throw new Error("Confirmation scope missing")
    expect(scope.fg.equals(initialScope.fg)).toBe(true)
    expect(
      descendants(details).some((item) => item instanceof TextRenderable && item.plainText.includes("server restarts")),
    ).toBe(true)
    const scroll = descendants(app.renderer.root).find(
      (item): item is ScrollBoxRenderable => item instanceof ScrollBoxRenderable,
    )
    if (!scroll) throw new Error("Confirmation scrollbox missing")
    scroll.scrollTo(scroll.scrollHeight)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Confirm")
    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(replies).toEqual([
      {
        sessionID: "ses_prefix",
        requestID: "per_prefix",
        decision: "always",
        experimental: { acknowledgeSandbox: true, saveSandboxPrefix: true },
      },
    ])
  } finally {
    app.renderer.destroy()
  }
})

test.each([
  [44, 14],
  [100, 18],
])("mini keeps a long approval reviewable at %sx%s", async (width, height) => {
  const app = await testRender(
    () => (
      <RunPermissionBody
        request={{
          id: "per_long",
          sessionID: "ses_long",
          action: "sandbox.exec",
          resources: ["curl https://example.com"],
          save: ["curl"],
          metadata: {
            command: "curl https://example.com",
            cwd: "/workspace",
            justification: "Review the requested dependency operation and its effects. ".repeat(12),
          },
        }}
        theme={RUN_THEME_FALLBACK.footer}
        block={RUN_THEME_FALLBACK.block}
        onReply={() => {}}
      />
    ),
    { width, height, kittyKeyboard: true },
  )
  try {
    await app.renderOnce()
    await app.renderOnce()
    const scroll = descendants(app.renderer.root).find(
      (item): item is ScrollBoxRenderable => item instanceof ScrollBoxRenderable,
    )
    if (!scroll) throw new Error("Permission scrollbox missing")
    scroll.scrollTo(0)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Allow once")
    expect(app.captureCharFrame()).toContain("Reason:")
    app.mockInput.pressKey("\x1b[6~")
    await app.renderOnce()
    expect(scroll.scrollTop).toBeGreaterThan(0)
    scroll.scrollTo(scroll.scrollHeight)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("$ curl")
    expect(app.captureCharFrame()).toContain("Allow once")
    app.mockInput.pressArrow("right")
    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Confirm")
    scroll.scrollTo(scroll.scrollHeight)
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("$ curl")
    expect(app.captureCharFrame()).toContain("Confirm")
    expect(
      descendants(scroll).some((item) => item instanceof TextRenderable && item.plainText.includes("server restarts")),
    ).toBe(true)
    app.resize(100, 50)
    await app.renderOnce()
    await app.renderOnce()
    const details = app.renderer.root.findDescendantById("mini.permission.details")
    if (!details) throw new Error("Permission details missing after resize")
    expect(details.y + details.height).toBeLessThanOrEqual(scroll.viewport.y)
    app.resize(width, height)
    await app.renderOnce()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Confirm")
  } finally {
    app.renderer.destroy()
  }
})
