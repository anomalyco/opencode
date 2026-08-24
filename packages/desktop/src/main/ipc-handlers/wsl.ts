import { Effect } from "effect"
import { WslRpcs } from "../../shared/ipc-rpc"
import { IpcPortHandoff } from "../ipc-transport"
import { Wsl } from "../wsl/start"
import { sender } from "./context"

export const wslHandlers = WslRpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff
    const wsl = yield* Wsl.Service
    return WslRpcs.of({
      WslSubscribe: (_args, context) => wsl.subscribe(sender(handoff, context)),
      WslUnsubscribe: (_args, context) => wsl.unsubscribe(sender(handoff, context).id),
      WslGetState: () => wsl.getState(),
      WslProbeRuntime: () => wsl.probeRuntime(),
      WslRefreshDistros: () => wsl.refreshDistros(),
      WslInstallWsl: () => wsl.installWsl(),
      WslInstallDistro: ({ name }) => wsl.installDistro(name),
      WslProbeAddable: ({ distros }) => wsl.probeAddable([...distros]),
      WslInstallOpencode: ({ name }) => wsl.installOpencode(name),
      WslOpenTerminal: ({ name }) => wsl.openTerminal(name),
      WslAddServer: ({ distro }) => wsl.addServer(distro),
      WslRemoveServer: ({ id }) => wsl.removeServer(id),
      WslStartServer: ({ id }) => wsl.startServer(id),
    })
  }),
)
