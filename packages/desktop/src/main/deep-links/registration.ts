/**
 * Whether this launch makes itself the handler of `opencode://` links. A machine has one handler, so a source build
 * that registered would take the links away from the installed app. It registers only when
 * `OPENCODE_DESKTOP_REGISTER_PROTOCOL=1` asks.
 */
export function registersProtocol(build: { readonly packaged: boolean }, value?: string) {
  return build.packaged || value === "1"
}
