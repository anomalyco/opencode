import { expect, test } from "bun:test"
import { enterpriseEmailContent } from "./enterprise"

const submission = {
  name: "Fake Visitor",
  role: "Engineering lead",
  company: "Example Test Company",
  email: "fake-visitor@example.test",
  message: "We need SSO for 200 developers.",
}

test("the sales inbox email escapes submitted HTML", () => {
  const content = enterpriseEmailContent({
    name: "<b>Name</b>",
    role: "Role",
    email: "fake-visitor@example.test",
    message: `<script>alert("x")</script> & <img src=x onerror=alert(1)>`,
    alias: "",
  })
  expect(content.html).not.toContain("<script>")
  expect(content.html).not.toContain("<img")
  expect(content.html).not.toContain("<b>")
  expect(content.html).toContain(
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;img src=x onerror=alert(1)&gt;",
  )
  expect(content.html).toContain("&lt;b&gt;Name&lt;/b&gt;<br>")
})

test("the sales inbox plain-text email is not HTML-escaped", () => {
  const content = enterpriseEmailContent(
    { ...submission, name: "Ada <CTO>", message: "Pricing & SSO?", phone: "+1 555 0100", alias: "" },
    "$10k+",
  )
  expect(content.text).not.toContain("<br>")
  expect(content.text).not.toContain("&lt;")
  expect(content.text).not.toContain("&amp;")
  expect(content.text).toBe(
    [
      "Pricing & SSO?",
      "",
      "Current monthly inference spend: $10k+",
      "",
      "--",
      "Ada <CTO>",
      submission.role,
      submission.company,
      submission.email,
      "+1 555 0100",
    ].join("\n"),
  )
})
