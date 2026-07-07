import { expect, test } from "bun:test"
import { SessionTools } from "@/session/tools"

test("decodes textual MCP resource blobs into model-visible text", () => {
  const markdown = "# Example Implementation Plan\n\nShip the small fix first.\n"
  const result = SessionTools.formatMcpResourceContent("jira", "attachment:///EXAMPLE-123/plan.md", {
    contents: [
      {
        uri: "attachment:///EXAMPLE-123/plan.md",
        mimeType: "text/markdown",
        blob: Buffer.from(markdown, "utf8").toString("base64"),
      },
    ],
  })

  expect(result.attachments).toEqual([])
  expect(result.text).toContain("Resource: attachment:///EXAMPLE-123/plan.md")
  expect(result.text).toContain("MIME: text/markdown")
  expect(result.text).toContain(markdown)
  expect(result.text).not.toContain("Binary MCP resource omitted")
})

test("keeps supported binary MCP resource blobs as attachments", () => {
  const result = SessionTools.formatMcpResourceContent("docs", "file:///tmp/report.pdf", {
    contents: [
      {
        uri: "file:///tmp/report.pdf",
        mimeType: "application/pdf",
        blob: "JVBERg==",
      },
    ],
  })

  expect(result.text).toContain("[Binary MCP resource attached: file:///tmp/report.pdf (application/pdf)]")
  expect(result.attachments).toEqual([
    {
      type: "file",
      mime: "application/pdf",
      url: "data:application/pdf;base64,JVBERg==",
      filename: "file:///tmp/report.pdf",
    },
  ])
})
