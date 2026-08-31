import { expect, test } from "bun:test"
import { Schema } from "effect"
import { OpenApi } from "effect/unstable/httpapi"
import { ClientApi, groupNames } from "../src/client.js"
import { RpcError, RpcInternalError } from "../src/errors.js"
import { RpcInput, RpcOutput } from "../src/groups/rpc.js"

test("RPC wrappers preserve JSON primitives and omit undefined fields", () => {
  expect(Schema.encodeSync(RpcInput)({ input: undefined })).toEqual({})
  expect(Schema.encodeSync(RpcOutput)({})).toEqual({})
  expect(Schema.decodeUnknownSync(RpcInput)({})).toEqual({})
  expect(Schema.decodeUnknownSync(RpcOutput)({})).toEqual({})
  for (const value of [null, false, 123, "text", [1, 2], { location: "ordinary payload" }]) {
    expect(Schema.decodeUnknownSync(RpcInput)({ input: value })).toEqual({ input: value })
    expect(Schema.decodeUnknownSync(RpcOutput)({ output: value })).toEqual({ output: value })
  }
})

test("RPC errors use the standard transport wrapper", () => {
  expect(Schema.encodeSync(RpcError)(new RpcError({ type: "not_found", message: "Missing", data: { id: "1" } }))).toEqual(
    {
      _tag: "RpcError",
      type: "not_found",
      message: "Missing",
      data: { id: "1" },
    },
  )
  expect(Schema.encodeSync(RpcError)(new RpcError({ type: "internal", message: "Failed" }))).toEqual({
    _tag: "RpcError",
    type: "internal",
    message: "Failed",
  })
  expect(
    Schema.decodeUnknownSync(RpcError)({ _tag: "RpcError", type: "not_found", message: "Missing", data: {} }),
  ).toBeInstanceOf(RpcError)
  expect(
    Schema.encodeSync(RpcInternalError)(new RpcInternalError({ type: "rpc.internal", message: "Failed" })),
  ).toEqual({ _tag: "RpcInternalError", type: "rpc.internal", message: "Failed" })
  expect(
    Schema.encodeSync(RpcInternalError)(new RpcInternalError({ type: "rpc.invalid_output", message: "Invalid" })),
  ).toEqual({ _tag: "RpcInternalError", type: "rpc.invalid_output", message: "Invalid" })
})

test("exposes one generic RPC operation with location routing and ordinary transport errors", () => {
  expect(groupNames["server.rpc"]).toBe("rpc")
  expect(Object.keys(ClientApi.groups["server.rpc"].endpoints)).toEqual(["rpc.call"])
  const document = OpenApi.fromApi(ClientApi)
  expect(Object.keys(document.paths).filter((path) => path.startsWith("/api/rpc/"))).toEqual([
    "/api/rpc/{rpcID}/{method}",
  ])
  const operation = document.paths["/api/rpc/{rpcID}/{method}"]?.post
  expect(operation?.operationId).toBe("v2.rpc.call")
  expect(operation?.parameters).toContainEqual(
    expect.objectContaining({ name: "rpcID", in: "path", required: true }),
  )
  expect(operation?.parameters).toContainEqual(expect.objectContaining({ name: "method", in: "path", required: true }))
  expect(operation?.parameters).toContainEqual(
    expect.objectContaining({ name: "location", in: "query", style: "deepObject", explode: true }),
  )
  expect(operation?.responses).toHaveProperty("200")
  expect(operation?.responses).toHaveProperty("400")
  expect(operation?.responses).toHaveProperty("401")
  expect(operation?.responses).toHaveProperty("500")
})
