// Regression tests for the composer IME guard (#39632, #49448, #38674).
//
// The guard reads the monotonic clock (performance.now) on purpose — see
// interaction.ts — so these tests pin it directly instead of sleeping; no
// wall-clock involved. The guards under test are the exact conditions the
// editor's onInput / onKeyDown handlers consult:
//
//   onInput:   if (controller.imeInserting(event)) return   // editor.tsx
//   onKeyDown: if (controller.imeComposing(event)) return   // editor.tsx
import { afterEach, beforeEach, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { ComposerPersistedState } from "@/composer/types"
import { createComposerEditor } from "@/composer/editor/interaction"

const realNow = performance.now
let now = 0

beforeEach(() => {
  now = 10_000
  Object.defineProperty(performance, "now", { configurable: true, value: () => now })
})

afterEach(() => {
  Object.defineProperty(performance, "now", { configurable: true, value: realNow })
})

function setup() {
  return createRoot((dispose) => {
    const store = createStore<ComposerPersistedState>({
      prompt: [],
      cursor: 0,
      context: { items: [] },
    })
    const controller = createComposerEditor({
      store,
      commands: () => [],
      context: () => [],
      searchContextFiles: () => [],
      view: {
        submit: {
          stopping: () => false,
          onSubmit: () => {},
          onStop: () => {},
        },
      },
    })
    return { controller, dispose }
  })
}

function keydown(key: string, init: { isComposing?: boolean; keyCode?: number } = {}) {
  const event = new KeyboardEvent("keydown", { key, isComposing: init.isComposing ?? false })
  if (init.keyCode !== undefined) Object.defineProperty(event, "keyCode", { value: init.keyCode })
  return event
}

function input(isComposing: boolean) {
  return Object.assign(new Event("input"), { isComposing }) as InputEvent
}

// zh-CN / ja: Safari fires compositionend BEFORE the confirming Enter, so the
// keydown reports isComposing=false (keyCode 229 on Safari 26, 13 in older
// reports). That Enter must never submit — but a deliberately pressed Enter
// past the short confirm window still sends.
test("the Enter confirming a CJK candidate is ignored; a later Enter sends", () => {
  const { controller, dispose } = setup()
  try {
    controller.onCompositionStart()
    expect(controller.imeComposing(keydown("e", { isComposing: true }))).toBe(true)
    controller.onCompositionEnd()
    // confirming Enter, Safari 26 shape
    expect(controller.imeComposing(keydown("Enter", { isComposing: false, keyCode: 229 }))).toBe(true)
    // older reports: keyCode 13, inside the 10ms confirm window
    expect(controller.imeComposing(keydown("Enter", { isComposing: false, keyCode: 13 }))).toBe(true)
    // past the window (typematic minimum is ~30ms): a real send
    now += 15
    expect(controller.imeComposing(keydown("Enter", { isComposing: false, keyCode: 13 }))).toBe(false)
  } finally {
    dispose()
  }
})

// ko: Korean IMEs end the current syllable and insert the next character in
// the same keystroke; that input arrives right after compositionend with
// isComposing=false and must reach the store. ja/zh users also keep typing
// immediately after confirming a candidate.
test("input is gated only while a composition is in flight", () => {
  const { controller, dispose } = setup()
  try {
    controller.onCompositionStart()
    expect(controller.imeInserting(input(true))).toBe(true)
    controller.onCompositionEnd()
    expect(controller.imeInserting(input(false))).toBe(false)
    now += 5
    expect(controller.imeInserting(input(false))).toBe(false)
  } finally {
    dispose()
  }
})

// The confirm window covers Enter/Tab only. Escape (stop), arrows (history),
// and Android soft keyboards reporting keyCode 229 on most keys must keep
// working right after — or entirely without — a composition.
test("non-confirm keys are never swallowed", () => {
  const { controller, dispose } = setup()
  try {
    controller.onCompositionStart()
    controller.onCompositionEnd()
    now += 5
    expect(controller.imeComposing(keydown("Escape", { isComposing: false, keyCode: 27 }))).toBe(false)
    expect(controller.imeComposing(keydown("ArrowUp", { isComposing: false, keyCode: 38 }))).toBe(false)
  } finally {
    dispose()
  }

  const bare = setup() // no composition at all, Android shape
  try {
    expect(bare.controller.imeComposing(keydown("a", { isComposing: false, keyCode: 229 }))).toBe(false)
    expect(bare.controller.imeComposing(keydown("Backspace", { isComposing: false, keyCode: 229 }))).toBe(false)
  } finally {
    bare.dispose()
  }
})
