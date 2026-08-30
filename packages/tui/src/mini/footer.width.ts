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
  running?: boolean
  commandWidth?: number
  agentWidth?: number
  contextWidths: number[]
  modelWidth?: number
  providerWidth?: number
  variantWidth?: number
  usageWidth?: number
  spinnerWidth?: number
}) {
  let remaining = input.width - input.mainWidth
  let hasSection = input.mainWidth > 0
  const include = (width: number | undefined, gap = 3) => {
    if (width === undefined) return false
    const required = width + (hasSection ? gap : 0)
    if (remaining < required) return false
    remaining -= required
    hasSection = true
    return true
  }

  const result = {
    showAgent: false,
    showModel: false,
    showVariant: false,
    context: [] as boolean[],
    showCommand: false,
    showUsage: false,
    showProvider: false,
    showSpinner: false,
  }
  const identity = () => {
    result.showAgent = include(input.agentWidth)
    result.showModel = include(input.modelWidth)
    result.showVariant = result.showModel && include(input.variantWidth, 1)
  }

  if (!input.running) identity()
  result.context = input.contextWidths.map((width) => include(width))
  result.showCommand = include(input.commandWidth)
  if (input.running) identity()
  result.showUsage = include(input.usageWidth)
  result.showProvider = result.showModel && include(input.providerWidth, 1)
  result.showSpinner = include(input.spinnerWidth, 1)
  return result
}
