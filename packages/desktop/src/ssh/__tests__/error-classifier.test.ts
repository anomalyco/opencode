import { describe, expect, test } from "bun:test"
import { classifySshError } from "../error-classifier"

describe("SSH Error Classification", () => {
  test("classifies host key failures", () => {
    const error = classifySshError("Host key verification failed", "Host key verification failed")
    expect(error.bucket).toEqual("host-key-failure")
  })

  test("classifies authentication failures", () => {
    const error = classifySshError("Permission denied", "Permission denied (publickey)")
    expect(error.bucket).toEqual("auth-failure")
  })

  test("classifies config errors", () => {
    const error = classifySshError("Bad configuration option", "Bad configuration option: Foo")
    expect(error.bucket).toEqual("config-error")
  })

  test("classifies network failures", () => {
    const error = classifySshError("Connection timed out", "ssh: connect to host example.com port 22")
    expect(error.bucket).toEqual("network-failure")
  })

  test("classifies port forwarding failures", () => {
    const error = classifySshError("Forwarding failed", "channel 0: open failed: administratively prohibited")
    expect(error.bucket).toEqual("port-forward-failure")
  })

  test("defaults to unknown bucket", () => {
    const error = classifySshError("Something unexpected", "Unknown failure")
    expect(error.bucket).toEqual("unknown")
  })
})
