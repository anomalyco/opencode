export * as Noise from "./noise.js"

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto"
import { Result } from "effect"
import { X25519 } from "./x25519.js"

// Noise_XX_25519_AESGCM_SHA256 as the Noise Protocol Framework, revision 34, defines it:
// https://noiseprotocol.org/noise.html. Section numbers below refer to that text.
//
// Bytes are copied on the way in and on the way out: this module never keeps an array its caller holds and never hands
// out one it keeps, so a caller reusing a socket buffer or filling a returned key cannot change a handshake.

const PROTOCOL_NAME = "Noise_XX_25519_AESGCM_SHA256"
const DHLEN = 32
const HASHLEN = 32
const TAGLEN = 16
const MAX_MESSAGE = 65_535
const MAX_NONCE = 2n ** 64n - 1n
const EMPTY = new Uint8Array(0)
// Section 7.5. XX has no pre-messages; the initiator writes messages 1 and 3, the responder message 2.
const PATTERN = [["e"], ["e", "ee", "s", "es"], ["s", "se"]] as const

/**
 * Every failure ends the handshake or cipher it came from: later calls fail with `WrongStep`. `BadKey` is a key that
 * is not 32 bytes, refused before a key pair or handshake exists.
 */
export type Failure = "WrongStep" | "BadMessage" | "TooLong" | "BadKey"

const wrongStep = Result.fail<Failure>("WrongStep")
const badMessage = Result.fail<Failure>("BadMessage")
const tooLong = Result.fail<Failure>("TooLong")
const badKey = Result.fail<Failure>("BadKey")

/** The two CipherStates of section 5.2's Split: one for the messages this side sends, one for those it receives. */
export interface Transport {
  readonly send: {
    readonly encrypt: (plaintext: Uint8Array) => Result.Result<Uint8Array, Failure>
    readonly rekey: () => void
  }
  /** Any message but the next one fails: transport messages arrive in order or not at all. */
  readonly receive: {
    readonly decrypt: (ciphertext: Uint8Array) => Result.Result<Uint8Array, Failure>
    readonly rekey: () => void
  }
}

/**
 * Raw 32-byte X25519 keys. Nothing here zeroes a private key after use: the runtime keeps copies this module cannot
 * reach, so it would be theatre. Dropping the handshake when it is done is the real lifetime control.
 */
export interface KeyPair {
  readonly publicKey: Uint8Array
  readonly privateKey: Uint8Array
}

export interface Options {
  readonly initiator: boolean
  readonly prologue: Uint8Array
  readonly static: KeyPair
  /**
   * Only for reproducing published test vectors, which fix it. Production callers omit it and get a fresh key pair:
   * an ephemeral used twice gives up forward secrecy.
   */
  readonly ephemeral?: KeyPair
}

/** Section 12.1 GENERATE_KEYPAIR: any 32 random bytes are an X25519 private key. */
export const generateKeyPair = () => derive(new Uint8Array(randomBytes(DHLEN)))

/** The key pair of a raw 32-byte X25519 private key. */
export const keyPair = (privateKey: Uint8Array) =>
  privateKey.length === DHLEN ? Result.succeed(derive(new Uint8Array(privateKey))) : badKey

