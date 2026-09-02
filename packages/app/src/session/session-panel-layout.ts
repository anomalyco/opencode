export function sessionPanelLayout(input: { review: boolean; terminal: boolean; files: boolean }) {
  return {
    visible: input.review || input.terminal || input.files,
    stacked: input.review && input.terminal,
  }
}
