import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/unstable/rpc"

export const StorageGet = Rpc.make("StorageGet", {
  payload: { name: Schema.String, key: Schema.String },
  success: Schema.NullOr(Schema.String),
})
export const StorageSet = Rpc.make("StorageSet", {
  payload: { name: Schema.String, key: Schema.String, value: Schema.String },
})
export const StorageDelete = Rpc.make("StorageDelete", {
  payload: { name: Schema.String, key: Schema.String },
})
export const StorageClear = Rpc.make("StorageClear", { payload: { name: Schema.String } })
export const StorageKeys = Rpc.make("StorageKeys", {
  payload: { name: Schema.String },
  success: Schema.Array(Schema.String),
})
export const StorageLength = Rpc.make("StorageLength", {
  payload: { name: Schema.String },
  success: Schema.Number,
})
export const DraftsGet = Rpc.make("DraftsGet", {
  payload: { key: Schema.String },
  success: Schema.NullOr(Schema.String),
})
export const DraftsSet = Rpc.make("DraftsSet", {
  payload: { key: Schema.String, value: Schema.String },
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
  StorageGet,
  StorageSet,
  StorageDelete,
  StorageClear,
  StorageKeys,
  StorageLength,
  DraftsGet,
  DraftsSet,
  DraftsDelete,
  DraftsPutBlob,
  DraftsGetBlob,
)
