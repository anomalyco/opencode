export function shouldShowSessionSidePanel(options: {
  isDesktop: boolean
  newLayoutDesigns: boolean
  hasSessionID: boolean
  hasWorkspaceTabs: boolean
}) {
  if (!options.isDesktop) return false
  if (!options.newLayoutDesigns) return true
  return options.hasSessionID || options.hasWorkspaceTabs
}
