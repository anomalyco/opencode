import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { describe, expect, test } from "vitest"
import { useFullAppStack } from "../../support/use-full-app-stack"

import { By } from "selenium-webdriver"
import { waitSessionIdle, withSession } from "../../../../e2e/actions"
import { createSdk, serverUrl } from "../../../../e2e/utils"
import { wdToggleReviewPanel } from "../../support/wd-actions"
import { waitVisible } from "../../support/wd-wait"
import { openProjectSession, useAppWebDriver } from "../../support/use-app-webdriver"

const count = 14

function body(mark: string) {
  return [
    `title ${mark}`,
    `mark ${mark}`,
    ...Array.from({ length: 32 }, (_, i) => `line ${String(i + 1).padStart(2, "0")} ${mark}`),
  ]
}

function files(tag: string) {
  return Array.from({ length: count }, (_, i) => {
    const id = String(i).padStart(2, "0")
    return {
      file: `review-scroll-${id}.txt`,
      mark: `${tag}-${id}`,
    }
  })
}

function seed(list: ReturnType<typeof files>) {
  const out = ["*** Begin Patch"]

  for (const item of list) {
    out.push(`*** Add File: ${item.file}`)
    for (const line of body(item.mark)) out.push(`+${line}`)
  }

  out.push("*** End Patch")
  return out.join("\n")
}

function edit(file: string, prev: string, next: string) {
  return ["*** Begin Patch", `*** Update File: ${file}`, "@@", `-mark ${prev}`, `+mark ${next}`, "*** End Patch"].join("\n")
}

