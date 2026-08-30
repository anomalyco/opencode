import { expect, test } from "@playwright/test"
import { setupTimeline } from "../performance/timeline-stability/fixture"

for (const width of [1400, 390]) {
  for (const profile of [
    { locale: "en", direction: "ltr" },
    { locale: "en", direction: "rtl" },
    { locale: "ar", direction: "rtl" },
  ]) {
    test(`keeps notices on one line: ${profile.locale} ${profile.direction} ${width}`, async ({ page }, info) => {
      const command =
        "bun run inspect --target src/renderer/session-timeline.ts --output artifacts/inspection-report.json ".repeat(5)
      const descriptions = [
        `${command}--finished`,
        `Instructions changed\n${command}--updated`,
        `\u0645\u0631\u0627\u062c\u0639\u0629 ${command}--reviewed`,
      ]
      await setupTimeline(page, {
        locale: profile.locale,
        viewport: { width, height: 900 },
        sessionMessages: [
          {
            id: "msg_notice_user",
            type: "user",
            text: "Inspect the project and report completion.",
            time: { created: 1 },
          },
          {
            id: "msg_notice_shell",
            type: "synthetic",
            text: "Complete",
            description: descriptions[0],
            metadata: { source: "shell", state: "completed" },
            time: { created: 2 },
          },
          { id: "msg_notice_system", type: "system", text: descriptions[1], time: { created: 3 } },
          {
            id: "msg_notice_agent",
            type: "synthetic",
            text: "Complete",
            description: descriptions[2],
            metadata: { source: "subagent", state: "completed", agent: "general" },
            time: { created: 4 },
          },
        ],
      })
      await page
        .locator("html")
        .evaluate((element, direction) => element.setAttribute("dir", direction), profile.direction)
      const notices = page.locator('[data-slot="session-timeline-notice"]')
      await expect(notices).toHaveCount(3)
      await expect(notices).toContainText(descriptions)
      await page.locator("[data-timeline-virtual-content]").screenshot({ path: info.outputPath("notices.png") })
      await expect
        .poll(() =>
          notices.evaluateAll((nodes) =>
            nodes.map((node) => {
              const style = getComputedStyle(node)
              const element = node as HTMLElement
              return {
                direction: style.direction,
                whiteSpace: style.whiteSpace,
                textOverflow: style.textOverflow,
                overflow: style.overflowX,
                singleLine:
                  Math.abs(
                    element.clientHeight -
                      parseFloat(style.paddingTop) -
                      parseFloat(style.paddingBottom) -
                      parseFloat(style.lineHeight),
                  ) <= 1,
                clipped: element.scrollWidth > element.clientWidth,
              }
            }),
          ),
        )
        .toEqual(
          Array.from({ length: 3 }, () => ({
            direction: profile.direction,
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            overflow: "hidden",
            singleLine: true,
            clipped: true,
          })),
        )
    })
  }
}
