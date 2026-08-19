import { Effect } from "effect"
import { WslRpcs } from "../../shared/ipc-rpc"
import { IpcPortHandoff } from "../ipc-transport"
import type { WslIpc } from "../wsl/ipc"
import { sender } from "./context"

export function wslHandlers(wsl: WslIpc) {
  return WslRpcs.toLayer(
    Effect.gen(function* () {
      const handoff = yield* IpcPortHandoff
      return WslRpcs.of({
        WslSubscribe: (_args, context) => Effect.sync(() => wsl.subscribe(sender(handoff, context))),
        WslUnsubscribe: (_args, context) => Effect.sync(() => wsl.unsubscribe(sender(handoff, context).id)),
        WslGetState: () => Effect.sync(() => wsl.getState()),
        WslProbeRuntime: () => Effect.promise(() => wsl.probeRuntime()),
        WslRefreshDistros: () => Effect.promise(() => wsl.refreshDistros()),
        WslInstallWsl: () => Effect.promise(() => wsl.installWsl()),
        WslInstallDistro: ({ name }) => Effect.promise(() => wsl.installDistro(name)),
        WslProbeAddable: ({ distros }) => Effect.promise(() => wsl.probeAddable([...distros])),
        WslInstallOpencode: ({ name }) => Effect.promise(() => wsl.installOpencode(name)),
        WslOpenTerminal: ({ name }) => Effect.promise(() => wsl.openTerminal(name)),
        WslAddServer: ({ distro }) => Effect.promise(() => wsl.addServer(distro)),
        WslRemoveServer: ({ id }) => Effect.promise(() => wsl.removeServer(id)),
        WslStartServer: ({ id }) => Effect.promise(() => wsl.startServer(id)),
      })
    }),
  )
}
