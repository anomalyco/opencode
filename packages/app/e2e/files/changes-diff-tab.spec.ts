import { waitSessionIdle, withSession } from "../actions"
import { test, expect } from "../fixtures"
import { createSdk } from "../utils"

const production = process.env.PLAYWRIGHT_PRODUCTION_LAYOUT === "1"

test.describe("changes diff tab", () => {
  test.skip(!production, "set PLAYWRIGHT_PRODUCTION_LAYOUT=1 to run production layout e2e")

  test("changes tree opens a diff tab", async ({ page, withProject }) => {
    test.setTimeout(180_000)

    const tag = `changes-diff-${Date.now()}`
    const file = `changes-diff-${tag}.txt`
    const patchText = ["*** Begin Patch", `*** Add File: ${file}`, `+line one ${tag}`, `+line two ${tag}`, "*** End Patch"].join(
      "\n",
    )

    await page.setViewportSize({ width: 1280, height: 900 })

    await withProject(async (project) => {
      const sdk = createSdk(project.directory)

      await withSession(sdk, `e2e changes diff tab ${tag}`, async (session) => {
        await sdk.session.promptAsync({
          sessionID: session.id,
          agent: "build",
          system: [
            "You are seeding deterministic e2e UI state.",
            "Your only valid response is one apply_patch tool call.",
            `Use this JSON input: ${JSON.stringify({ patchText })}`,
            "Do not call any other tools.",
            "Do not output plain text.",
          ].join("\n"),
          parts: [{ type: "text", text: "Apply the provided patch exactly once." }],
        })

        await waitSessionIdle(sdk, session.id, 120_000)

        await expect
          .poll(
            async () => {
              const diff = await sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
              return diff.length
            },
            { timeout: 60_000 },
          )
          .toBe(1)

        await project.gotoSession(session.id)

        const reviewTab = page.getByRole("tab", { name: /^review$/i })
        await expect(reviewTab).toHaveCount(0)

        const toggle = page.getByRole("button", { name: "Toggle file tree" })
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
        await expect(toggle).toHaveAttribute("aria-expanded", "true")

        const panel = page.locator("#file-tree-panel")
        const treeTabs = panel.locator('[data-component="tabs"][data-variant="pill"][data-scope="filetree"]')
        const changesTab = treeTabs.getByRole("tab", { name: /^changes$/i })
        await expect(changesTab).toBeVisible()
        await changesTab.click()
        await expect(changesTab).toHaveAttribute("aria-selected", "true")

        const tree = treeTabs.locator('[data-slot="tabs-content"]:not([hidden])')
        const fileBtn = tree.getByRole("button", { name: file, exact: true }).first()
        await expect(fileBtn).toBeVisible()
        await fileBtn.click()

        const tab = page.getByRole("tab", { name: file })
        await expect(tab).toBeVisible()
        await expect(tab).toHaveAttribute("aria-selected", "true")

        const diff = page.locator("#review-panel diffs-container").first()
        await expect(diff).toBeVisible()
        await expect
          .poll(async () => {
            const host = page.locator("#review-panel diffs-container").first()
            if (!(await host.count())) return false
            return host.evaluate((el) => {
              if (!(el instanceof HTMLElement)) return false
              const root = el.shadowRoot
              return (root?.textContent?.includes(`line one ${tag}`) && root?.textContent?.includes(`line two ${tag}`)) ?? false
            })
          })
          .toBe(true)
      })
    })
  })
})
