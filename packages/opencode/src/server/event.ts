import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { Schema } from "effect"

export const Event = {
  Connected: BusEvent.define("server.connected", Schema.Struct({})),
  Disposed: BusEvent.define("global.disposed", Schema.Struct({})),
  ConfigUpdated: BusEvent.define("global.config.updated", Config.Info),
}
