/**
 * Fork distribution identity.
 *
 * Upstream's in-app updater resolves "the latest version" and "where to install
 * it from" against opencode.ai / the official npm + brew packages. On a fork
 * that means the updater will happily overwrite YOUR binary with upstream's the
 * next time the user says "yes" to an update prompt.
 *
 * Everything the updater needs to point at the fork instead lives here, in one
 * place, so `installation/index.ts` stays a near-verbatim copy of upstream and
 * the merge conflict surface is a single import. Each value is env-overridable
 * so CI / alternate channels can repoint without a rebuild.
 *
 * Fork identity: `opencode-skein`.
 */
export const ForkDistribution = {
  /** Fork binary / brand name. */
  name: process.env.OPENCODE_FORK_NAME ?? "opencode-skein",

  /**
   * Curl installer. Upstream points at https://opencode.ai/install which pulls
   * the upstream binary — repointed to the fork's checked-in `install` script so
   * `opencode upgrade` (curl method) re-installs THIS fork.
   */
  installUrl:
    process.env.OPENCODE_INSTALL_URL ?? "https://raw.githubusercontent.com/androidand/opencode/dev/install",

  /** GitHub repo whose `releases/latest` defines the fork's latest version. */
  releaseRepo: process.env.OPENCODE_RELEASE_REPO ?? "androidand/opencode",

  /** Homebrew tap + formula for the fork. */
  brewTap: process.env.OPENCODE_BREW_TAP ?? "androidand/tap",
  brewFormula: process.env.OPENCODE_BREW_FORMULA ?? "opencode-skein",

  /** Package-manager identifiers for the fork's published artifacts. */
  npmPackage: process.env.OPENCODE_NPM_PACKAGE ?? "opencode-skein",
  scoopPackage: process.env.OPENCODE_SCOOP_PACKAGE ?? "opencode-skein",
  chocoPackage: process.env.OPENCODE_CHOCO_PACKAGE ?? "opencode-skein",

  /**
   * UPSTREAM source — NOT a distribution target. Used by `script/sync-check.ts`
   * to detect when the official project has released ahead of our last sync, so
   * the same "new version available" signal can drive a rebase instead of a
   * clobber. Defaults to the upstream git remote's GitHub repo.
   */
  upstreamRepo: process.env.OPENCODE_UPSTREAM_REPO ?? "anomalyco/opencode",
} as const

export type ForkDistribution = typeof ForkDistribution
