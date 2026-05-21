import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { describeRoute, validator, resolver } from "hono-openapi"
import { upgradeWebSocket } from "hono/bun"
import z from "zod"
import { Doc } from "./index"
import { AssetID, DocID } from "./schema"
import { errors } from "../server/error"
import { lazy } from "../util/lazy"
import * as Room from "./room"

const MAX = 10 * 1024 * 1024

function b64(input: Uint8Array) {
  return Buffer.from(input).toString("base64")
}

function fromB64(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"))
}

export const DocRoutes = lazy(() =>
  new Hono()
    .get(
      "/:docID/sync",
      describeRoute({
        summary: "Pull doc sync state",
        description: "Return Yjs sync update for a collaborative doc.",
        operationId: "doc.sync.pull",
        responses: {
          200: {
            description: "Sync state",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      data: z.string(),
                      state: z.string().optional(),
                    })
                    .nullable(),
                ),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ docID: DocID.zod })),
      validator(
        "query",
        z.object({
          state: z.string().optional(),
          guid: z.string().optional(),
        }),
      ),
      async (c) => {
        const docID = c.req.valid("param").docID
        const state = c.req.valid("query").state
        const guid = c.req.valid("query").guid ?? docID
        const result = Doc.syncPull({
          docID,
          guid,
          state: state ? fromB64(state) : new Uint8Array(),
        })
        if (!result) return c.json(null)
        return c.json({
          data: b64(result.data),
          state: b64(result.state),
        })
      },
    )
    .post(
      "/:docID/sync",
      describeRoute({
        summary: "Push doc sync update",
        description: "Apply a Yjs update to a collaborative doc.",
        operationId: "doc.sync.push",
        responses: {
          204: {
            description: "Update applied",
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ docID: DocID.zod })),
      validator(
        "json",
        z.object({
          data: z.string(),
          guid: z.string().optional(),
        }),
      ),
      async (c) => {
        const docID = c.req.valid("param").docID
        const body = c.req.valid("json")
        Doc.syncPush({
          docID,
          guid: body.guid ?? docID,
          data: fromB64(body.data),
        })
        return c.body(null, 204)
      },
    )
    .post(
      "/:docID/asset",
      describeRoute({
        summary: "Upload doc asset",
        description: "Store an image asset for a collaborative doc.",
        operationId: "doc.asset.create",
        responses: {
          200: {
            description: "Stored asset",
            content: {
              "application/json": {
                schema: resolver(Doc.AssetInfo),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ docID: DocID.zod })),
      validator(
        "json",
        z.object({
          id: AssetID.zod.optional(),
          mime: z.string().startsWith("image/"),
          data: z.string().min(1),
        }),
      ),
      async (c) => {
        const docID = c.req.valid("param").docID
        const body = c.req.valid("json")
        const data = new Uint8Array(Buffer.from(body.data, "base64"))
        if (data.byteLength > MAX) throw new HTTPException(400, { message: "Doc asset is too large" })
        return c.json(Doc.assetCreate({ docID, assetID: body.id, mime: body.mime, data }))
      },
    )
    .get(
      "/:docID/asset/:assetID",
      describeRoute({
        summary: "Get doc asset",
        description: "Return a stored image asset for a collaborative doc.",
        operationId: "doc.asset.get",
        responses: {
          200: {
            description: "Asset data",
            content: {
              "application/octet-stream": {
                schema: resolver(z.string()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ docID: DocID.zod, assetID: AssetID.zod })),
      async (c) => {
        const param = c.req.valid("param")
        const asset = Doc.assetGet({ docID: param.docID, assetID: param.assetID })
        c.header("Content-Type", asset.mime)
        c.header("Content-Length", asset.size.toString())
        c.header("Cache-Control", "public, max-age=31536000, immutable")
        return c.body(asset.data)
      },
    )
    .get(
      "/:docID/connect",
      describeRoute({
        summary: "Connect to collaborative doc",
        description: "WebSocket connection for real-time doc and awareness sync.",
        operationId: "doc.connect",
        responses: {
          200: {
            description: "Connected",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ docID: DocID.zod })),
      upgradeWebSocket(async (c) => {
        const docID = DocID.zod.parse(c.req.param("docID"))
        Doc.get(docID)

        type Socket = {
          readyState: number
          send: (data: string | Uint8Array | ArrayBuffer) => void
          close: (code?: number, reason?: string) => void
        }

        const isSocket = (value: unknown): value is Socket => {
          if (!value || typeof value !== "object") return false
          if (!("readyState" in value)) return false
          if (!("send" in value) || typeof (value as { send?: unknown }).send !== "function") return false
          return typeof (value as { readyState?: unknown }).readyState === "number"
        }

        let stop: (() => void) | undefined
        let peer: Room.Peer | undefined

        return {
          onOpen(_event, ws) {
            const socket = ws.raw
            if (!isSocket(socket)) {
              ws.close()
              return
            }
            peer = {
              send: (data) => {
                if (socket.readyState !== 1) return
                socket.send(data)
              },
            }
            stop = Room.connect(docID, peer)
          },
          onMessage(event) {
            if (!peer) return
            const raw =
              typeof event.data === "string"
                ? new TextEncoder().encode(event.data)
                : event.data instanceof ArrayBuffer
                  ? new Uint8Array(event.data)
                  : event.data instanceof Uint8Array
                    ? event.data
                    : undefined
            if (!raw) return
            const msg = Room.decode(raw, docID)
            if (!msg) return
            if (msg.type === Room.MSG_DOC) {
              Doc.syncPush({ docID, guid: msg.guid, data: new Uint8Array(msg.data), peer })
              return
            }
            if (msg.type === Room.MSG_AWARENESS) {
              Room.awareness(docID, new Uint8Array(msg.data), peer)
            }
          },
          onClose() {
            stop?.()
          },
        }
      }),
    ),
)
