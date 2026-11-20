import { describe, expect, test } from "bun:test"
import { createCipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman } from "node:crypto"
import { Noise } from "@opencode/core/machine/noise"
import { Result } from "effect"
import vectors from "./fixture/noise-xx-vectors.json"

// Every Noise_XX_25519_AESGCM_SHA256 vector in tests/vectors/cacophony.txt and tests/vectors/snow.txt of
// https://github.com/mcginty/snow at commit 8ac60f51cfe3e010c84f0a454cc575ad9204fa12, copied unchanged.

const hex = (value: string) => new Uint8Array(Buffer.from(value, "hex"))
const text = (value: string) => new Uint8Array(Buffer.from(value))
const ok = <A>(result: Result.Result<A, Noise.Failure>) => Result.getOrThrow(result)
const flip = (message: Uint8Array, bit: number) => {
  const copy = message.slice()
  copy[bit >> 3] ^= 1 << (bit & 7)
  return copy
}

const pair = (prologue = text("opencode")) => {
  const initiatorStatic = Noise.generateKeyPair()
  const responderStatic = Noise.generateKeyPair()
  return {
    initiatorStatic,
    responderStatic,
    initiator: ok(Noise.handshake({ initiator: true, prologue, static: initiatorStatic })),
    responder: ok(Noise.handshake({ initiator: false, prologue, static: responderStatic })),
  }
}

/** Runs the whole handshake, from message 1 if the initiator has already written it, and returns its messages. */
const complete = (sides: ReturnType<typeof pair>, written?: Uint8Array) => {
  const first = written ?? ok(sides.initiator.write(text("one")))
  expect(ok(sides.responder.read(first))).toEqual(text("one"))
  const second = ok(sides.responder.write(text("two")))
  expect(ok(sides.initiator.read(second))).toEqual(text("two"))
  const third = ok(sides.initiator.write(text("three")))
  expect(ok(sides.responder.read(third))).toEqual(text("three"))
  return [first, second, third]
}

const transport = () => {
  const sides = pair()
  complete(sides)
  return { initiator: ok(sides.initiator.split()), responder: ok(sides.responder.split()) }
}

