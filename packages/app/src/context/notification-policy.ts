export function shouldSuppressPageNotification(input: {
  focused: boolean
  permission: NotificationPermission | "unsupported"
  subscribed: boolean
  supportsPush: boolean
  visible: boolean
}) {
  if (!input.supportsPush) return false
  if (!input.subscribed) return false
  if (input.permission !== "granted") return false
  if (input.visible && input.focused) return false
  return true
}
