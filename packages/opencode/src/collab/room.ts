/**
 * Collab Session WebSocket room manager.
 *
 * Each Collab Session has a room. Participants join/leave via WebSocket.
 * The room broadcasts CollabEvents to all connected participants.
 */

import type { CollabEvent } from "@opencode-ai/collab"

type SendFn = (event: CollabEvent) => void

interface Connection {
  githubId: number
  githubLogin: string
  collabSessionId: string
  send: SendFn
}

// collabSessionId → Set<connectionId>
const rooms = new Map<string, Map<string, Connection>>()

// connectionId → collabSessionId (for reverse lookup on disconnect)
const connectionIndex = new Map<string, string>()

let _connectionCounter = 0

export function joinRoom(
  collabSessionId: string,
  githubId: number,
  githubLogin: string,
  send: SendFn,
): string {
  const connectionId = `${githubLogin}:${++_connectionCounter}`

  if (!rooms.has(collabSessionId)) {
    rooms.set(collabSessionId, new Map())
  }
  rooms.get(collabSessionId)!.set(connectionId, { githubId, githubLogin, collabSessionId, send })
  connectionIndex.set(connectionId, collabSessionId)

  return connectionId
}

export function leaveRoom(connectionId: string) {
  const collabSessionId = connectionIndex.get(connectionId)
  if (!collabSessionId) return
  connectionIndex.delete(connectionId)
  rooms.get(collabSessionId)?.delete(connectionId)
}

export function broadcast(collabSessionId: string, event: CollabEvent, excludeLogin?: string) {
  const room = rooms.get(collabSessionId)
  if (!room) return
  for (const conn of room.values()) {
    if (excludeLogin && conn.githubLogin === excludeLogin) continue
    try {
      conn.send(event)
    } catch {
      // dead connection — will be cleaned up on socket close
    }
  }
}

export function broadcastAll(collabSessionId: string, event: CollabEvent) {
  broadcast(collabSessionId, event)
}

export function getOnlineLogins(collabSessionId: string): string[] {
  const room = rooms.get(collabSessionId)
  if (!room) return []
  return [...new Set([...room.values()].map((c) => c.githubLogin))]
}

export function getRoomSize(collabSessionId: string): number {
  return rooms.get(collabSessionId)?.size ?? 0
}
