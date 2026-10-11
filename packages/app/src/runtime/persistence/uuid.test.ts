import { afterEach, describe, expect, test } from "bun:test"
import { uuid } from "./uuid"

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")

const secureDescriptor = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext")

const randomDescriptor = Object.getOwnPropertyDescriptor(Math, "random")

const setCrypto = (value: Partial<Crypto>) => {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: value as Crypto,
  })
}

const setSecure = (value: boolean) => {
  Object.defineProperty(globalThis, "isSecureContext", {
    configurable: true,
    value,
  })
}

const setRandom = (value: () => number) => {
  Object.defineProperty(Math, "random", {
    configurable: true,
    value,
  })
}

afterEach(() => {
  if (cryptoDescriptor) {
    Object.defineProperty(globalThis, "crypto", cryptoDescriptor)
  }

  if (secureDescriptor) {
    Object.defineProperty(globalThis, "isSecureContext", secureDescriptor)
  }

  if (!secureDescriptor) {
    delete (globalThis as { isSecureContext?: boolean }).isSecureContext
  }

  if (randomDescriptor) {
    Object.defineProperty(Math, "random", randomDescriptor)
  }
})

describe("uuid", () => {
  test("uses randomUUID in secure contexts", () => {
    setCrypto({ randomUUID: () => "00000000-0000-0000-0000-000000000000" })
    setSecure(true)
    expect(uuid()).toBe("00000000-0000-0000-0000-000000000000")
  })

  const fallbacks: { name: string; secure: boolean; crypto: Partial<Crypto> }[] = [
    {
      name: "in insecure contexts",
      secure: false,
      crypto: { randomUUID: () => "00000000-0000-0000-0000-000000000000" },
    },
    {
      name: "when randomUUID throws",
      secure: true,
      crypto: {
        randomUUID: () => {
          throw new DOMException("Failed", "OperationError")
        },
      },
    },
    { name: "when randomUUID is unavailable", secure: true, crypto: {} },
  ]

  test.each(fallbacks)("falls back $name", (row) => {
    setCrypto(row.crypto)
    setSecure(row.secure)
    setRandom(() => 0.5)
    expect(uuid()).toBe("8")
  })
})
