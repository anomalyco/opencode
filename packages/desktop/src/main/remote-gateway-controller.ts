import { createRemoteGateway, type RemoteGatewayInfo } from "./remote-gateway"

type Gateway = ReturnType<typeof createRemoteGateway>

type RemoteGatewayControllerOptions = {
  getUpstreamUrl: () => Promise<string>
  createGateway?: (upstreamUrl: string) => Gateway
}

export function createRemoteGatewayController(options: RemoteGatewayControllerOptions) {
  let gateway: Gateway | undefined
  let starting: Promise<RemoteGatewayInfo> | undefined
  let stopping: Promise<void> | undefined

  const start = async () => {
    if (stopping) await stopping
    if (gateway?.status()) return gateway.status()!
    if (starting) return starting

    starting = options
      .getUpstreamUrl()
      .then((upstreamUrl) => {
        const next = options.createGateway?.(upstreamUrl) ?? createRemoteGateway({ upstreamUrl })
        gateway = next
        return next.start()
      })
      .catch((error) => {
        gateway = undefined
        throw error
      })
      .finally(() => {
        starting = undefined
      })

    return starting
  }

  const stop = async () => {
    if (stopping) return stopping

    stopping = (async () => {
      await starting?.catch(() => undefined)
      const current = gateway
      gateway = undefined
      if (current) await current.stop()
    })().finally(() => {
      stopping = undefined
    })

    return stopping
  }

  return {
    start,
    stop,
    status: () => gateway?.status(),
  }
}
