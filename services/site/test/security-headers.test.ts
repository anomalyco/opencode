import { describe, expect, test } from "bun:test"
import path from "node:path"
import { Glob } from "bun"
import { securityHeaders } from "../src/lib/security-headers"

const src = path.join(import.meta.dir, "../src")
const code = (
  await Promise.all(
    (await Array.fromAsync(new Glob("**/*.{ts,tsx}").scan({ cwd: src }))).map((file) =>
      Bun.file(path.join(src, file)).text(),
    ),
  )
).join("\n")

// The code that would need each feature the policy turns off.
const uses: Record<string, RegExp> = {
  camera: /getUserMedia\([^)]*video|allow="[^"]*camera/,
  geolocation: /navigator\.geolocation|allow="[^"]*geolocation/,
  payment: /PaymentRequest|allow="[^"]*payment/,
  usb: /navigator\.usb|allow="[^"]*usb/,
  microphone: /getUserMedia\(/,
}

describe("security headers", () => {
  const blocked = securityHeaders["Permissions-Policy"].split(", ").map((rule) => rule.replace(/=\(\)$/, ""))

  test("every feature the policy blocks is one the site never uses", () => {
    expect(blocked.filter((feature) => !(feature in uses) || uses[feature].test(code))).toEqual([])
  })

  test("voice mode keeps the microphone", () => {
    expect(uses.microphone.test(code)).toBe(true)
    expect(securityHeaders["Permissions-Policy"]).not.toContain("microphone")
  })
})
