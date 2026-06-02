import { Effect } from "effect"

export interface Channel {
  readonly id: string
  readonly type: string
  readonly name: string
  
  start(): Effect.Effect<void>
  stop(): Effect.Effect<void>
  health(): Effect.Effect<ChannelHealth>
  capabilities(): Effect.Effect<ChannelCapabilities>
}

export interface ChannelHealth {
  readonly connected: boolean
  readonly latency?: number
  readonly lastMessage?: number
  readonly reconnectAttempts?: number
  readonly status: string
}

export interface ChannelCapabilities {
  readonly messaging: boolean
  readonly editing: boolean
  readonly typing: boolean
  readonly reactions: boolean
  readonly media: boolean
  readonly voice: boolean
  readonly streaming: boolean
  readonly files: boolean
}