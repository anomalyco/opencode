export const canAddSelectionContext = (input: {
  active?: string
  pathFromTab: (tab: string) => string | undefined
  selectedLines: (path: string) => unknown
}) => {
  if (!input.active) return false
  const path = input.pathFromTab(input.active)
  if (!path) return false
  return input.selectedLines(path) != null
}