/** Section 5.3: an XX HandshakeState for one side, or `BadKey` when a key in `options` is not 32 bytes. */
export const handshake = (options: Options) => {
  const keys = options.ephemeral ? [options.static, options.ephemeral] : [options.static]
  if (!keys.every((pair) => pair.publicKey.length === DHLEN && pair.privateKey.length === DHLEN)) return badKey
  // Read once: a role or key changed on `options` later must not reach this handshake.
  const initiator = options.initiator
  const s = copyKeyPair(options.static)
  const e = options.ephemeral ? copyKeyPair(options.ephemeral) : generateKeyPair()
  // Section 5.2 InitializeSymmetric: the name fits in HASHLEN, so h is the name padded with zeros, not its hash.
  let h = new Uint8Array(HASHLEN)
  h.set(Buffer.from(PROTOCOL_NAME))
  let ck = h
  let cipher = cipherState(undefined)
  let re: Uint8Array | undefined
  let rs: Uint8Array | undefined
  let step = 0
  let taken = false
  let failed = false

  const mixHash = (data: Uint8Array) => {
    h = new Uint8Array(createHash("sha256").update(h).update(data).digest())
  }
  const mixKey = (inputKeyMaterial: Uint8Array) => {
    const [chainingKey, tempK] = hkdf(ck, inputKeyMaterial)
    ck = chainingKey
    cipher = cipherState(tempK)
  }
  const encryptAndHash = (plaintext: Uint8Array) =>
    Result.map(cipher.encryptWithAd(h, plaintext), (ciphertext) => {
      mixHash(ciphertext)
      return ciphertext
    })
  const decryptAndHash = (ciphertext: Uint8Array) =>
    Result.map(cipher.decryptWithAd(h, ciphertext), (plaintext) => {
      mixHash(ciphertext)
      return plaintext
    })
  // Section 7: in "es" the first letter is the initiator's key and the second the responder's; each side uses the
  // private key it holds and the public key it received.
  const mixDh = (token: "ee" | "es" | "se") => {
    const local = initiator ? token[0] : token[1]
    const remote = initiator ? token[1] : token[0]
    const remoteKey = remote === "e" ? re : rs
    if (remoteKey === undefined) return badMessage
    return Result.map(dh(local === "e" ? e : s, remoteKey), mixKey)
  }
  const turn = (writing: boolean) => !failed && step < PATTERN.length && (step % 2 === 0) === (initiator === writing)
  const guard = <A>(result: Result.Result<A, Failure>) => {
    if (Result.isFailure(result)) failed = true
    return result
  }

  mixHash(options.prologue)

  return Result.succeed({
    /** Section 5.3 WriteMessage: the next handshake message, carrying `payload`. */
    write: (payload: Uint8Array) =>
      guard(
        Result.gen(function* () {
          if (!turn(true)) return yield* wrongStep
          const parts: Uint8Array[] = []
          for (const token of PATTERN[step]) {
            if (token === "e") {
              parts.push(e.publicKey)
              mixHash(e.publicKey)
              continue
            }
            if (token === "s") {
              parts.push(yield* encryptAndHash(s.publicKey))
              continue
            }
            yield* mixDh(token)
          }
          parts.push(yield* encryptAndHash(payload))
          const message = new Uint8Array(Buffer.concat(parts))
          if (message.length > MAX_MESSAGE) return yield* tooLong
          step++
          return message
        }),
      ),
    /** Section 5.3 ReadMessage: the payload inside the peer's next handshake message. */
    read: (message: Uint8Array) =>
      guard(
        Result.gen(function* () {
          if (!turn(false)) return yield* wrongStep
          if (message.length > MAX_MESSAGE) return yield* tooLong
          let offset = 0
          for (const token of PATTERN[step]) {
            if (token === "e") {
              if (message.length - offset < DHLEN) return yield* badMessage
              re = new Uint8Array(message.subarray(offset, offset + DHLEN))
              offset += DHLEN
              mixHash(re)
              continue
            }
            if (token === "s") {
              const length = DHLEN + (cipher.hasKey() ? TAGLEN : 0)
              if (message.length - offset < length) return yield* badMessage
              rs = yield* decryptAndHash(message.subarray(offset, offset + length))
              offset += length
              continue
            }
            yield* mixDh(token)
          }
          const payload = yield* decryptAndHash(message.subarray(offset))
          step++
          return payload
        }),
      ),
    /** The peer's static public key, once the message carrying it has been read and authenticated. */
    get remoteStatic() {
      return failed || rs === undefined ? undefined : new Uint8Array(rs)
    },
    /**
     * The handshake hash h so far: before message 1 it covers the protocol name and prologue, after each message every
     * message up to it. Once the handshake is complete it is the channel binding of section 11.2.
     */
    get hash() {
      return failed ? undefined : new Uint8Array(h)
    },
    /** Section 5.2 Split, once: a second pair of CipherStates with the same keys would reuse nonces. */
    split: () => {
      if (failed || taken || step < PATTERN.length) return guard(wrongStep)
      taken = true
      const [initiatorToResponder, responderToInitiator] = hkdf(ck, EMPTY)
      const send = cipherState(initiator ? initiatorToResponder : responderToInitiator)
      const receive = cipherState(initiator ? responderToInitiator : initiatorToResponder)
      return Result.succeed<Transport>({
        send: { encrypt: (plaintext) => send.encryptWithAd(EMPTY, plaintext), rekey: send.rekey },
        receive: { decrypt: (ciphertext) => receive.decryptWithAd(EMPTY, ciphertext), rekey: receive.rekey },
      })
    },
  })
}

/**
 * Section 5.1. Unlike the spec, which keeps n after a failed DECRYPT so a caller may skip the message, any failure ends
 * the CipherState: on an ordered link a forged or lost message ends the link.
 */
