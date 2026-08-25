import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible, expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/ReviewLineCommentRegression"
const sessionID = "ses_review_line_comment_regression"
const title = "Review line comment regression"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.beforeEach(async ({ page }) => {
  await openReview(page)
})

test("opens the comment editor when code is clicked", async ({ page }) => {
  const review = page.locator('[data-component="session-review"]')
  const line = review.getByText("export const value = 'after'", { exact: true })
  await expectAppVisible(line)
  await line.click()

  await expect(review.getByRole("textbox")).toBeVisible()
  await expect(review.locator('[data-slot="line-comment-editor-label"]')).toHaveText("Commenting on line 2")
})

test("opens the comment editor when a line number is clicked", async ({ page }) => {
  const review = page.locator('[data-component="session-review"]')
  const lineNumber = review.locator('[data-column-number="1"]').last()
  await expectAppVisible(lineNumber)
  await lineNumber.click()

  await expect(review.getByRole("textbox")).toBeVisible()
  await expect(review.locator('[data-slot="line-comment-editor-label"]')).toHaveText("Commenting on line 1")
})

test("opens the comment editor for a line number range", async ({ page }) => {
  const review = page.locator('[data-component="session-review"]')
  const start = review.locator('[data-column-number="1"]').last()
  const end = review.locator('[data-column-number="3"]').last()
  await expectAppVisible(start)
  await expectAppVisible(end)

  await start.dragTo(end)

  await expect(review.getByRole("textbox")).toBeVisible()
  await expect(review.locator('[data-slot="line-comment-editor-label"]')).toHaveText("Commenting on lines 1-3")
})

test("shows a comment button when a diff line is hovered", async ({ page }) => {
  const review = page.locator('[data-component="session-review"]')
  const line = review.getByText("export const first = 1", { exact: true })
  await expectAppVisible(line)

  const comment = review.getByRole("button", { name: "Comment", exact: true, includeHidden: true })
  await expect(comment).toHaveCount(1)
  await line.dispatchEvent("pointermove", { pointerType: "mouse", bubbles: true, composed: true })
  await expect(comment).toBeVisible()
  await expect(comment).toHaveCSS("pointer-events", "auto")
  await comment.dispatchEvent("click")
  await expect(review.getByRole("textbox")).toBeVisible()
  await expect(review.locator('[data-slot="line-comment-editor-label"]')).toHaveText("Commenting on line 1")
})

test("stages a submitted line comment in the prompt context", async ({ page }) => {
  page.on("request", (request) => {
    expect.soft(request.method(), `unexpected ${request.method()} ${new URL(request.url()).pathname}`).toBe("GET")
  })

  const review = page.locator('[data-component="session-review"]')
  await review.getByText("export const value = 'after'", { exact: true }).click()
  const textbox = review.getByRole("textbox")
  await expect(textbox).toBeVisible()
  await expect(review.locator('[data-slot="line-comment-editor-label"]')).toHaveText("Commenting on line 2")
  await textbox.fill("Use the existing value instead")
  const submit = review.locator('[data-slot="line-comment-action"][data-variant="primary"]')
  await expect(submit).toBeEnabled()
  await submit.click()

  await expect(review.getByText("Use the existing value instead", { exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "Session" }).click()
  const context = page.getByText("Use the existing value instead", { exact: true }).last()
  await expect(context).toBeVisible()
  await expect(context.locator("..")).toContainText("review.ts:2")
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
          id: "msg_review_line_comment_regression",
          type: "user",
          time: { created: 1700000000000 },
          text: "Review this change.",
        },
      ],
    }),
  })

  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await expectSessionTitle(page, title)
  const changes = page.getByRole("tab", { name: "Changes" })
  const diffResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" && response.ok() && new URL(response.url()).pathname === "/api/vcs/diff",
  )
  await changes.click()
  expect((await (await diffResponse).json()).data).toHaveLength(1)
  await expect(page.getByRole("tab", { selected: true })).toHaveAccessibleName(/Files Changed/)

  const review = page.locator('[data-component="session-review"]')
  await expectAppVisible(review)
  const file = review.locator('[data-file="src/review.ts"]')
  await expectAppVisible(file)
  const trigger = file.getByRole("button", { expanded: false })
  await expect(trigger).toHaveCount(1)
  await trigger.click()
  await expect(file.getByRole("button", { expanded: true })).toBeVisible()
  await expect(file.getByText("export const value = 'after'", { exact: true })).toBeVisible()
}
