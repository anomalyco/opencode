import { createHash } from "node:crypto"
import path from "node:path"

/** The XDG directories a test root replaces, so the app and the service it starts stay out of the real home. */
export function testRootDirectories(root: string) {
  return {
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_STATE_HOME: path.join(root, "state"),
  }
}

/**
 * The `XDG_STATE_HOME` the app and the service it starts run with, which is where the service registers. An isolated
 * source build keeps its own service in its data folder, and a test root keeps everything under the root. Any other
 * launch follows the login shell and drops a value it only inherited from the process that started it: a shell under
 * another app's service has that app's state directory. Windows has no login shell to ask, so nothing is kept there.
 */
export function stateHome(input: {
  readonly isolated: boolean
  readonly userData: string
  readonly testRoot?: string
  readonly shell?: string
}) {
  if (input.isolated) return input.userData

  if (input.testRoot) return testRootDirectories(input.testRoot).XDG_STATE_HOME

  return input.shell || undefined
}

/**
 * The port a source build's own service listens on. `Service.ensure` uses the port as the service's lock: a second
 * contender for the same registration fails to bind, recognizes the incumbent and exits, where port 0 never collides
 * and lets two services boot against one database. One port for every source build made that lock machine-wide, so a
 * build with its own test root and database could not start next to another one. A port derived from the registration
 * file is still one fixed port per service. The range lies below every platform's ephemeral ports and the blocks
 * Windows reserves, and above the channel services' ports. `OPENCODE_DESKTOP_SERVER_PORT` moves a build whose port
 * another program holds.
 */
export function servicePort(registration: string, override?: string) {
  if (override && /^\d+$/.test(override) && Number(override) >= 1 && Number(override) <= 65_535) return Number(override)

  return 0x7100 + (createHash("sha256").update(registration).digest().readUInt32BE(0) % 0x800)
}

/** Where the local channel's service registers, as the source CLI computes it from the same state directory. */
export function localRegistrationFile(input: { readonly stateHome?: string; readonly home: string }) {
  return path.join(input.stateHome ?? path.join(input.home, ".local", "state"), "opencode", "service-local.json")
}
