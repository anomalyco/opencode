export function shouldShowSessionHeaderFileTreeAction(input: { desktop: boolean; visible: boolean }) {
  return input.desktop && input.visible
}
