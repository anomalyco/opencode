import { expect, type Page } from "@playwright/test"

export function trackPageErrors(page: Page) {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
  return errors
}

export function expectNoSmokeErrors(consoleErrors: string[], toastErrors: string[], forbiddenText: string[]) {
  expect({ consoleErrors, toastErrors, forbiddenText }).toEqual({
    consoleErrors: [],
    toastErrors: [],
    forbiddenText: [],
  })
}
