import { expect, test } from "bun:test"
import { createWorkerTransport } from "./markdown-worker-transport"

test("posts one request and retains only the latest queued snapshot per key", () => {
  const posted: number[] = []
  const superseded: number[] = []
  const transport = createWorkerTransport<{ id: number; key: string }>({
    post: (request) => posted.push(request.id),
    supersede: (request) => superseded.push(request.id),
  })

  transport.send({ id: 1, key: "code" })
  transport.send({ id: 2, key: "code" })
  transport.send({ id: 3, key: "code" })

  expect(posted).toEqual([1])
  expect(superseded).toEqual([2])
  expect(transport.queued()).toBe(1)
  transport.complete("code", 1)
  expect(posted).toEqual([1, 3])
  expect(transport.queued()).toBe(0)
})

test("ignores a disposed request response after the key is reused", () => {
  const posted: number[] = []
  const transport = createWorkerTransport<{ id: number; key: string }>({
    post: (request) => posted.push(request.id),
    supersede: () => {},
  })

  transport.send({ id: 1, key: "code" })
  transport.dispose("code")
  transport.send({ id: 2, key: "code" })
  transport.send({ id: 3, key: "code" })
  transport.complete("code", 1)

  expect(posted).toEqual([1, 2])
  expect(transport.queued()).toBe(1)
  transport.complete("code", 2)
  expect(posted).toEqual([1, 2, 3])
})

test("drops queued snapshots when a key is disposed", () => {
  const superseded: number[] = []
  const transport = createWorkerTransport<{ id: number; key: string }>({
    post: () => {},
    supersede: (request) => superseded.push(request.id),
  })

  transport.send({ id: 1, key: "code" })
  transport.send({ id: 2, key: "code" })
  transport.dispose("code")

  expect(superseded).toEqual([2])
  expect(transport.queued()).toBe(0)
})
