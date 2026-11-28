import { describe, expect, test } from "bun:test"
import { parseToastLink, toastXml } from "./toast"

const token = "0b6c3f9e-8a3e-4d43-9a3f-5c1e2b7d9f10"

describe("windows toast", () => {
  test("opens a toast link from its body and from each button, with the text escaped", () => {
    const xml = toastXml(token, {
      title: `Permission <required> & "now"`,
      body: "Fix login\nbash: echo 'a' > b\nthird line",
      actions: [
        { id: "once", label: "Allow once" },
        { id: "reject", label: "Deny & stop" },
      ],
    })

    expect(xml).toBe(
      [
        `<toast activationType="protocol" launch="opencode://toast/${token}">`,
        `<visual><binding template="ToastGeneric">`,
        `<text>Permission &lt;required&gt; &amp; &quot;now&quot;</text>`,
        `<text>Fix login</text><text>bash: echo &apos;a&apos; &gt; b</text>`,
        `</binding></visual><actions>`,
        `<action content="Allow once" activationType="protocol" arguments="opencode://toast/${token}?action=once"/>`,
        `<action content="Deny &amp; stop" activationType="protocol" arguments="opencode://toast/${token}?action=reject"/>`,
        `</actions><audio silent="true"/></toast>`,
      ].join(""),
    )
  })

  test.each([
    { url: `opencode://toast/${token}`, expected: { token, action: undefined } },
    { url: `opencode://toast/${token}?action=once`, expected: { token, action: "once" } },
    { url: `opencode://open-project?directory=/repo`, expected: undefined },
    { url: `opencode://toast/not-a-token?action=once`, expected: undefined },
    { url: `https://toast/${token}?action=once`, expected: undefined },
    { url: `opencode://toast/${token}/extra?action=once`, expected: undefined },
  ])("reads $url", ({ url, expected }) => {
    expect(parseToastLink(url)).toEqual(expected)
  })
})
