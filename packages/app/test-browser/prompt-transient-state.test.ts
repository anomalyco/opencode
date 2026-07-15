import { expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createPromptInputTransientState } from "@/components/prompt-input/transient-state"

test("resets transient prompt input state when the prompt session changes", () => {
  createRoot((dispose) => {
    const [identity, setIdentity] = createSignal("A")
    const [state, setState] = createPromptInputTransientState(identity, 3)
    setState({
      popover: "slash",
      slashMenu: true,
      slashMenuQuery: "compact",
      historyIndex: 2,
      savedPrompt: {
        prompt: [{ type: "text", content: "draft-A", start: 0, end: 7 }],
        comments: [],
      },
      draggingType: "image",
      mode: "shell",
      applyingHistory: true,
      variantOpen: true,
    })

    setIdentity("B")

    expect(state).toMatchObject({
      popover: null,
      slashMenu: false,
      slashMenuQuery: "",
      historyIndex: -1,
      savedPrompt: null,
      placeholder: 3,
      draggingType: null,
      mode: "normal",
      applyingHistory: false,
      variantOpen: false,
    })
    dispose()
  })
})
