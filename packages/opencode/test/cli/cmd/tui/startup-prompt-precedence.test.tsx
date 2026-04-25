/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { onMount } from "solid-js"
import { PromptRefProvider, usePromptRef } from "../../../../src/cli/cmd/tui/context/prompt"
import type { PromptRef } from "../../../../src/cli/cmd/tui/component/prompt"
import type { PromptInfo } from "../../../../src/cli/cmd/tui/component/prompt/history"

function createPromptRef(input: string) {
  const prompt: PromptInfo = { input, parts: [] }

  return {
    get focused() {
      return true
    },
    get current() {
      return prompt
    },
    set(next) {
      prompt.input = next.input
      prompt.parts = next.parts
    },
    reset() {},
    blur() {},
    focus() {},
    submit() {},
  } satisfies PromptRef
}

function Probe(props: { ref: PromptRef; onDrain: (value: boolean) => void }) {
  const promptRef = usePromptRef()

  onMount(() => {
    promptRef.set(props.ref)
    props.onDrain(promptRef.drainStartupInputBuffer(props.ref))
  })

  return <box />
}

describe("startup input buffer precedence", () => {
  test("does not overwrite an explicitly seeded prompt with startup input", async () => {
    let drained = false
    let disposed = false
    let applied = true
    const ref = createPromptRef("seeded")

    const app = await testRender(() => (
      <PromptRefProvider
        startupInputBuffer={{
          drain() {
            drained = true
            return "typed during startup"
          },
          dispose() {
            disposed = true
          },
        }}
      >
        <Probe ref={ref} onDrain={(value) => (applied = value)} />
      </PromptRefProvider>
    ))

    try {
      expect(applied).toBe(false)
      expect(drained).toBe(true)
      expect(disposed).toBe(true)
      expect(ref.current.input).toBe("seeded")
    } finally {
      app.renderer.destroy()
    }
  })
})
