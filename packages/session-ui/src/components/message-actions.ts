export function handleCopyResponseClick(event: Pick<MouseEvent, "stopPropagation">, copy: () => void) {
  event.stopPropagation()
  copy()
}

export function formatMessageStamp(locale: string, value: number) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(value)
}
