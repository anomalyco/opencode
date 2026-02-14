import { Log } from "@/util/log"
import { Bonjour, type Service, type Browser } from "bonjour-service"

export interface DiscoveredServer {
  name: string
  host: string
  port: number
  fullUrl: string
  txt: Record<string, string>
}

export namespace MDNS {
  const log = Log.create({ service: "mdns-client" })
  type Timer = ReturnType<typeof setTimeout>

  export function find(timeout = 5000, quietPeriod = 1000): Promise<DiscoveredServer[]> {
    return new Promise((resolve) => {
      const bonjour = new Bonjour()
      const servers: DiscoveredServer[] = []
      let quietTimer: Timer | undefined

      const finish = () => {
        if (quietTimer) clearTimeout(quietTimer)
        quietTimer = undefined
        browser.stop()
        bonjour.destroy()
        log.info("discovery complete", { count: servers.length })
        resolve(servers)
      }

      const onService = (service: Service) => {
        if (!service.name.startsWith("opencode-")) return

        const host = service.host
        const port = service.port
        const txt = service.txt ?? {}
        const fullUrl = `http://${host}:${port}`

        servers.push({
          name: service.name,
          host,
          port,
          fullUrl,
          txt,
        })

        log.debug("discovered server", { name: service.name, host, port })

        if (quietTimer) clearTimeout(quietTimer)
        quietTimer = setTimeout(finish, quietPeriod)
      }

      const browser = bonjour.find({ type: "http", protocol: "tcp" }, onService)

      setTimeout(finish, timeout)
    })
  }
}
