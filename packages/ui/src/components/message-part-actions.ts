export function showUserActions(input: { text: string; attachments: number }) {
  if (input.text) return true
  return input.attachments > 0
}
