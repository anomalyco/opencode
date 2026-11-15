import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, expect, test } from "bun:test"
import { fragmentTarget, headingSlug } from "./markdown-fragment-links"

beforeAll(() => GlobalRegistrator.register())

afterAll(() => GlobalRegistrator.unregister())

test("slugs headings the way GitHub anchors them", () => {
  expect(headingSlug("Host services")).toBe("host-services")
  expect(headingSlug("What's `node:*`?")).toBe("whats-node")
  expect(headingSlug("API & SDK: v2.0")).toBe("api--sdk-v20")
  expect(headingSlug("snake_case and-hyphens")).toBe("snake_case-and-hyphens")
  expect(headingSlug("Überblick 概要")).toBe("überblick-概要")
})

test("finds headings by slug, numbering repeats, then raw HTML ids and names", () => {
  const root = document.createElement("div")
  root.innerHTML = [
    "<h2>Host services</h2>",
    "<h3>Usage</h3>",
    "<h3>Usage</h3>",
    '<p id="user-content-custom">custom</p>',
    '<a name="user-content-legacy"></a>',
  ].join("")
  const headings = root.querySelectorAll("h3")

  expect(fragmentTarget(root, "host-services")?.textContent).toBe("Host services")
  expect(fragmentTarget(root, "Host-Services")?.textContent).toBe("Host services")
  expect(fragmentTarget(root, "usage")).toBe(headings[0])
  expect(fragmentTarget(root, "usage-1")).toBe(headings[1])
  expect(fragmentTarget(root, "custom")?.textContent).toBe("custom")
  expect(fragmentTarget(root, "legacy")?.getAttribute("name")).toBe("user-content-legacy")
  expect(fragmentTarget(root, "missing")).toBeUndefined()
})
