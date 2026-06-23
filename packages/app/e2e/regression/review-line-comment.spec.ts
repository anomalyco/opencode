import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/ReviewLineCommentRegression"
const sessionID = "ses_review_line_comment_regression"
const title = "Review line comment regression"

test.beforeEach(async ({ page }) => {
  await openReview(page)
})

test("opens the comment editor when code is clicked", async ({ page }) => {
  const review = page.locator('[data-component="session-review"]')
  const line = review.getByText("export const value = 'after'", { exact: true })
  await expectAppVisible(line)
  await line.click()

  await expect(review.getByRole("textbox")).toBeVisible()
})

test("opens the comment editor when a line number is clicked", async ({ page }) => {
  const review = page.locator('[data-component="session-review"]')
  const lineNumber = review.locator('[data-column-number="1"]').last()
  await expectAppVisible(lineNumber)
  await lineNumber.click()

  await expect(review.getByRole("textbox")).toBeVisible()
})

test("opens the comment editor for a line number range", async ({ page }) => {
  const review = page.locator('[data-component="session-review"]')
  const start = review.locator('[data-column-number="1"]').last()
  const end = review.locator('[data-column-number="3"]').last()
  await expectAppVisible(start)
  await expectAppVisible(end)

  const from = await start.boundingBox()
  const to = await end.boundingBox()
  if (!from || !to) throw new Error("Missing line number bounds")
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2)
  await page.mouse.up()

  await expect(review.getByRole("textbox")).toBeVisible()
})

test("shows a comment button when a line number is hovered", async ({ page }) => {
  const review = page.locator('[data-component="session-review"]')
  const lineNumber = review.locator('[data-column-number="1"]').last()
  await expectAppVisible(lineNumber)

  const comment = review.getByRole("button", { name: "Comment", exact: true })
  await expect(async () => {
    await page.mouse.move(0, 0)
    await lineNumber.hover()
    await expect(comment).toBeVisible({ timeout: 500 })
  }).toPass()
  await comment.click()
  await expect(review.getByRole("textbox")).toBeVisible()
})

test("stages a submitted line comment in the prompt context", async ({ page }) => {
  const requests: string[] = []
  page.on("request", (request) => {
    if (request.method() !== "GET") requests.push(`${request.method()} ${new URL(request.url()).pathname}`)
  })

  const review = page.locator('[data-component="session-review"]')
  await review.getByText("export const value = 'after'", { exact: true }).click()
  await review.getByRole("textbox").fill("Use the existing value instead")
  await review.locator('[data-slot="line-comment-action"][data-variant="primary"]').click()

  await expect(review.getByText("Use the existing value instead", { exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "Session" }).click()
  const context = page.getByText("Use the existing value instead", { exact: true }).last()
  await expect(context).toBeVisible()
  await expect(context.locator("..")).toContainText("review.ts:2")
  expect(requests).toEqual([])
})

async function openReview(page: Page) {
  await page.setViewportSize({ width: 700, height: 900 })
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_review_line_comment_regression",
      worktree: directory,
      vcs: "git",
      name: "review-line-comment-regression",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: {} },
    sessions: [
      {
        id: sessionID,
        slug: "review-line-comment-regression",
        projectID: "proj_review_line_comment_regression",
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    vcsDiff: [
      {
        file: "src/review.ts",
        additions: 1,
        deletions: 1,
        status: "modified",
        patch:
          "diff --git a/src/review.ts b/src/review.ts\n--- a/src/review.ts\n+++ b/src/review.ts\n@@ -1,3 +1,3 @@\n export const first = 1\n-export const value = 'before'\n+export const value = 'after'\n export const last = 3\n",
      },
    ],
    pageMessages: () => ({
      items: [
        {
          info: {
            id: "msg_review_line_comment_regression",
            sessionID,
            role: "user",
            time: { created: 1700000000000 },
            summary: { diffs: [] },
            agent: "build",
            model: { providerID: "opencode", modelID: "test" },
          },
          parts: [
            {
              id: "prt_review_line_comment_regression",
              sessionID,
              messageID: "msg_review_line_comment_regression",
              type: "text",
              text: "Review this change.",
            },
          ],
        },
      ],
    }),
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  const diffResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/vcs/diff")
  await page.getByRole("tab", { name: "Changes" }).click()
  expect(await (await diffResponse).json()).toHaveLength(1)

  const review = page.locator('[data-component="session-review"]')
  await expectAppVisible(review)
  await review
    .getByRole("heading", { name: /review\.ts/ })
    .getByRole("button")
    .first()
    .click()
}
