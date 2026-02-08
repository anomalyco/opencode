export const MAX_RESTORE_BUFFER_BYTES = 2 * 1024 * 1024
export const MAX_PERSIST_BUFFER_BYTES = 2 * 1024 * 1024

function keepTail(value: string, max: number) {
  if (value.length <= max) return value
  return value.slice(value.length - max)
}

export function prepareRestoreBuffer(value?: string) {
  if (!value) return { value: undefined, trimmed: false }
  if (value.length <= MAX_RESTORE_BUFFER_BYTES) return { value, trimmed: false }
  return { value: keepTail(value, MAX_RESTORE_BUFFER_BYTES), trimmed: true }
}

export function preparePersistBuffer(value: string) {
  if (!value) return value
  return keepTail(value, MAX_PERSIST_BUFFER_BYTES)
}
