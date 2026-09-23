import { expect, test } from "bun:test"
import {
  createComputed,
  createMemo,
  createResource,
  createRoot,
  createSignal,
  onCleanup,
  startTransition,
  Suspense,
  type Accessor,
  type JSX,
} from "solid-js"
import { createComponent, render } from "solid-js/web"

// Solid 1.9.15 includes the former transition patch for solidjs/solid#2046.
test("a memo created during a paused transition has a committed value", async () => {
  const host = document.createElement("div")
  const loaded = Promise.withResolvers<string>()
  const started = Promise.withResolvers<void>()
  const memos: Accessor<string>[] = []
  const [session, setSession] = createSignal(false)
  const dispose = render(
    () =>
      createComponent(Suspense, {
        fallback: "Loading",
        get children() {
          return createMemo(() => {
            if (!session()) return "Home"
            memos.push(createMemo(() => "Session"))
            const [data] = createResource(() => loaded.promise)
            started.resolve()
            return createMemo(() => data() ?? "")
          }) as unknown as JSX.Element
        },
      }),
    host,
  )

  try {
    expect(host.textContent).toBe("Home")
    const pending = startTransition(() => setSession(true))
    await started.promise
    expect(host.textContent).toBe("Home")
    expect(memos).toHaveLength(1)
    expect(memos[0]()).toBe("Session")

    loaded.resolve("Session loaded")
    await pending
    expect(host.textContent).toBe("Session loaded")
    expect(memos[0]()).toBe("Session")
  } finally {
    loaded.resolve("Session loaded")
    dispose()
  }
})

// Exercise each patched bundle independently; importing both dev formats emits Solid's duplicate-runtime warning.
test.each(["solid.js", "solid.cjs", "dev.js", "dev.cjs", "server.js", "server.cjs"])(
  "%s reentrant disposal cleans owned computations and callbacks exactly once",
  async (file) => {
    const runtime: {
      createRoot: typeof createRoot
      createComputed: typeof createComputed
      onCleanup: typeof onCleanup
    } = await import(`solid-js/dist/${file}`)
    const cleaned: string[] = []
    const dispose = runtime.createRoot((dispose) => {
      runtime.onCleanup(() => cleaned.push("root"))
      runtime.createComputed(() => {
        runtime.onCleanup(() => cleaned.push("first"))
      })
      runtime.createComputed(() => {
        runtime.onCleanup(() => cleaned.push("second"))
        runtime.onCleanup(() => {
          cleaned.push("reentrant")
          // Bound the regression so an unpatched runtime fails without overflowing the stack.
          if (cleaned.filter((item) => item === "reentrant").length === 1) dispose()
        })
      })
      return dispose
    })

    expect(dispose).not.toThrow()
    expect(cleaned.toSorted()).toEqual(["first", "reentrant", "root", "second"])
    dispose()
    expect(cleaned).toHaveLength(4)
  },
)
