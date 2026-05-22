type State = {
  pending?: Promise<void>
}

const state = (() => {
  const root = globalThis as typeof globalThis & {
    __opencode_blocksuite_effects?: boolean | State
  }
  const current = root.__opencode_blocksuite_effects
  if (typeof current === "object" && current !== null) return current
  const next: State = {}
  root.__opencode_blocksuite_effects = next
  return next
})()

const page = () => customElements.get("page-editor")

const block = () =>
  customElements.get("rich-text") && customElements.get("affine-page-root")

const done = () => page() && block()

export async function ensureEffects() {
  if (done()) return
  if (state.pending) return state.pending
  const run = async () => {
    const [{ effects: preset }, { effects: blocks }] = await Promise.all([
      import("@blocksuite/presets/effects"),
      import("@blocksuite/blocks/effects"),
    ])
    if (!page()) preset()
    if (!block()) blocks()
    state.pending = undefined
  }
  state.pending = run().catch((err) => {
    state.pending = undefined
    throw err
  })
  return state.pending
}
