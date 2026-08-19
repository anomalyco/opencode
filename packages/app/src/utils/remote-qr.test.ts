import { describe, expect, test } from "bun:test"
import { encodeRemoteQr, REMOTE_QR_SIZE, remoteQrPath } from "./remote-qr"

describe("remote qr", () => {
  test("encodes a representative LAN pairing URL", () => {
    const value = `http://192.168.1.10:4123/remote/mobile#ticket=${"a".repeat(43)}`
    const modules = encodeRemoteQr(value)

    expect(modules).toHaveLength(REMOTE_QR_SIZE)
    expect(modules.every((row) => row.length === REMOTE_QR_SIZE)).toBe(true)
    expect(modules.flat().filter(Boolean)).toHaveLength(878)
    expect(remoteQrPath(modules)).toContain("M4 4h1v1h-1z")
  })

  test("is deterministic", () => {
    const value = `http://10.0.0.5:4096/remote/mobile#ticket=${"b".repeat(43)}`
    expect(encodeRemoteQr(value)).toEqual(encodeRemoteQr(value))
  })

  test("rejects values larger than the version 6 byte capacity", () => {
    expect(() => encodeRemoteQr("x".repeat(135))).toThrow("remote_qr_payload_too_long")
  })
})
