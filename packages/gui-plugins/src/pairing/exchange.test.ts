import { afterEach, expect, test } from "bun:test"
import { Schema } from "effect"
import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto"
import { createServer, connect, type Server, type Socket } from "node:net"
import {
  bytes,
  commitment,
  decode,
  frame,
  frames,
  initiate,
  keyPair,
  messages,
  open,
  rawPublicKey,
  receive,
  seal,
  sessionKeys,
  sha256,
  shortCode,
  type Session,
} from "./exchange"

const servers: Server[] = []

afterEach(() => {
  servers.splice(0).forEach((server) => server.close())
})

const PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex")

/** A fixed X25519 key, so the vectors below are the same in every implementation. */
function fixedKey(byte: number) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.alloc(32, byte)]),
    format: "der",
    type: "pkcs8",
  })

  return { privateKey, publicKey: rawPublicKey(createPublicKey(privateKey)) }
}

test("vectors: commitment, code and keys match across implementations", () => {
  const desktop = fixedKey(1)
  const phone = fixedKey(2)
  const nD = Buffer.alloc(16, 3)
  const nP = Buffer.alloc(16, 4)
  const transcript = sha256(Buffer.from("transcript"))
  const fromDesktop = sessionKeys(desktop.privateKey, phone.publicKey, transcript)
  const fromPhone = sessionKeys(phone.privateKey, desktop.publicKey, transcript)

  expect(fromDesktop).toEqual(fromPhone)
  expect({
    desktopKey: desktop.publicKey.toString("hex"),
    phoneKey: phone.publicKey.toString("hex"),
    commitment: commitment(phone.publicKey, desktop.publicKey, nP).toString("hex"),
    code: shortCode(desktop.publicKey, phone.publicKey, nD, nP),
    dp: fromDesktop.dp.toString("hex"),
    pd: fromDesktop.pd.toString("hex"),
  }).toMatchSnapshot()
})

/**
 * The phone's side: commit, reveal, confirm when told, then report done. It listens here so the tests can connect
 * from the desktop's side; the app connects instead, and the exchange is the same either way.
 */
async function phone(options: { confirm?: boolean; tamper?: boolean } = {}) {
  const result = Promise.withResolvers<{ code: string; payload?: unknown }>()
  const shown = Promise.withResolvers<string>()
  // A test that ends the exchange from the desktop never reads the phone's outcome.
  result.promise.catch(() => undefined)

  const server = createServer((socket: Socket) => {
    const next = frames(socket)

    const run = async () => {
      const helloFrame = await next(1000)
      const hello = decode(messages.Hello, helloFrame)
      const desktopKey = bytes(hello.pk, 32)
      const keys = keyPair()
      const nP = randomBytes(16)

      const commitFrame = frame({
        type: "commit",
        pk: keys.publicKey.toString("base64url"),
        c: commitment(keys.publicKey, desktopKey, nP).toString("base64url"),
        name: "Test iPhone",
      })

      socket.write(commitFrame)
      const nonceFrame = await next(1000)
      const nD = bytes(decode(messages.Nonce, nonceFrame).n, 16)
      // A phone that reveals a nonce it did not commit to is what an attacker in the middle would have to do.
      const revealFrame = frame({ type: "reveal", n: (options.tamper ? randomBytes(16) : nP).toString("base64url") })
      socket.write(revealFrame)
      const transcript = sha256(helloFrame, commitFrame, nonceFrame, revealFrame)
      const derived = sessionKeys(keys.privateKey, desktopKey, transcript)
      const session: Session = { send: derived.pd, receive: derived.dp, transcript, sent: { n: 0n }, received: { n: 0n } }
      const code = shortCode(desktopKey, keys.publicKey, nD, nP)
      shown.resolve(code)
      socket.write(seal(session, { type: options.confirm === false ? "cancel" : "confirm" }))

      if (options.confirm === false) return result.resolve({ code })
      const payload = await receive(session, next, "payload", 1000)
      socket.write(seal(session, { type: "done" }))
      result.resolve({ code, payload })
    }

    run().catch((error: Error) => result.reject(error))
  })

  servers.push(server)

  const port = await new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      resolve(Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(address).port)
    }),
  )

  return { port, result: result.promise, shown: shown.promise }
}

const payload = { code: "pairing-code", urls: ["http://192.168.1.2:49374"], expires_in: 300 }

test("both sides show the same code, and the phone gets the payload once both confirm", async () => {
  const device = await phone()

  const exchange = initiate(connect(device.port, "127.0.0.1"), {
    name: "OpenCode on test",
    id: "install",
    payload: async () => payload,
  })

  const { code, device: name } = await exchange.code

  expect(name).toBe("Test iPhone")
  expect(code).toMatch(/^\d{6}$/)
  expect(code).toBe(await device.shown)
  exchange.approve()
  await exchange.done
  expect(await device.result).toEqual({
    code,
    payload: { type: "payload", ...payload, name: "OpenCode on test", id: "install" },
  })
})

test("the payload is never asked for until the desktop user confirms", async () => {
  const device = await phone()
  const asked = { count: 0 }

  const exchange = initiate(connect(device.port, "127.0.0.1"), {
    name: "OpenCode on test",
    id: "install",
    payload: async () => {
      asked.count += 1

      return payload
    },
  })

  await exchange.code
  await Bun.sleep(20)

  expect(asked.count).toBe(0)
  exchange.cancel()
  await expect(exchange.done).rejects.toThrow("cancelled")
  expect(asked.count).toBe(0)
})

test("a phone that cancels ends the exchange without a payload", async () => {
  const device = await phone({ confirm: false })
  const asked = { count: 0 }

  const exchange = initiate(connect(device.port, "127.0.0.1"), {
    name: "OpenCode on test",
    id: "install",
    payload: async () => {
      asked.count += 1

      return payload
    },
  })

  exchange.approve()

  await expect(exchange.done).rejects.toThrow("cancelled on the other device")
  expect(asked.count).toBe(0)
})

test("a reveal that does not match the commitment ends the exchange before any code shows", async () => {
  const device = await phone({ tamper: true })

  const exchange = initiate(connect(device.port, "127.0.0.1"), {
    name: "OpenCode on test",
    id: "install",
    payload: async () => payload,
  })

  await expect(exchange.done).rejects.toThrow("commitment")
  await expect(exchange.code).rejects.toThrow("commitment")
})

test("a replayed sealed frame is refused", () => {
  const key = randomBytes(32)
  const transcript = randomBytes(32)
  const sender: Session = { send: key, receive: key, transcript, sent: { n: 0n }, received: { n: 0n } }
  const receiver: Session = { send: key, receive: key, transcript, sent: { n: 0n }, received: { n: 0n } }
  const sealed = decode(messages.Sealed, seal(sender, { type: "confirm" }))

  expect(open(receiver, sealed)).toEqual({ type: "confirm" })
  expect(() => open(receiver, sealed)).toThrow("unexpected sealed frame")
})
