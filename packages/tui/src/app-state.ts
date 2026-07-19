/** Resolves whether startup may render before initial synchronization settles. */
export function resolveSkipInitialLoading(noFastBoot: string | undefined) {
  return !noFastBoot
}

/** Resolves paste-summary state, with a stored user choice taking precedence. */
export function resolvePasteSummaryEnabled(stored: boolean | undefined, disabledByConfig: boolean | undefined) {
  return stored ?? !disabledByConfig
}

/**
 * Creates the accessor used by the app so synchronized config remains a live
 * default until the user stores an explicit override.
 */
export function createPasteSummaryEnabled(
  readStored: () => boolean | undefined,
  readDisabledByConfig: () => boolean | undefined,
) {
  return () => resolvePasteSummaryEnabled(readStored(), readDisabledByConfig())
}
