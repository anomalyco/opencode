import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

export const StorageItems = Rpc.make("StorageItems", {
  payload: { name: Schema.String },
  success: Schema.Struct({ items: Schema.Record(Schema.String, Schema.String), revision: Schema.Number }),
})
export const StorageUpdate = Rpc.make("StorageUpdate", {
  payload: {
    name: Schema.String,
    insert: Schema.Record(Schema.String, Schema.String),
    remove: Schema.Array(Schema.String),
  },
  success: Schema.Number,
})
export const StorageClear = Rpc.make("StorageClear", { payload: { name: Schema.String } })
export const DraftsGet = Rpc.make("DraftsGet", {
  payload: { key: Schema.String },
  success: Schema.NullOr(Schema.String),
})
export const DraftsSet = Rpc.make("DraftsSet", {
  payload: { key: Schema.String, value: Schema.String, strict: Schema.Boolean },
  success: Schema.Array(Schema.String),
})
export const DraftsDelete = Rpc.make("DraftsDelete", { payload: { key: Schema.String } })
export const DraftsPutBlob = Rpc.make("DraftsPutBlob", {
  payload: { data: Schema.Uint8Array },
  success: Schema.String,
})
export const DraftsGetBlob = Rpc.make("DraftsGetBlob", {
  payload: { id: Schema.String },
  success: Schema.NullOr(Schema.Uint8Array),
})

export const StorageRpcs = RpcGroup.make(
  StorageItems,
  StorageUpdate,
  StorageClear,
  DraftsGet,
  DraftsSet,
  DraftsDelete,
  DraftsPutBlob,
  DraftsGetBlob,
)
