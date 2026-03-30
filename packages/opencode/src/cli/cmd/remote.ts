import open from "open"
import type { Argv, InferredOptionTypes } from "yargs"
import { Session } from "@/session"
import { SessionID } from "@/session/schema"
import { Filesystem } from "@/util/filesystem"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { RemoteAuth } from "../../server/remote-auth"
import {
  buildOrigins,
  buildRemoteURL,
  createServerPassword,
  DEFAULT_REMOTE_TITLE,
  DEFAULT_REMOTE_TTL_SECONDS,
  preferredRemoteURL,
  renderQRCodeText,
} from "../../server/remote-pairing"
import { RemoteAccess } from "../../server/remote-access"
import { Server } from "../../server/server"
import { cmd } from "./cmd"

const options = {
  port: {
    type: "number" as const,
    describe: "TCP port to bind (defaults to a random available port)",
    default: 0,
  },
  hostname: {
    type: "string" as const,
    alias: ["host"],
    describe: "bind host (private LAN IP by default, or loopback only in tailnet mode)",
  },
  tailnet: {
    type: "boolean" as const,
    describe: "expose remote control only inside your Tailscale tailnet",
    default: false,
  },
  session: {
    type: "string" as const,
    describe: "existing session id to open on the phone",
  },
  title: {
    type: "string" as const,
    describe: "title for the created remote session when --session is not provided",
    default: DEFAULT_REMOTE_TITLE,
  },
  ttl: {
    type: "number" as const,
    describe: "token lifetime in seconds for the pairing link",
    default: DEFAULT_REMOTE_TTL_SECONDS,
  },
  open: {
    type: "boolean" as const,
    describe: "open the first pairing URL in the default browser",
    default: false,
  },
}

export type RemoteOptions = InferredOptionTypes<typeof options>

export function withRemoteOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}

function access(mode: RemoteAccess.Mode) {
  if (mode === "tailnet") return "private overlay (tailscale tailnet)"
  return "private LAN"
}

function label(mode: RemoteAccess.Mode) {
  if (mode === "tailnet") return "Base URL"
  return "Base URL"
}

function notes(mode: RemoteAccess.Mode) {
  if (mode === "tailnet") {
    return [
      "- Server stays bound to loopback only (127.0.0.1 by default)",
      "- Access is limited to devices already inside your Tailscale tailnet",
      "- Tailscale ACLs still apply before the OpenCode token check",
      "- Bearer token required for API access",
      "- Dangerous actions still require explicit approval",
    ]
  }

  return [
    "- Exact-IP bind only (no 0.0.0.0 wildcard listener)",
    "- Bearer token required for API access",
    "- Public IP clients are rejected",
    "- Dangerous actions still require explicit approval",
  ]
}

function wait() {
  return new Promise<void>((resolve) => {
    const done = () => {
      process.off("SIGINT", done)
      process.off("SIGTERM", done)
      resolve()
    }
    process.once("SIGINT", done)
    process.once("SIGTERM", done)
  })
}

export async function runRemote(args: RemoteOptions) {
  const mode = RemoteAccess.normalize(args.tailnet ? "tailnet" : "lan")
  const hostname = RemoteAccess.resolveHost(mode, args.hostname)
  const directory = Filesystem.resolve(process.cwd())
  const sessionID = await bootstrap(directory, async () => {
    if (args.session) {
      const id = SessionID.make(args.session)
      await Session.get(id)
      return id
    }
    const created = await Session.create({
      title: args.title,
    })
    return created.id
  })

  const password = process.env.OPENCODE_SERVER_PASSWORD ? undefined : createServerPassword()
  const server = Server.listen({
    hostname,
    port: args.port,
    passwordOverride: password,
    usernameOverride: process.env.OPENCODE_SERVER_USERNAME ?? "opencode",
    remoteMode: mode,
    remotePair: {
      directory,
      sessionID,
      ttlSeconds: args.ttl,
    },
  })

  let tunnel: RemoteAccess.Tunnel | undefined

  try {
    const port = server.port
    if (!port) throw new Error("Remote server started without a port")

    if (mode === "tailnet") {
      tunnel = await RemoteAccess.start({ hostname, port })
    }

    const pairing = RemoteAuth.create({
      directory,
      sessionID,
      ttlSeconds: args.ttl,
    })
    const accessURLs = tunnel ? [tunnel.url] : buildOrigins(hostname, port)
    const pairingURLs = accessURLs.map((origin) => buildRemoteURL(origin, pairing))
    const qr = await renderQRCodeText(preferredRemoteURL(pairingURLs))
    const bind = new URL(RemoteAccess.origin({ hostname, port })).host

    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Remote control:     ", UI.Style.TEXT_NORMAL, "standalone mobile remote")
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Access mode:        ", UI.Style.TEXT_NORMAL, access(mode))
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Bind address:       ", UI.Style.TEXT_NORMAL, bind)
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Directory:          ", UI.Style.TEXT_NORMAL, directory)
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Session ID:         ", UI.Style.TEXT_NORMAL, sessionID)
    UI.println(
      UI.Style.TEXT_INFO_BOLD + "  Token expires:      ",
      UI.Style.TEXT_NORMAL,
      new Date(pairing.expiresAt).toLocaleString(),
    )
    UI.empty()

    if (password) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "  Generated password: ", UI.Style.TEXT_NORMAL, password)
      UI.println(
        UI.Style.TEXT_DIM +
          "  Basic auth was not configured, so a temporary server password was generated for this process.",
      )
      UI.empty()
    }

    accessURLs.forEach((origin, index) => {
      UI.println(UI.Style.TEXT_INFO_BOLD + `  ${label(mode)} ${index + 1}:`.padEnd(18), UI.Style.TEXT_NORMAL, origin)
      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD + `  Pairing URL ${index + 1}:`.padEnd(18),
        UI.Style.TEXT_NORMAL,
        pairingURLs[index],
      )
      UI.println(UI.Style.TEXT_DIM + "  Use the Pairing URL on your phone. The Base URL does not include the temporary token.")
    })

    if (qr) {
      UI.empty()
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Scan from your phone: ")
      process.stderr.write(qr + "\n")
    }

    UI.empty()
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Security:")
    notes(mode).forEach((item) => UI.println(UI.Style.TEXT_DIM + `  ${item}`))
    UI.empty()
    UI.println(
      UI.Style.TEXT_DIM +
        "  Open a pairing URL on your phone to control the selected session through the standalone remote UI.",
    )
    UI.println(UI.Style.TEXT_DIM + "  Press Ctrl+C to stop the remote server.")

    if (args.open && pairingURLs[0]) {
      open(pairingURLs[0]).catch(() => {})
    }

    await wait()
  } finally {
    await tunnel?.stop().catch(() => {})
    await server.stop(true).catch(() => {})
  }
}

export const RemoteCommand = cmd({
  command: "remote",
  describe: "start a headless server and print a secure standalone remote pairing link",
  builder: (yargs) => withRemoteOptions(yargs),
  handler: async (args) => runRemote(args as RemoteOptions),
})
