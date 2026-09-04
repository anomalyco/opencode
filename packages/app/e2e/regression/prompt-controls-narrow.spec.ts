import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

// Regression for #43295: on a narrow viewport the V2 composer's agent / model / variant controls used to run under
// the send button. The controls must stay inside the composer and clear of the button; long labels ellipsize.
const directory = "C:/OpenCode/PromptControlsNarrowRegression"
const projectID = "proj_prompt_controls_narrow_regression"
const sessionID = "ses_prompt_controls_narrow_regression"

test("keeps the V2 prompt controls clear of the send button on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "prompt-controls-narrow-regression",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "long-name-model": {
              id: "long-name-model",
              name: "A Deliberately Long Model Display Name For Narrow Layouts",
              limit: { context: 200_000 },
              variants: { high: {} },
            },
          },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "long-name-model" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "prompt-controls-narrow-regression",
        projectID,
        directory,
        title: "Prompt controls narrow regression",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
  })

  await page.goto(`/${base64Encode(directory)}/session/${sessionID}`)
  const composer = page.locator('[data-component="prompt-input-v2"]')
  await expectAppVisible(composer)

  const controls = composer.locator('[data-slot="prompt-controls"]')
  const submit = composer.locator('[data-action="prompt-submit"]')
  const model = composer.locator('[data-action="prompt-model"]')
  const variant = composer.getByRole("button", { name: "Choose model variant" })
  await expect(submit).toBeVisible()
  await expect(model).toBeVisible()
  await expect(variant).toBeVisible()

  const [controlsBox, submitBox, modelBox, variantBox] = await Promise.all([
    controls.boundingBox(),
    submit.boundingBox(),
    model.boundingBox(),
    variant.boundingBox(),
  ])
  expect(controlsBox).not.toBeNull()
  expect(submitBox).not.toBeNull()
  expect(modelBox).not.toBeNull()
  expect(variantBox).not.toBeNull()

  // the whole controls row ends where the send button starts, and nothing pokes past the viewport
  expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(submitBox!.x + 1)
  expect(variantBox!.x + variantBox!.width).toBeLessThanOrEqual(submitBox!.x + 1)
  expect(modelBox!.x + modelBox!.width).toBeLessThanOrEqual(submitBox!.x + 1)
  expect(submitBox!.x + submitBox!.width).toBeLessThanOrEqual(320)
})
