export function footerWidthPolicy(width: number) {
  return {
    dialog: {
      narrow: width < 80,
    },
  }
}

export function footerStatuslinePolicy(input: {
  width: number
  mainWidth: number
  commandWidth?: number
  agentWidth?: number
  contextWidths: number[]
  modelWidth?: number
  variantWidth?: number
  usageWidth?: number
}) {
  let remaining = input.width - input.mainWidth - (input.commandWidth ?? 0)
  let hasSection = input.commandWidth !== undefined
  const include = (width: number | undefined) => {
    if (width === undefined) return false
    const required = width + (hasSection ? 3 : 1)
    if (remaining < required) return false
    remaining -= required
    hasSection = true
    return true
  }

  const showModel = include(input.modelWidth)
  const showAgent = include(input.agentWidth)
  const hiddenContext = input.contextWidths.findIndex((width) => !include(width))
  const contextCount = hiddenContext === -1 ? input.contextWidths.length : hiddenContext
  const contextComplete = contextCount === input.contextWidths.length
  const variantWidth = input.variantWidth
  const showVariant = showModel && contextComplete && variantWidth !== undefined && remaining >= variantWidth
  if (showVariant) remaining -= variantWidth
  const showUsage =
    (showModel || input.modelWidth === undefined) &&
    (showAgent || input.agentWidth === undefined) &&
    contextComplete &&
    (showVariant || input.variantWidth === undefined) &&
    include(input.usageWidth)

  return {
    showAgent,
    contextCount,
    showModel,
    showVariant,
    showUsage,
  }
}