const cipherState = (initial: Uint8Array | undefined) => {
  let k = initial
  let n = 0n
  let failed = false
  const usable = () => !failed && n < MAX_NONCE
  const advance = (result: Result.Result<Uint8Array, Failure>) => {
    failed = Result.isFailure(result)
    n++
    return result
  }
  return {
    hasKey: () => k !== undefined,
    encryptWithAd: (ad: Uint8Array, plaintext: Uint8Array) => {
      if (k === undefined) return Result.succeed(new Uint8Array(plaintext))
      if (!usable()) return wrongStep
      if (plaintext.length + TAGLEN > MAX_MESSAGE) return advance(tooLong)
      return advance(Result.succeed(encrypt(k, n, ad, plaintext)))
    },
    decryptWithAd: (ad: Uint8Array, ciphertext: Uint8Array) => {
      if (k === undefined) return Result.succeed(new Uint8Array(ciphertext))
      if (!usable()) return wrongStep
      if (ciphertext.length > MAX_MESSAGE) return advance(tooLong)
      return advance(decrypt(k, n, ad, ciphertext))
    },
    /**
     * Section 5.1 Rekey() with section 4.2's default REKEY: k becomes the first 32 bytes of
     * ENCRYPT(k, maxnonce, zerolen, zeros[32]). n is kept.
     */
    rekey: () => {
      if (k !== undefined) k = encrypt(k, MAX_NONCE, EMPTY, new Uint8Array(32)).slice(0, 32)
    },
  }
}

/**
 * Section 12.1 DH, with x25519.ts rather than `node:crypto`, which workerd cannot use with a raw peer key. The spec
 * allows an invalid public key to be an error: a low-order point gives the all-zero output, refused here.
 */
const dh = (keyPair: KeyPair, publicKey: Uint8Array) => {
  const shared = X25519.scalarMult(keyPair.privateKey, publicKey)
  // OR every byte rather than stop at the first non-zero one, so the time taken says nothing about the secret.
  if (shared.reduce((bits, byte) => bits | byte, 0) === 0) return badMessage
  return Result.succeed(shared)
}

/** Section 12.3 AESGCM: 32 zero bits, then the counter as a 64-bit big-endian integer. */
const nonce = (n: bigint) => {
  const bytes = Buffer.alloc(12)
  bytes.writeBigUInt64BE(n, 4)
  return bytes
}

// workerd's AES-GCM fails `final` with "Authentication failed" after `setAAD` or `update` with zero bytes, which every
// transport message's empty ad and every empty payload would hit. GCM defines empty ad and empty text as no ad and no
// text (NIST SP 800-38D), so skipping those calls gives the same bytes on every runtime.

/** Section 12.3 ENCRYPT: the 16-byte tag is appended to the ciphertext. */
const encrypt = (k: Uint8Array, n: bigint, ad: Uint8Array, plaintext: Uint8Array) => {
  const cipher = createCipheriv("aes-256-gcm", k, nonce(n), { authTagLength: TAGLEN })
  if (ad.length > 0) cipher.setAAD(ad)
  const body = plaintext.length > 0 ? cipher.update(plaintext) : EMPTY
  return new Uint8Array(Buffer.concat([body, cipher.final(), cipher.getAuthTag()]))
}

/** Section 12.3 DECRYPT. The tag check inside `final` is the only comparison of secrets this module makes. */
const decrypt = (k: Uint8Array, n: bigint, ad: Uint8Array, ciphertext: Uint8Array) => {
  if (ciphertext.length < TAGLEN) return badMessage
  const decipher = createDecipheriv("aes-256-gcm", k, nonce(n), { authTagLength: TAGLEN })
  if (ad.length > 0) decipher.setAAD(ad)
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - TAGLEN))
  const plaintext =
    ciphertext.length > TAGLEN ? decipher.update(ciphertext.subarray(0, ciphertext.length - TAGLEN)) : EMPTY
  try {
    return Result.succeed(new Uint8Array(Buffer.concat([plaintext, decipher.final()])))
  } catch {
    return badMessage
  }
}

/** Section 4.3 HKDF with two outputs, the only count XX uses; three outputs are for PSK modes. */
const hkdf = (chainingKey: Uint8Array, inputKeyMaterial: Uint8Array) => {
  const tempKey = hmac(chainingKey, inputKeyMaterial)
  const output1 = hmac(tempKey, Uint8Array.of(0x01))
  return [output1, hmac(tempKey, Buffer.concat([output1, Uint8Array.of(0x02)]))] as const
}

const hmac = (key: Uint8Array, data: Uint8Array) => new Uint8Array(createHmac("sha256", key).update(data).digest())

const derive = (privateKey: Uint8Array): KeyPair => ({
  publicKey: X25519.scalarMult(privateKey, X25519.BASE),
  privateKey,
})

const copyKeyPair = (pair: KeyPair): KeyPair => ({
  publicKey: new Uint8Array(pair.publicKey),
  privateKey: new Uint8Array(pair.privateKey),
})
