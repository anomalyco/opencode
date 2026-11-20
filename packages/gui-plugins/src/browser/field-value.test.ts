import { expect, test } from "bun:test"
import type { Protocol } from "devtools-protocol"
import { readableField } from "./field-value"
import { accessibilitySnapshot } from "./snapshot"

const plain = { type: "text", autocomplete: "", labels: [], masked: false, maxLength: -1, toggles: [] }

const fields = [
  ["email address", "shown", { ...plain, type: "email" }, "Email", "ada@example.com"],
  ["max tokens", "shown", { ...plain, type: "number", labels: ["maxTokens"] }, "Max tokens", "4096"],
  ["username in a form whose Show password button is not its own", "shown", { ...plain, labels: ["username"] }, "Username", "ada"],
  ["API key", "hidden", plain, "API key", "sk-1"],
  ["API key by an acronym id", "hidden", { ...plain, labels: ["APIKey"] }, "", "sk-1"],
  ["private key", "hidden", plain, "Private key", "-----BEGIN"],
  ["access key named api_key", "hidden", { ...plain, labels: ["api_key"] }, "Access key", "AKIA1"],
  ["access token", "hidden", { ...plain, labels: ["accessToken"] }, "", "t1"],
  ["verification code", "hidden", plain, "Verification code", "123456"],
  ["security code", "hidden", plain, "Security code", "123"],
  ["recovery code", "hidden", plain, "Recovery code", "abcd-efgh"],
  ["backup code", "hidden", plain, "Backup code", "abcd-efgh"],
  ["2FA", "hidden", plain, "2FA", "123456"],
  ["TOTP", "hidden", { ...plain, labels: ["totp"] }, "", "123456"],
  ["MFA", "hidden", plain, "MFA code", "123456"],
  ["split one-time code, text box", "hidden", { ...plain, maxLength: 1 }, "Digit 1", "4"],
  ["split one-time code, tel box", "hidden", { ...plain, type: "tel", maxLength: 1 }, "", "4"],
  ["split one-time code, number box", "hidden", { ...plain, type: "number", maxLength: 1 }, "", "4"],
  ["revealed password beside Hide password", "hidden", { ...plain, labels: ["field_2"], toggles: ["Hide password"] }, "", "hunter2"],
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
