import { expect, test } from "bun:test"
import { format, isManagedService, marker } from "../src/services/port-owner"

test("recognizes the managed service among port holders", () => {
  expect(isManagedService("/home/user/.local/bin/opencode serve --service")).toBe(true)
  expect(isManagedService("/home/user/.opencode/desktop-ssh/2.0.26/opencode serve --service")).toBe(true)
  expect(isManagedService("/usr/bin/node /usr/lib/node_modules/opencode-ai/bin/opencode.js serve --service")).toBe(true)
  expect(isManagedService("/tmp/opencode-block/opencode.ts serve --service --port 49374")).toBe(true)

  expect(isManagedService("python3 -m http.server 49374 --bind 127.0.0.1")).toBe(false)
  expect(isManagedService("/usr/bin/opencode-notify --service")).toBe(false)
  expect(isManagedService("/opt/opencode-serve server")).toBe(false)
  expect(isManagedService("/usr/bin/opencode")).toBe(false)
})

test("describes only the owners it can name", () => {
  expect(format({ kind: "none" })).toBe("another process")
  expect(format({ kind: "unknown" })).toBe("another process")
  expect(format({ kind: "unknown", pid: "42" })).toBe("PID 42")
  expect(format({ kind: "foreign", pid: "42", command: "python3 server.py" })).toBe("PID 42 (python3 server.py)")
})

test("marks the owner for the SSH bootstrap", () => {
  expect(marker({ kind: "none" })).toBe("OPENCODE_SERVICE_PORT_OWNER=none")
  expect(marker({ kind: "unknown", pid: "9" })).toBe(
    "OPENCODE_SERVICE_PORT_OWNER=unknown\nOPENCODE_SERVICE_PORT_OWNER_PID=9",
  )
  expect(marker({ kind: "opencode", pid: "42", command: "opencode serve --service" })).toBe(
    "OPENCODE_SERVICE_PORT_OWNER=opencode\nOPENCODE_SERVICE_PORT_OWNER_PID=42",
  )
})
