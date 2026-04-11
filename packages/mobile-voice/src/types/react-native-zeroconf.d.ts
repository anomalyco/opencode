declare module "react-native-zeroconf" {
  export const ImplType: {
    NSD: string
    DNSSD: string
  }

  export type ZeroconfService = {
    name?: string
    fullName?: string
    host?: string
    port?: number
    addresses?: string[]
    txt?: Record<string, string>
  }

  export default class Zeroconf {
    scan(type?: string, protocol?: string, domain?: string, implType?: string): void
    stop(implType?: string): void
    removeDeviceListeners(): void
    getServices(): Record<string, ZeroconfService>
    on(event: string, listener: (...args: unknown[]) => void): this
  }
}
