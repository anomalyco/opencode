// Shared responsive width policy

const FOOTER_WIDTH_BREAKPOINTS = {
  compact: 80,
  commandHint: 66,
  context: 120,
  spacious: 150,
} as const

export function footerWidthPolicy(width: number) {
  const compact = width >= FOOTER_WIDTH_BREAKPOINTS.compact
  const context = width >= FOOTER_WIDTH_BREAKPOINTS.context
  const spacious = width >= FOOTER_WIDTH_BREAKPOINTS.spacious

  return {
    dialog: {
      narrow: !compact,
    },
    statusline: {
      showActivityMeta: compact,
      showCommandHint: width >= FOOTER_WIDTH_BREAKPOINTS.commandHint,
      showContextHints: compact,
      contextHintLimit: !compact ? 0 : spacious ? undefined : context ? 2 : 1,
    },
  }
}
