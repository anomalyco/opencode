import { Log } from "@/util/log"
import { setBrokerPtyLogger } from "@opencode-ai/fork-terminal/broker-pty"

setBrokerPtyLogger(Log.create({ service: "broker-pty" }))

export * from "@opencode-ai/fork-terminal/broker-pty"
