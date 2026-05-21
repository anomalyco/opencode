const state = globalThis as typeof globalThis & { __opencode_blocksuite_effects?: boolean }
let effectsReady = Boolean(state.__opencode_blocksuite_effects)

export async function ensureEffects() {
  if (effectsReady) return
  if (customElements.get("page-editor")) {
    effectsReady = true
    state.__opencode_blocksuite_effects = true
    return
  }
  const [{ effects: presetEffects }, { effects: blockEffects }] = await Promise.all([
    import("@blocksuite/presets/effects"),
    import("@blocksuite/blocks/effects"),
  ])
  presetEffects()
  blockEffects()
  effectsReady = true
  state.__opencode_blocksuite_effects = true
}