async function patch(sdk: ReturnType<typeof createSdk>, sessionID: string, patchText: string) {
  await sdk.session.promptAsync({
    sessionID,
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

  await waitSessionIdle(sdk, sessionID, 120_000)
}

describe("session review scroll (webdriver)", () => {
  useFullAppStack()
  const app = useAppWebDriver()

  test.skipIf(Boolean(process.env.CI))(
    "review keeps scroll position after a live diff update",
    async () => {
      await app.driver.manage().window().setRect({ width: 1600, height: 1000, x: 0, y: 0 })

      const tag = `review-${Date.now()}`
      const list = files(tag)
      const hit = list[list.length - 4]!
      const nextMark = `${tag}-live`

      const listSdk = createOpencodeClient({ baseUrl: serverUrl(), throwOnError: true })
      const created = await listSdk.project.create({ name: `e2e review ${tag}` })
      if (!created.data?.project?.id) throw new Error("project create failed")
      const pid = created.data.project.id
      const sdk = createSdk({ id: pid })

      await withSession(sdk, `e2e review ${tag}`, async (session) => {
        await patch(sdk, session.id, seed(list))

        await app.driver.wait(
          async () => {
            const info = await sdk.session.get({ sessionID: session.id }).then((res) => res.data)
            const n = info?.summary?.files
            return n === list.length
          },
          60_000,
        )

        await app.driver.wait(
          async () => {
            const diff = await sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
            return diff.length === list.length
          },
          60_000,
        )

        await openProjectSession(app.driver, app.origin, pid, session.id)

        await wdToggleReviewPanel(app.driver)

        const tab = await waitVisible(app.driver, By.xpath(`//button[@role="tab" and contains(., "Review")]`))
        await tab.click()

        await waitVisible(app.driver, By.css('[data-slot="session-review-scroll"] .scroll-view__viewport'))

        await app.driver.wait(
          async () => (await app.driver.findElements(By.css('[data-slot="session-review-scroll"] .scroll-view__viewport h3'))).length === list.length,
          60_000,
        )

        const expandAll = await waitVisible(app.driver, By.xpath(`//button[contains(., "Expand all")]`))
        await expandAll.click()
        await waitVisible(app.driver, By.xpath(`//button[contains(., "Collapse all")]`))

        await app.driver.wait(
          async () =>
            (await app.driver.executeScript(
              `
            const file = arguments[0];
            const mark = arguments[1];
            const view = document.querySelector('[data-slot="session-review-scroll"] .scroll-view__viewport');
            if (!(view instanceof HTMLElement)) return false;
            const head = Array.from(view.querySelectorAll("h3")).find(
              (node) => node instanceof HTMLElement && node.textContent && node.textContent.includes(file),
            );
            if (!(head instanceof HTMLElement)) return false;
            const hosts = Array.from(head.parentElement?.querySelectorAll("diffs-container") ?? []);
            return hosts.some(function (host) {
              if (!(host instanceof HTMLElement)) return false;
              const root = host.shadowRoot;
              return root && root.textContent && root.textContent.includes("mark " + mark);
            });
          `,
              hit.file,
              hit.mark,
            )) === true,
          60_000,
        )

        const esc = hit.file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const row = await waitVisible(app.driver, By.xpath(`//*[contains(@class,"scroll-view__viewport")]//h3[contains(., "${esc}")]`))
        await app.driver.executeScript(`arguments[0].scrollIntoView({ block: "center" })`, row)

        const prev = (await app.driver.executeScript(
          `
          const file = arguments[0];
          const view = document.querySelector('[data-slot="session-review-scroll"] .scroll-view__viewport');
          if (!(view instanceof HTMLElement)) return null;
          const row = Array.from(view.querySelectorAll("h3")).find(
            (node) => node instanceof HTMLElement && node.textContent && node.textContent.includes(file),
          );
          if (!(row instanceof HTMLElement)) return null;
          const a = row.getBoundingClientRect();
          const b = view.getBoundingClientRect();
          return { top: a.top - b.top, y: view.scrollTop };
        `,
          hit.file,
        )) as { top: number; y: number }

        expect(prev.y).toBeGreaterThan(200)

        await patch(sdk, session.id, edit(hit.file, hit.mark, nextMark))

        await app.driver.wait(
          async () => {
            const diff = await sdk.session.diff({ sessionID: session.id }).then((res) => res.data ?? [])
            const item = diff.find((d) => d.file === hit.file)
            const after = typeof item?.after === "string" ? item.after : ""
            return after.includes(`mark ${nextMark}`)
          },
          60_000,
        )

        await app.driver.wait(
          async () =>
            (await app.driver.executeScript(
              `
            const file = arguments[0];
            const mark = arguments[1];
            const view = document.querySelector('[data-slot="session-review-scroll"] .scroll-view__viewport');
            if (!(view instanceof HTMLElement)) return false;
            const head = Array.from(view.querySelectorAll("h3")).find(
              (node) => node instanceof HTMLElement && node.textContent && node.textContent.includes(file),
            );
            if (!(head instanceof HTMLElement)) return false;
            const hosts = Array.from(head.parentElement?.querySelectorAll("diffs-container") ?? []);
            return hosts.some(function (host) {
              if (!(host instanceof HTMLElement)) return false;
              const root = host.shadowRoot;
              return root && root.textContent && root.textContent.includes("mark " + mark);
            });
          `,
              hit.file,
              nextMark,
            )) === true,
          60_000,
        )

        await app.driver.wait(
          async () => {
            const spot = (await app.driver.executeScript(
              `
              const file = arguments[0];
              const view = document.querySelector('[data-slot="session-review-scroll"] .scroll-view__viewport');
              if (!(view instanceof HTMLElement)) return null;
              const row = Array.from(view.querySelectorAll("h3")).find(
                (node) => node instanceof HTMLElement && node.textContent && node.textContent.includes(file),
              );
              if (!(row instanceof HTMLElement)) return null;
              const a = row.getBoundingClientRect();
              const b = view.getBoundingClientRect();
              return { top: a.top - b.top, y: view.scrollTop };
            `,
              hit.file,
            )) as { top: number; y: number } | null
            if (!spot) return false
            const d = Math.max(Math.abs(spot.top - prev.top), Math.abs(spot.y - prev.y))
            return d <= 32
          },
          60_000,
        )
      })
    },
    180_000,
  )
})
