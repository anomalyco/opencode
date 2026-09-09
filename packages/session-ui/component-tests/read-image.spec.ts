import { fileURLToPath } from "node:url"
import { expect, story } from "../../storybook/playwright/story"

const fixture = `/@fs/${fileURLToPath(new URL("./read-image.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ioAAAAASUVORK5CYII=",
  "base64",
)

story.beforeEach(async ({ mount }) => {
  const root = await mount("current-tool-group--mixed-tools")
  await expect(root.getByRole("button", { name: "Used 4 Shell, Read, Agent", exact: true })).toBeVisible()
})

for (const grouped of [true, false]) {
  story(
    `lazily previews ${grouped ? "grouped" : "standalone"} image reads and releases them on collapse`,
    async ({ page }) => {
      const requests: string[] = []
      await page.route("**/api/fs/read/**", async (route) => {
        expect(route.request().headers().authorization).toBe(
          `Basic ${Buffer.from("opencode:fixture").toString("base64")}`,
        )
        requests.push(route.request().url())
        await route.fulfill({ contentType: "image/png", body: png })
      })
      await page.evaluate(
        async ({ fixture, grouped }) => {
          const { mountReadImage } = await import(fixture)
          mountReadImage({ path: "C:\\tmp\\chart%20 one.PNG", grouped, running: true })
        },
        { fixture, grouped },
      )
      const root = page.getByTestId("read-image-fixture")
      const trigger = root.getByRole("button", { name: "Read chart%20 one.PNG", exact: true })
      const image = root.getByRole("img", { name: "chart%20 one.PNG", exact: true })
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await trigger.click()
      await expect(trigger).toHaveAttribute("aria-expanded", "false")
      await root.getByRole("button", { name: "Finish read", exact: true }).click()
      await expect(trigger.locator('[data-slot="collapsible-arrow"]')).toBeVisible()
      expect(requests).toEqual([])
      await expect(image).toHaveCount(0)
      if (grouped) {
        const text = root.locator('[data-slot="context-tool-group-item"]').filter({ hasText: "example.ts" })
        await expect(text).toContainText("limit=20")
        await expect(text.getByRole("button")).toHaveCount(0)
      }
      for (const action of ["click", "Enter", "Space"]) {
        if (action === "click") await trigger.click()
        if (action !== "click") await trigger.press(action)
        await expect(trigger).toHaveAttribute("aria-expanded", "true")
        await expect(image).toHaveJSProperty("naturalWidth", 1)
        await expect(image).toHaveAttribute("src", /^blob:/)
        const url = await image.getAttribute("src")
        if (action === "click") {
          expect(requests).toHaveLength(1)
          expect(new URL(requests[0]).pathname).toBe("/api/fs/read/chart%2520%20one.PNG")
          expect(new URL(requests[0]).searchParams.get("location[directory]")).toBe("C:/tmp/")
          await root.getByRole("button", { name: "Append read", exact: true }).click()
          await expect(image).toHaveAttribute("src", url!)
          expect(requests).toHaveLength(1)
        }
        if (action === "click") await trigger.click()
        if (action !== "click") await trigger.press(action)
        await expect(trigger).toHaveAttribute("aria-expanded", "false")
        await expect(image).toHaveCount(0)
        expect(
          await page.evaluate(
            (url) =>
              fetch(url!).then(
                () => false,
                () => true,
              ),
            url,
          ),
        ).toBe(true)
      }
      await trigger.click()
      await expect(image).toHaveJSProperty("naturalWidth", 1)
      const url = await image.getAttribute("src")
      await root.getByRole("button", { name: "Unmount tools", exact: true }).click()
      await expect(image).toHaveCount(0)
      expect(
        await page.evaluate(
          (url) =>
            fetch(url!).then(
              () => false,
              () => true,
            ),
          url,
        ),
      ).toBe(true)
    },
  )
}

for (const width of [840, 390]) {
  for (const dir of ["ltr", "rtl"]) {
    story(`fits the server image inside the read row at ${width}px in ${dir}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.route("**/api/fs/read/**", (route) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="640"><rect width="1200" height="640" fill="green" /></svg>',
        }),
      )
      await page.evaluate(
        async ({ fixture, dir }) => {
          document.documentElement.dir = dir
          const { mountReadImage } = await import(fixture)
          mountReadImage({ path: "./images/chart.svg", grouped: true })
        },
        { fixture, dir },
      )
      const root = page.getByTestId("read-image-fixture")
      await root.getByRole("button", { name: "Read chart.svg", exact: true }).click()
      const image = root.getByRole("img", { name: "chart.svg", exact: true })
      await expect(image).toHaveJSProperty("naturalWidth", 1200)
      await expect(image).toHaveAttribute("src", /^data:image\/svg\+xml;/)
      expect(
        await image.evaluate((image) => {
          const bounds = image.getBoundingClientRect()
          const row = image.closest('[data-slot="context-tool-group-item"]')!.getBoundingClientRect()
          return bounds.width > 0 && bounds.left >= row.left && bounds.right <= row.right && bounds.bottom <= row.bottom
        }),
      ).toBe(true)
    })
  }
}

story("keeps an unavailable image read collapsible", async ({ page }) => {
  await page.route("**/api/fs/read/**", (route) => route.fulfill({ status: 404, body: "Not found" }))
  await page.evaluate(async (fixture) => {
    const { mountReadImage } = await import(fixture)
    mountReadImage({ path: "/tmp/missing.png", grouped: true })
  }, fixture)
  const root = page.getByTestId("read-image-fixture")
  const trigger = root.getByRole("button", { name: "Read missing.png", exact: true })
  const response = page.waitForResponse("**/api/fs/read/**")
  await trigger.click()
  expect((await response).status()).toBe(404)
  await expect(root.getByRole("img", { name: "missing.png", exact: true })).not.toHaveAttribute("src")
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
})
