import { expect, test } from "bun:test"
import type { Protocol } from "devtools-protocol"
import { readableField } from "./field-value"
import { accessibilitySnapshot } from "./snapshot"

const plain = { type: "text", autocomplete: "", labels: [], masked: false }

const fields = [
  ["email address", "shown", { ...plain, type: "email" }, "Email", "ada@example.com"],
  ["search box", "shown", { ...plain, type: "search", labels: ["q", "Search pinned items"] }, "Search", "kittens"],
  ["rich text editor", "shown", { ...plain, type: "" }, "Message body", "Dear Ada"],
  ["empty field", "omitted", plain, "Notes", ""],
  ["empty password", "omitted", { ...plain, type: "password" }, "Password", ""],
  ["password", "hidden", { ...plain, type: "password" }, "Password", "hunter2"],
  ["revealed current password", "hidden", { ...plain, autocomplete: "current-password" }, "Show it", "hunter2"],
  ["revealed new password", "hidden", { ...plain, autocomplete: "section-a new-password" }, "Choose", "hunter2"],
  ["revealed password named by its id", "hidden", { ...plain, labels: ["userPassword"] }, "", "hunter2"],
  ["one-time code", "hidden", { ...plain, autocomplete: "one-time-code" }, "Code", "123456"],
  ["card number by autocomplete", "hidden", { ...plain, autocomplete: "billing cc-number" }, "Number", "4111111111111111"],
  ["card number by label", "hidden", plain, "Card number", "4111111111111111"],
  ["CVV placeholder", "hidden", { ...plain, labels: ["CVV"] }, "", "987"],
  ["PIN", "hidden", { ...plain, labels: ["pin_code"] }, "", "1234"],
  ["OTP name", "hidden", { ...plain, labels: ["otp"] }, "", "1234"],
  ["passcode", "hidden", plain, "Passcode", "1234"],
  ["API token", "hidden", { ...plain, labels: ["api_token"] }, "", "sk-1"],
  ["client secret", "hidden", plain, "Client secret", "abc"],
  ["SSN", "hidden", plain, "SSN", "123-45-6789"],
  ["masked text", "hidden", { ...plain, masked: true }, "Answer", "blue"],
  ["file input", "hidden", { ...plain, type: "file" }, "Upload", "C:\\fakepath\\a.txt"],
  ["field gone or unreadable", "hidden", undefined, "Name", "Ada"],
] as const

test.each(fields)("%s: value %s", async (_, expected, field, name, value) => {
  const textbox: Protocol.Accessibility.AXNode = {
    nodeId: "1",
    backendDOMNodeId: 1,
    ignored: false,
    role: { type: "role", value: "textbox" },
    name: { type: "string", value: name },
    value: { type: "string", value },
  }

  const readableValue = async (_: number, label: string) => !!field && readableField(field, label)
  const content = (await accessibilitySnapshot([textbox], { previous: new Map(), picked: new Map(), ref: () => "e1", readableValue })).content
  const printed = content.match(/ value=(.*)$/)?.[1]
  expect(printed === undefined ? "omitted" : printed === "<hidden>" ? "hidden" : printed === JSON.stringify(value) ? "shown" : printed).toBe(expected)
})
