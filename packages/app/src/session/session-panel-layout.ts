export function sessionPanelLayout(input: { review: boolean; browser: boolean; terminal: boolean; files: boolean }) {
  return {
    visible: input.review || input.browser || input.terminal || input.files,
    stacked: (input.review || input.browser) && input.terminal,
  }
}
