import pkg from "../../../package.json"

export function desktopVersion() {
  return import.meta.env.OPENCODE_VERSION ?? pkg.version
}
