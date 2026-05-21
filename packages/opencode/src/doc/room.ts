import * as Y from "yjs"
import { modifyAwarenessUpdate } from "y-protocols/awareness"
import type { DocID } from "./schema"
import { MSG_AWARENESS, MSG_DOC, pack, unpack, unpackLegacy } from "./wire"

export { MSG_DOC, MSG_AWARENESS }

export type Peer = {
  send: (data: Uint8Array) => void
  awareness?: Uint8Array
}

type Room = {
  doc: Y.Doc
  peers: Set<Peer>
}

type Target = {
  doc: Y.Doc
  added: boolean
}

const rooms = new Map<DocID, Room>()

function room(id: DocID) {
  let r = rooms.get(id)
  if (r) return r
  r = {
    doc: new Y.Doc({ guid: id }),
    peers: new Set(),
  }
  rooms.set(id, r)
  return r
}

function target(r: Room, guid: string): Target {
  if (guid === r.doc.guid) return { doc: r.doc, added: false }
  for (const sub of r.doc.getSubdocs()) {
    if (sub.guid === guid) return { doc: sub, added: false }
  }
  const sub = new Y.Doc({ guid })
  r.doc.getMap("spaces").set(guid, sub)
  return { doc: sub, added: true }
}

export function apply(id: DocID, guid: string, data: Uint8Array) {
  Y.applyUpdate(target(room(id), guid).doc, data)
}

export function pull(id: DocID, guid: string, state: Uint8Array) {
  const doc = target(room(id), guid).doc
  const update = Y.encodeStateAsUpdate(doc, state.length > 0 ? state : undefined)
  const vector = Y.encodeStateVector(doc)
  if (update.length === 0) return null
  return { data: update, state: vector }
}

export function push(id: DocID, guid: string, data: Uint8Array, from?: Peer) {
  const r = room(id)
  const next = target(r, guid)
  Y.applyUpdate(next.doc, data)
  const root = next.added ? pack(MSG_DOC, r.doc.guid, Y.encodeStateAsUpdate(r.doc)) : undefined
  const payload = pack(MSG_DOC, guid, data)
  for (const peer of r.peers) {
    if (peer === from) continue
    if (root) peer.send(root)
    peer.send(payload)
  }
}

export function awareness(id: DocID, data: Uint8Array, from?: Peer) {
  if (from) from.awareness = data
  const payload = pack(MSG_AWARENESS, "", data)
  for (const peer of room(id).peers) {
    if (peer === from) continue
    peer.send(payload)
  }
}

function remove(data: Uint8Array) {
  try {
    return modifyAwarenessUpdate(data, () => null)
  } catch {
    return
  }
}

export function connect(id: DocID, peer: Peer) {
  const r = room(id)
  r.peers.add(peer)
  peer.send(pack(MSG_DOC, r.doc.guid, Y.encodeStateAsUpdate(r.doc)))
  for (const sub of r.doc.getSubdocs()) {
    peer.send(pack(MSG_DOC, sub.guid, Y.encodeStateAsUpdate(sub)))
  }
  for (const next of r.peers) {
    if (next === peer || !next.awareness) continue
    peer.send(pack(MSG_AWARENESS, "", next.awareness))
  }
  return () => {
    r.peers.delete(peer)
    const left = peer.awareness ? remove(peer.awareness) : undefined
    if (left) {
      const payload = pack(MSG_AWARENESS, "", left)
      for (const next of r.peers) {
        next.send(payload)
      }
    }
    if (r.peers.size === 0) {
      r.doc.destroy()
      rooms.delete(id)
    }
  }
}

export function decode(buf: Uint8Array, root: string) {
  const next = unpack(buf)
  if (next) {
    if (next.type === MSG_DOC) return { type: MSG_DOC, guid: next.guid, data: next.data }
    if (next.type === MSG_AWARENESS) return { type: MSG_AWARENESS, guid: next.guid, data: next.data }
    return
  }
  const legacy = unpackLegacy(buf)
  if (!legacy) return
  if (legacy.type === MSG_DOC) return { type: MSG_DOC, guid: root, data: legacy.data }
  if (legacy.type === MSG_AWARENESS) return { type: MSG_AWARENESS, guid: root, data: legacy.data }
}
