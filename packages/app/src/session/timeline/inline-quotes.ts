// Inline quotes in user messages ship to local and dev builds first; beta and prod keep the comment cards until the
// layout is tried in a release.
export const inlineQuotes =
  import.meta.env.DEV || ["local", "dev"].includes(import.meta.env.VITE_OPENCODE_CHANNEL ?? "")
