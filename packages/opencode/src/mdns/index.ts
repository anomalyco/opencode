import * as MDNSClient from "./client"
import * as MDNSServer from "./server"

export namespace MDNS {
  export type DiscoveredServer = MDNSClient.DiscoveredServer
  export const find = MDNSClient.find
  export const publish = MDNSServer.publish
  export const unpublish = MDNSServer.unpublish
}
