import { describe, expect, mock, test } from "bun:test"

mock.module("electron-log/main.js", () => ({
  default: {
    transports: {
      console: { level: "info", writeFn() {} },
      file: { maxSize: 0, getFile: () => ({ path: "test.log" }) },
    },
  },
}))

const { sanitizeBrowserAnnotationData, sanitizeBrowserSnapshot } = await import("./annotation")

describe("browser annotation sanitization", () => {
  test("keeps benign visible text with session/auth words visible", () => {
    expect(
      sanitizeBrowserSnapshot({
        url: "https://example.com/settings",
        title: "Settings",
        elements: [
          {
            selector: "section.settings",
            tagName: "section",
            role: "region",
            accessibleName: "Session settings",
            visibleText: "Auth providers",
            attributes: {
              class: "settings",
            },
            boundingBox: { x: 1, y: 2, width: 3, height: 4 },
          },
        ],
      }).elements[0],
    ).toMatchObject({
      accessibleName: "Session settings",
      visibleText: "Auth providers",
    })
  })

  test("redacts locator literals that contain token-like secrets", () => {
    expect(
      sanitizeBrowserAnnotationData({
        tagName: "div",
        role: "generic",
        accessibleName: "Continue",
        visibleText: "Continue",
        attributes: {
          class: "cta",
        },
        selector: "div[data-id='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature']",
        xpath: "//*[@data-id='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature']",
        boundingBox: { x: 1, y: 2, width: 3, height: 4 },
        nearbyDomSanitized: "Continue",
      }),
    ).toMatchObject({
      selector: "[REDACTED]",
      xpath: "[REDACTED]",
    })
  })

  test("preserves session settings aria-label locator", () => {
    expect(
      sanitizeBrowserAnnotationData({
        tagName: "button",
        role: "button",
        accessibleName: "Session settings",
        visibleText: "Session settings",
        attributes: {
          class: "settings",
          "aria-label": "Session settings",
        },
        selector: 'button[aria-label="Session settings"]',
        xpath: '//*[@aria-label="Session settings"]',
        boundingBox: { x: 1, y: 2, width: 3, height: 4 },
        nearbyDomSanitized: "Session settings",
      }),
    ).toMatchObject({
      selector: 'button[aria-label="Session settings"]',
      xpath: '//*[@aria-label="Session settings"]',
    })
  })

  test("preserves auth providers locator literals", () => {
    expect(
      sanitizeBrowserAnnotationData({
        tagName: "button",
        role: "button",
        accessibleName: "Auth providers",
        visibleText: "Auth providers",
        attributes: {
          class: "providers",
          "aria-label": "Auth providers",
        },
        selector: 'button[aria-label="Auth providers"]',
        xpath: '//*[@aria-label="Auth providers"]',
        boundingBox: { x: 1, y: 2, width: 3, height: 4 },
        nearbyDomSanitized: "Auth providers",
      }),
    ).toMatchObject({
      selector: 'button[aria-label="Auth providers"]',
      xpath: '//*[@aria-label="Auth providers"]',
    })
  })

  test("keeps password selector and xpath redaction", () => {
    expect(
      sanitizeBrowserAnnotationData({
        tagName: "input",
        role: "textbox",
        accessibleName: "Password",
        visibleText: "hunter2",
        attributes: {
          name: "password",
          placeholder: "Password",
          type: "password",
          value: "hunter2",
        },
        selector: "input[name='password']",
        xpath: "//*[@id='password']",
        boundingBox: { x: 1, y: 2, width: 3, height: 4 },
        nearbyDomSanitized: "Password: hunter2",
      }),
    ).toMatchObject({
      accessibleName: "[REDACTED]",
      visibleText: "[REDACTED]",
      selector: "[REDACTED]",
      xpath: "[REDACTED]",
    })
  })

  test("keeps safe locators useful", () => {
    expect(
      sanitizeBrowserAnnotationData({
        tagName: "button",
        role: "button",
        accessibleName: "Continue",
        visibleText: "Continue",
        attributes: {
          class: "primary",
        },
        selector: "button.primary",
        xpath: "/html/body/main/button[1]",
        boundingBox: { x: 1, y: 2, width: 3, height: 4 },
        nearbyDomSanitized: "Continue",
      }),
    ).toMatchObject({
      selector: "button.primary",
      xpath: "/html/body/main/button[1]",
    })
  })
})
