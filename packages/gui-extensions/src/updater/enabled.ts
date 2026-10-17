/**
 * Whether the bundled desktop updater runs for this build. Third-party packagers (Nix, AUR, Homebrew) ship
 * their own desktop package and set `OPENCODE_DISABLE_AUTOUPDATE`, the same variable the CLI honors, so the
 * updater never replaces the package-managed install. Unpackaged and dev-channel builds never update.
 */
export function updaterEnabled(build: { readonly packaged: boolean; readonly channel: string }) {
  if (!build.packaged || build.channel === "dev") return false

  return !["1", "true"].includes(process.env.OPENCODE_DISABLE_AUTOUPDATE?.toLowerCase() ?? "")
}
