// Shared responsive width policy

const FOOTER_WIDTH_BREAKPOINTS = {
  commandHint: 24,
  model: 32,
  modelVariant: 40,
  compact: 80,
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
      showModel: width >= FOOTER_WIDTH_BREAKPOINTS.model,
      showModelVariant: width >= FOOTER_WIDTH_BREAKPOINTS.modelVariant,
      showContextHints: compact,
      contextHintLimit: !compact ? 0 : spacious ? undefined : context ? 2 : 1,
    },
  }
}
