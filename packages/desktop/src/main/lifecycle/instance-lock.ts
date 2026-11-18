/**
 * What a launch does when another process holds the single-instance lock on its data folder. A packaged app hands its
 * arguments to that process and leaves quietly. A source build shares its data folder with the installed OpenCode Dev
 * app and with source builds from other checkouts, so leaving quietly looks like a crash: it says why and fails.
 */
export function lockHeld(build: { readonly packaged: boolean }, userData: string) {
  if (build.packaged) return { type: "handover" } as const

  return {
    type: "refused",
    message:
      `Another OpenCode app (the installed OpenCode Dev app, or a dev app from another checkout) is already using ` +
      `the data folder ${userData}, so this one cannot start: quit that app, or set OPENCODE_DESKTOP_TEST_ROOT to ` +
      `another folder to run this one with a separate, empty profile.`,
  } as const
}
