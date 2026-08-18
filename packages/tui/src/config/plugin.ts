export function setEnabled(draft: { plugins?: unknown[] }, id: string, enabled: boolean) {
  const plugins = Array.isArray(draft.plugins) ? draft.plugins : []
  draft.plugins = plugins.filter((entry) => entry !== id && entry !== `-${id}`)
  draft.plugins.push(enabled ? id : `-${id}`)
}
