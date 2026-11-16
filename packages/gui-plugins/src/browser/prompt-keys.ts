/** The keys that cancel a dialog or a bar, as the system's own do: Escape, and on macOS Command-period too. */
export function cancels(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "isComposing">,
  mac: boolean,
) {
  if (event.isComposing) return false

  return event.key === "Escape" || (mac && event.metaKey && !event.ctrlKey && !event.altKey && event.key === ".")
}