describe("Noise", () => {
  test("reproduces every published Noise_XX_25519_AESGCM_SHA256 vector", () => {
    const all = [...vectors["cacophony.txt"], ...vectors["snow.txt"]]
    expect(all).toHaveLength(2)
    for (const vector of all) {
      expect(vector.protocol_name).toBe("Noise_XX_25519_AESGCM_SHA256")
      const initiator = ok(
        Noise.handshake({
          initiator: true,
          prologue: hex(vector.init_prologue),
          static: ok(Noise.keyPair(hex(vector.init_static))),
          ephemeral: ok(Noise.keyPair(hex(vector.init_ephemeral))),
        }),
      )
      const responder = ok(
        Noise.handshake({
          initiator: false,
          prologue: hex(vector.resp_prologue),
          static: ok(Noise.keyPair(hex(vector.resp_static))),
          ephemeral: ok(Noise.keyPair(hex(vector.resp_ephemeral))),
        }),
      )
      // Messages alternate direction from the initiator's first, through the handshake and on into transport.
      const hashes = vector.messages.slice(0, 3).map((message, index) => {
        const sender = index % 2 === 0 ? initiator : responder
        const receiver = index % 2 === 0 ? responder : initiator
        expect(Buffer.from(ok(sender.write(hex(message.payload)))).toString("hex")).toBe(message.ciphertext)
        expect(ok(receiver.read(hex(message.ciphertext)))).toEqual(hex(message.payload))
        // The link signs h after messages 1 and 2, so both sides must agree on it at every step.
        expect(initiator.hash).toEqual(responder.hash)
        return Buffer.from(initiator.hash ?? []).toString("hex")
      })
      expect(new Set(hashes).size).toBe(3)
      if ("handshake_hash" in vector)
        expect(Buffer.from(initiator.hash ?? []).toString("hex")).toBe(vector.handshake_hash)
      expect(initiator.remoteStatic).toEqual(new Uint8Array(ok(Noise.keyPair(hex(vector.resp_static))).publicKey))
      expect(responder.remoteStatic).toEqual(new Uint8Array(ok(Noise.keyPair(hex(vector.init_static))).publicKey))
      const initiatorTransport = ok(initiator.split())
      const responderTransport = ok(responder.split())
      vector.messages.slice(3).forEach((message, index) => {
        // Transport message 0 is the fourth message overall, so the responder sends first.
        const sender = index % 2 === 0 ? responderTransport : initiatorTransport
        const receiver = index % 2 === 0 ? initiatorTransport : responderTransport
        expect(Buffer.from(ok(sender.send.encrypt(hex(message.payload)))).toString("hex")).toBe(message.ciphertext)
        expect(ok(receiver.receive.decrypt(hex(message.ciphertext)))).toEqual(hex(message.payload))
      })
    }
  })

  test("a handshake with fresh keys authenticates both sides and carries messages both ways", () => {
    const sides = pair()
    expect(sides.initiator.remoteStatic).toBeUndefined()
    expect(sides.initiator.hash).toEqual(sides.responder.hash)
    complete(sides)
    expect(sides.initiator.remoteStatic).toEqual(new Uint8Array(sides.responderStatic.publicKey))
    expect(sides.responder.remoteStatic).toEqual(new Uint8Array(sides.initiatorStatic.publicKey))
    expect(sides.initiator.hash).toHaveLength(32)
    expect(sides.initiator.hash).toEqual(sides.responder.hash)
    const initiator = ok(sides.initiator.split())
    const responder = ok(sides.responder.split())
    for (const round of [0, 1, 2]) {
      expect(ok(responder.receive.decrypt(ok(initiator.send.encrypt(text(`up ${round}`)))))).toEqual(
        text(`up ${round}`),
      )
      expect(ok(initiator.receive.decrypt(ok(responder.send.encrypt(text(`down ${round}`)))))).toEqual(
        text(`down ${round}`),
      )
    }
    expect(ok(responder.receive.decrypt(ok(initiator.send.encrypt(new Uint8Array(0)))))).toEqual(new Uint8Array(0))
  })

  test("a flipped bit in any handshake message fails the handshake", () => {
    // One bit per byte, a different bit each time, so the ignored top bit of an X25519 key is covered too.
    const cases = complete(pair()).flatMap((message, index) =>
      Array.from({ length: message.length }, (_, byte) => ({ index, bit: byte * 8 + (byte % 8) })),
    )
    for (const { index, bit } of cases) {
      const sides = pair()
      const sent = ok(sides.initiator.write(text("one")))
      const first = index === 0 ? flip(sent, bit) : sent
      // Message 1 is not authenticated; tampering shows when the initiator reads message 2, which binds it.
      expect(Result.isSuccess(sides.responder.read(first))).toBe(true)
      const reply = ok(sides.responder.write(text("two")))
      const second = sides.initiator.read(index === 1 ? flip(reply, bit) : reply)
      if (index < 2) {
        expect(second).toEqual(Result.fail("BadMessage"))
        expect(sides.initiator.remoteStatic).toBeUndefined()
        continue
      }
      expect(sides.responder.read(flip(ok(sides.initiator.write(text("three"))), bit))).toEqual(
        Result.fail("BadMessage"),
      )
      expect(sides.responder.remoteStatic).toBeUndefined()
      expect(sides.responder.hash).toBeUndefined()
      expect(sides.responder.split()).toEqual(Result.fail("WrongStep"))
    }
  })

  test("a flipped bit in a transport message fails and ends the receiver", () => {
    const length = ok(transport().initiator.send.encrypt(text("hello"))).length * 8
    for (const bit of Array.from({ length }, (_, index) => index)) {
      const sides = transport()
      const sealed = ok(sides.initiator.send.encrypt(text("hello")))
      expect(sides.responder.receive.decrypt(flip(sealed, bit))).toEqual(Result.fail("BadMessage"))
      expect(sides.responder.receive.decrypt(sealed)).toEqual(Result.fail("WrongStep"))
    }
  })

  test("a transport message decrypts only once and only in order", () => {
    const replay = transport()
    const sealed = ok(replay.initiator.send.encrypt(text("once")))
    expect(ok(replay.responder.receive.decrypt(sealed))).toEqual(text("once"))
    expect(replay.responder.receive.decrypt(sealed)).toEqual(Result.fail("BadMessage"))

    const reorder = transport()
    const first = ok(reorder.initiator.send.encrypt(text("first")))
    const second = ok(reorder.initiator.send.encrypt(text("second")))
    expect(reorder.responder.receive.decrypt(second)).toEqual(Result.fail("BadMessage"))
    expect(reorder.responder.receive.decrypt(first)).toEqual(Result.fail("WrongStep"))

    const truncated = transport()
    expect(truncated.responder.receive.decrypt(new Uint8Array(15))).toEqual(Result.fail("BadMessage"))
  })

  test("a rekey sets k to REKEY(k) and keeps the nonce, and a receiver that skips it fails", () => {
    const vector = vectors["cacophony.txt"][0]
    // Fixed keys make every handshake give the same transport keys, so two receivers can hold the same CipherState.
    const fixed = () => {
      const sides = {
        initiator: ok(
          Noise.handshake({
            initiator: true,
            prologue: hex(vector.init_prologue),
            static: ok(Noise.keyPair(hex(vector.init_static))),
            ephemeral: ok(Noise.keyPair(hex(vector.init_ephemeral))),
          }),
        ),
        responder: ok(
          Noise.handshake({
            initiator: false,
            prologue: hex(vector.resp_prologue),
            static: ok(Noise.keyPair(hex(vector.resp_static))),
            ephemeral: ok(Noise.keyPair(hex(vector.resp_ephemeral))),
          }),
        ),
      }
      complete({ ...sides, initiatorStatic: Noise.generateKeyPair(), responderStatic: Noise.generateKeyPair() })
      return { initiator: ok(sides.initiator.split()), responder: ok(sides.responder.split()) }
    }

    // The key schedule again, outside noise.ts: in XX the chaining key depends only on ee, es and se.
    const dh = (privateKey: string, publicKey: string) =>
      new Uint8Array(
        diffieHellman({
          privateKey: createPrivateKey({
            key: Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), hex(privateKey)]),
            format: "der",
            type: "pkcs8",
          }),
          publicKey: createPublicKey({
            key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), hex(publicKey)]),
            format: "der",
            type: "spki",
          }),
        }),
      )
    const hmac = (key: Uint8Array, data: Uint8Array) => new Uint8Array(createHmac("sha256", key).update(data).digest())
    const hkdf = (chainingKey: Uint8Array, input: Uint8Array) => {
      const temp = hmac(chainingKey, input)
      const first = hmac(temp, Uint8Array.of(1))
      return [first, hmac(temp, Buffer.concat([first, Uint8Array.of(2)]))]
    }
    const publicOf = (privateKey: string) => Buffer.from(ok(Noise.keyPair(hex(privateKey))).publicKey).toString("hex")
    const name = new Uint8Array(32)
    name.set(text("Noise_XX_25519_AESGCM_SHA256"))
    const chainingKey = [
      dh(vector.init_ephemeral, publicOf(vector.resp_ephemeral)),
      dh(vector.init_ephemeral, publicOf(vector.resp_static)),
      dh(vector.init_static, publicOf(vector.resp_ephemeral)),
    ].reduce((ck, shared) => hkdf(ck, shared)[0], name)
    const [initiatorKey, responderKey] = hkdf(chainingKey, new Uint8Array(0))
    const seal = (key: Uint8Array, n: bigint, plaintext: Uint8Array) => {
      const nonce = Buffer.alloc(12)
      nonce.writeBigUInt64BE(n, 4)
      const cipher = createCipheriv("aes-256-gcm", key, nonce)
      return new Uint8Array(Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]))
    }
    const rekey = (key: Uint8Array) => seal(key, 2n ** 64n - 1n, new Uint8Array(32)).slice(0, 32)

    for (const [sender, receiver, key] of [
      ["initiator", "responder", initiatorKey],
      ["responder", "initiator", responderKey],
    ] as const) {
      const sides = fixed()
      const skipping = fixed()
      const sealed = [0, 1, 2].map((n) => {
        const message = ok(sides[sender].send.encrypt(text(`message ${n}`)))
        sides[sender].send.rekey()
        return message
      })
      // Message n is sealed under a key rekeyed n times, at nonce n.
      expect(sealed).toEqual([
        seal(key, 0n, text("message 0")),
        seal(rekey(key), 1n, text("message 1")),
        seal(rekey(rekey(key)), 2n, text("message 2")),
      ])
      sealed.forEach((message, n) => {
        expect(ok(sides[receiver].receive.decrypt(message))).toEqual(text(`message ${n}`))
        sides[receiver].receive.rekey()
      })
      expect(ok(skipping[receiver].receive.decrypt(sealed[0]))).toEqual(text("message 0"))
      expect(skipping[receiver].receive.decrypt(sealed[1])).toEqual(Result.fail("BadMessage"))
    }
  })

  test("a call out of turn fails and ends the handshake", () => {
    const readFirst = pair()
    expect(readFirst.initiator.read(new Uint8Array(32))).toEqual(Result.fail("WrongStep"))
    expect(readFirst.initiator.write(text("one"))).toEqual(Result.fail("WrongStep"))

    const writeFirst = pair()
    expect(writeFirst.responder.write(text("two"))).toEqual(Result.fail("WrongStep"))
    expect(writeFirst.responder.read(ok(writeFirst.initiator.write(text("one"))))).toEqual(Result.fail("WrongStep"))

    const early = pair()
    expect(early.initiator.split()).toEqual(Result.fail("WrongStep"))
    expect(early.initiator.write(text("one"))).toEqual(Result.fail("WrongStep"))

    const twice = pair()
    complete(twice)
    expect(Result.isSuccess(twice.initiator.split())).toBe(true)
    expect(twice.initiator.split()).toEqual(Result.fail("WrongStep"))

    const after = pair()
    complete(after)
    expect(after.initiator.write(text("four"))).toEqual(Result.fail("WrongStep"))
    expect(after.initiator.hash).toBeUndefined()
    expect(after.initiator.split()).toEqual(Result.fail("WrongStep"))
  })

  test("the largest payloads fill a 65535-byte message and one byte more is refused", () => {
    // The link and the Rust worker rely on these four numbers.
    const first = pair()
    expect(ok(first.initiator.write(new Uint8Array(65_503)))).toHaveLength(65_535)
    expect(pair().initiator.write(new Uint8Array(65_504))).toEqual(Result.fail("TooLong"))

    const second = (size: number) => {
      const sides = pair()
      ok(sides.responder.read(ok(sides.initiator.write(new Uint8Array(0)))))
      return { sides, message: sides.responder.write(new Uint8Array(size)) }
    }
    expect(ok(second(65_439).message)).toHaveLength(65_535)
    expect(second(65_440).message).toEqual(Result.fail("TooLong"))

    const third = (size: number) => {
      const { sides, message } = second(0)
      ok(sides.initiator.read(ok(message)))
      return sides.initiator.write(new Uint8Array(size))
    }
    expect(ok(third(65_471))).toHaveLength(65_535)
    expect(third(65_472)).toEqual(Result.fail("TooLong"))

    expect(pair().responder.read(new Uint8Array(65_536))).toEqual(Result.fail("TooLong"))

    const sides = transport()
    expect(ok(sides.initiator.send.encrypt(new Uint8Array(65_519)))).toHaveLength(65_535)
    expect(sides.initiator.send.encrypt(new Uint8Array(65_520))).toEqual(Result.fail("TooLong"))
    expect(sides.initiator.send.encrypt(text("after"))).toEqual(Result.fail("WrongStep"))
    expect(sides.responder.receive.decrypt(new Uint8Array(65_536))).toEqual(Result.fail("TooLong"))
  })

  test("a role changed on the options after construction does not reach the handshake", () => {
    const options = { initiator: true, prologue: text("opencode"), static: Noise.generateKeyPair() }
    const sides = { ...pair(), initiator: ok(Noise.handshake(options)) }
    options.initiator = false
    complete(sides)
    const initiator = ok(sides.initiator.split())
    const responder = ok(sides.responder.split())
    expect(ok(responder.receive.decrypt(ok(initiator.send.encrypt(text("up")))))).toEqual(text("up"))
    expect(ok(initiator.receive.decrypt(ok(responder.send.encrypt(text("down")))))).toEqual(text("down"))
  })

  test("never keeps an array its caller holds", () => {
    // Buffer#slice is a view, so a handshake that sliced its input would see the caller reuse the buffer.
    const sides = pair()
    const first = Buffer.from(ok(sides.initiator.write(text("one"))))
    const payload = ok(sides.responder.read(first))
    first.fill(0)
    expect(payload).toEqual(text("one"))
    const second = Buffer.from(ok(sides.responder.write(text("two"))))
    expect(ok(sides.initiator.read(second))).toEqual(text("two"))
    second.fill(0)
    expect(ok(sides.responder.read(ok(sides.initiator.write(text("three")))))).toEqual(text("three"))

    const initiatorStatic = Noise.generateKeyPair()
    const responderStatic = Noise.generateKeyPair()
    const expected = { initiator: initiatorStatic.publicKey.slice(), responder: responderStatic.publicKey.slice() }
    const keyed = {
      initiatorStatic,
      responderStatic,
      initiator: ok(Noise.handshake({ initiator: true, prologue: text("p"), static: initiatorStatic })),
      responder: ok(Noise.handshake({ initiator: false, prologue: text("p"), static: responderStatic })),
    }
    initiatorStatic.publicKey.fill(1)
    initiatorStatic.privateKey.fill(1)
    responderStatic.publicKey.fill(2)
    complete(keyed)
    expect(keyed.responder.remoteStatic).toEqual(expected.initiator)
    expect(keyed.initiator.remoteStatic).toEqual(expected.responder)

    const ephemeral = Noise.generateKeyPair()
    const fixed = pair()
    const initiator = ok(
      Noise.handshake({ initiator: true, prologue: text("opencode"), static: fixed.initiatorStatic, ephemeral }),
    )
    const sent = ephemeral.publicKey.slice()
    ephemeral.publicKey.fill(3)
    ephemeral.privateKey.fill(3)
    const message = ok(initiator.write(text("one")))
    expect(message.subarray(0, 32)).toEqual(sent)
    complete({ ...fixed, initiator }, message)

    const privateKey = hex(vectors["cacophony.txt"][0].init_static)
    const derived = ok(Noise.keyPair(privateKey))
    privateKey.fill(0)
    expect(derived.privateKey).toEqual(hex(vectors["cacophony.txt"][0].init_static))
  })

  test("never hands out an array it keeps", () => {
    const sides = pair()
    complete(sides)
    const hash = sides.initiator.hash ?? new Uint8Array(0)
    const remote = sides.initiator.remoteStatic ?? new Uint8Array(0)
    hash.fill(0)
    remote.fill(0)
    expect(sides.initiator.hash).toEqual(sides.responder.hash)
    expect(sides.initiator.remoteStatic).toEqual(new Uint8Array(sides.responderStatic.publicKey))
  })

  test("refuses a key that is not 32 bytes", () => {
    for (const size of [0, 31, 33, 64])
      expect(Noise.keyPair(new Uint8Array(size).fill(9))).toEqual(Result.fail("BadKey"))
    const good = Noise.generateKeyPair()
    for (const bad of [
      { static: { ...good, publicKey: new Uint8Array(31) } },
      { static: { ...good, privateKey: new Uint8Array(33) } },
      { static: good, ephemeral: { ...good, publicKey: new Uint8Array(0) } },
      { static: good, ephemeral: { ...good, privateKey: new Uint8Array(64) } },
    ])
      expect(Noise.handshake({ initiator: true, prologue: text("p"), ...bad })).toEqual(Result.fail("BadKey"))
  })

  test("refuses a low-order key share", () => {
    // This runtime's X25519 refuses all of these; snow's default resolver returns the all-zero output instead. The
    // spec permits either, and it only matters against a peer that is already cheating.
    // Zero, one, and a point of order 8: each gives an all-zero X25519 output for every private key.
    for (const point of [
      new Uint8Array(32),
      hex("0100000000000000000000000000000000000000000000000000000000000000"),
      hex("e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800"),
    ]) {
      const sides = pair()
      // Message 1 carries no DH; the responder fails at "ee", when it first uses the key.
      expect(ok(sides.responder.read(point))).toEqual(new Uint8Array(0))
      expect(sides.responder.write(text("two"))).toEqual(Result.fail("BadMessage"))
    }
  })

  test("two handshakes with the same static keys use fresh ephemeral keys", () => {
    const prologue = text("opencode")
    const initiatorStatic = Noise.generateKeyPair()
    const responderStatic = Noise.generateKeyPair()
    const messages = [0, 1].map(() => {
      const initiator = ok(Noise.handshake({ initiator: true, prologue, static: initiatorStatic }))
      const responder = ok(Noise.handshake({ initiator: false, prologue, static: responderStatic }))
      const first = ok(initiator.write(new Uint8Array(0)))
      ok(responder.read(first))
      return [first, ok(responder.write(new Uint8Array(0)))]
    })
    expect(messages[0][0]).not.toEqual(messages[1][0])
    expect(messages[0][1].subarray(0, 32)).not.toEqual(messages[1][1].subarray(0, 32))
  })
})
