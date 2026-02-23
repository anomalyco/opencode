import type { RpcTarget } from "capnweb"
import type * as SDK from "@opencode-ai/sdk/v2"

export type SyncData =
  | {
      type: "session"
      data: SDK.Session
    }
  | {
      type: "message"
      data: SDK.Message
    }
  | {
      type: "part"
      data: SDK.Part
    }
  | {
      type: "session_diff"
      data: SDK.FileDiff[]
    }
  | {
      type: "model"
      data: SDK.Model[]
    }

export type SyncInfo = {
  id: string
  url: string
  secret: string
}

export type ProbeValueInput = { when: Date; bytes: Uint8Array; nested: { x: number } }
export type ProbeValueOutput = {
  when: string
  bytes: number[]
  size: number
  nested: { x: number }
}
export type ProbeCallback = (msg: string) => string | Promise<string>

export interface ShareRpc extends RpcTarget {
  createShare: (sessionID: string, initialData?: SyncData[]) => Promise<SyncInfo>
  syncShare: (shareID: string, secret: string, data: SyncData[]) => Promise<{ success: boolean; syncCount: number }>
  deleteShare: (shareID: string, secret: string) => Promise<{ success: boolean }>
  probeValue: (input: ProbeValueInput) => ProbeValueOutput
  probeCallback: (cb: ProbeCallback) => Promise<string>
}
