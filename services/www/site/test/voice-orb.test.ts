import { describe, expect, test } from "bun:test"
import { siteSettingsSchema } from "~/component/site/settings"

// The voice orb is rendered into its own Solid root (voice/host.ts) so page changes don't dispose it.
// Nov 2026: that root lost the app's providers when VoiceMode began using i18n, and the orb vanished
// from every page in dev without a visible error. A root whose function takes no arguments is
// "unowned" in Solid and has no context; this guards the one-argument form, and the defaults.
describe("voice orb", () => {
  test("its root keeps the caller's owner, so VoiceMode sees the app's providers", async () => {
    const source = await Bun.file(new URL("../src/component/site/voice/host.ts", import.meta.url)).text()
    expect(source).toContain("getOwner()")
    expect(source).toMatch(/createRoot\(\(\w+\) =>[^]*?,\s*owner\s*,?\s*\)/)
  })

  test("shows by default everywhere, production included (as the Hex promo)", () => {
    expect(siteSettingsSchema.parse({}).voiceOrb).toBe("always")
  })

  // For launch the orb is a Hex promo: voice mode's code, audio and speech must not load with it.
  test("voice mode is off and only the Hex promo loads", async () => {
    const { voiceMode } = await import("~/component/site/voice/flag")
    expect(voiceMode).toBe(false)
    const host = await Bun.file(new URL("../src/component/site/voice/host.ts", import.meta.url)).text()
    expect(host).toMatch(/voiceMode \? import\("\.\/voice-mode"\) : import\("\.\/hex-promo"\)/)
    const promo = await Bun.file(new URL("../src/component/site/voice/hex-promo.tsx", import.meta.url)).text()
    for (const heavy of [
      '"./voice-mode"',
      "wisp-orb",
      "dot-scope",
      "./state",
      "/api/voice",
      "getUserMedia",
      "SpeechRecognition",
    ])
      expect(promo).not.toContain(heavy)
  })
})
