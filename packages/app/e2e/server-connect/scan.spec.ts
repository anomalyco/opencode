import { expect, test } from "@playwright/test"
import { writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { encode } from "uqr"

const video = path.join(tmpdir(), `opencode-pairing-${process.pid}.y4m`)
const pairing = {
  urls: ["http://192.168.1.20:4096", "http://[fd00::1]:4096"],
  username: "opencode",
  password: "qr-test-password",
}

test.use({
  viewport: { width: 390, height: 844 },
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${video}`,
    ],
  },
})

test.beforeAll(async () => {
  // Feed the real decoder an inverted terminal QR through Chromium's virtual camera.
  const qr = encode(JSON.stringify(pairing), { border: 4, invert: true })
  const size = 640
  const scale = Math.floor(400 / qr.size)
  const offset = Math.floor((size - qr.size * scale) / 2)
  const luma = Buffer.from(
    Array.from({ length: size * size }, (_, index) => {
      const row = Math.floor((Math.floor(index / size) - offset) / scale)
      const column = Math.floor(((index % size) - offset) / scale)
      return qr.data[row]?.[column] === false ? 235 : 16
    }),
  )
  await writeFile(
    video,
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${size} H${size} F10:1 Ip A1:1 C420jpeg\nFRAME\n`),
      luma,
      Buffer.alloc((size * size) / 2, 128),
    ]),
  )
})

test.afterAll(() => rm(video, { force: true }))

test("scans opencode pair into the address and password fields", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Scan QR code" }).click()
  await expect(page.getByLabel("Server address")).toHaveValue(pairing.urls[0])
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(pairing.password)
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password")
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toBeEnabled()
  await expect(page.getByLabel("Pairing camera")).toHaveCount(0)
})
