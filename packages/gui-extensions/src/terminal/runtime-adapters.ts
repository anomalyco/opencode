type RecordValue = Record<string, unknown>

const isRecord = (value: unknown): value is RecordValue => {
  return typeof value === "object" && value !== null
}

const isDisposable = (value: unknown): value is { dispose: () => void } => {
  return isRecord(value) && typeof value.dispose === "function"
}

export const disposeIfDisposable = (value: unknown) => {
  if (!isDisposable(value)) return
  value.dispose()
}

const hasSetOption = (value: unknown): value is { setOption: (key: string, next: unknown) => void } => {
  return isRecord(value) && typeof value.setOption === "function"
}

export const setOptionIfSupported = (value: unknown, key: string, next: unknown) => {
  if (!hasSetOption(value)) return
  value.setOption(key, next)
}

export const getHoveredLinkText = (value: unknown) => {
  if (!isRecord(value)) return
  const link = value.currentHoveredLink

  if (!isRecord(link)) return

  if (typeof link.text !== "string") return

  return link.text
}
