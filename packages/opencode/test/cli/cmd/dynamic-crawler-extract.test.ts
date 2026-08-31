import { describe, expect, it } from "bun:test"
import { extractContentFromHtml, validateMarkdownSize } from "../../../src/cli/cmd/dynamic-crawler"

describe("dynamic-crawler.extractContentFromHtml", () => {
  it("extracts title from HTML", () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Test Page Title</title></head>
      <body>
        <h1>Main Heading</h1>
        <p>This is a paragraph of content.</p>
      </body>
      </html>
    `
    const result = extractContentFromHtml(html)
    expect(result.title).toBe("Test Page Title")
  })

  it("extracts headings", () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Test</title></head>
      <body>
        <h1>First Heading</h1>
        <h2>Second Heading</h2>
        <h3>Third Heading</h3>
      </body>
      </html>
    `
    const result = extractContentFromHtml(html)
    expect(result.markdown).toContain("## First Heading")
    expect(result.markdown).toContain("## Second Heading")
    expect(result.markdown).toContain("## Third Heading")
  })

  it("extracts paragraphs", () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Test</title></head>
      <body>
        <p>This is a meaningful paragraph with enough content to be extracted.</p>
        <p>Another paragraph with sufficient content here.</p>
      </body>
      </html>
    `
    const result = extractContentFromHtml(html)
    expect(result.markdown).toContain("meaningful paragraph")
    expect(result.markdown).toContain("Another paragraph")
  })

  it("removes boilerplate elements", () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Test</title></head>
      <body>
        <nav>Navigation menu</nav>
        <footer>Footer content</footer>
        <main>
          <h1>Main Content</h1>
          <p>This is the main content that should be preserved.</p>
        </main>
      </body>
      </html>
    `
    const result = extractContentFromHtml(html)
    expect(result.markdown).toContain("Main Content")
    expect(result.markdown).toContain("main content that should be preserved")
    expect(result.markdown).not.toContain("Navigation menu")
    expect(result.markdown).not.toContain("Footer content")
  })

  it("removes duplicate content", () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Test</title></head>
      <body>
        <h1>Unique Heading</h1>
        <p>This is a unique paragraph with enough content.</p>
        <p>This is a unique paragraph with enough content.</p>
        <p>This is a different paragraph with more content here.</p>
      </body>
      </html>
    `
    const result = extractContentFromHtml(html)
    const matches = result.markdown.match(/unique paragraph with enough content/g)
    expect(matches?.length).toBe(1)
  })

  it("generates clean HTML", () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Test</title></head>
      <body>
        <script>alert('xss')</script>
        <style>.hidden { display: none; }</style>
        <nav>Navigation</nav>
        <main>
          <h1>Main Content</h1>
          <p>Content paragraph here.</p>
        </main>
      </body>
      </html>
    `
    const result = extractContentFromHtml(html)
    expect(result.cleanHtml).toContain("<h2>Main Content</h2>")
    expect(result.cleanHtml).not.toContain("<script>")
    expect(result.cleanHtml).not.toContain("<style>")
    expect(result.cleanHtml).not.toContain("Navigation")
  })

  it("handles malformed HTML gracefully", () => {
    const html = `
      <html>
      <head><title>Malformed</title>
      <body>
        <p>Content without closing tags
        <div>More content
      </body>
    `
    const result = extractContentFromHtml(html)
    expect(result.title).toBe("Malformed")
    expect(result.markdown.length).toBeGreaterThan(0)
  })

  it("preserves links", () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Test</title></head>
      <body>
        <main>
          <a href="https://example.com">Example Link</a>
          <a href="https://test.com">Test Link</a>
        </main>
      </body>
      </html>
    `
    const result = extractContentFromHtml(html)
    expect(result.markdown).toContain("[Example Link](https://example.com)")
    expect(result.markdown).toContain("[Test Link](https://test.com)")
  })

  it("extracts tables", () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Test</title></head>
      <body>
        <main>
          <table>
            <tr><th>Name</th><th>Value</th></tr>
            <tr><td>Item1</td><td>100</td></tr>
            <tr><td>Item2</td><td>200</td></tr>
          </table>
        </main>
      </body>
      </html>
    `
    const result = extractContentFromHtml(html)
    expect(result.markdown).toContain("| Name | Value |")
    expect(result.markdown).toContain("| Item1 | 100 |")
    expect(result.markdown).toContain("| Item2 | 200 |")
  })
})

describe("dynamic-crawler.extractContentFromHtml - LinkedIn profile", () => {
  it("extracts profile content and removes auth wall", () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Sign Up | LinkedIn</title></head>
      <body>
        <nav>Navigation menu</nav>
        <h1>Riya M</h1>
        <p>Sign in to view Riya's full profile</p>
        <p>Email or phone</p>
        <p>Password</p>
        <p>Tiruchengodu, Tamil Nadu, India</p>
        <p>MS Publications</p>
        <h2>About</h2>
        <p>I'm a results-driven professional with over 10 years of experience in publication. My expertise includes...</p>
        <h2>Experience & Education</h2>
        <p>MS Publications</p>
        <footer>Footer content</footer>
      </body>
      </html>
    `
    const result = extractContentFromHtml(html)
    
    // Should extract profile content
    expect(result.title).toBe("Sign Up | LinkedIn")
    expect(result.markdown).toContain("Riya M")
    expect(result.markdown).toContain("Tiruchengodu, Tamil Nadu, India")
    expect(result.markdown).toContain("MS Publications")
    expect(result.markdown).toContain("About")
    expect(result.markdown).toContain("results-driven professional")
    
    // Should remove auth wall content
    expect(result.markdown).not.toContain("Sign in to view")
    expect(result.markdown).not.toContain("Email or phone")
    expect(result.markdown).not.toContain("Password")
    
    // Should remove boilerplate
    expect(result.markdown).not.toContain("Navigation menu")
    expect(result.markdown).not.toContain("Footer content")
  })
})

describe("dynamic-crawler.validateMarkdownSize", () => {
  it("returns content as-is if under 5KB", () => {
    const content = "Hello World"
    const result = validateMarkdownSize(content)
    expect(result.truncated).toBe(false)
    expect(result.content).toBe(content)
  })

  it("truncates content over 5KB at paragraph boundary", () => {
    const content = "A".repeat(6000)
    const result = validateMarkdownSize(content)
    expect(result.truncated).toBe(true)
    expect(result.content.length).toBeLessThanOrEqual(5200)
    expect(result.content).toContain("[Content truncated at 5KB]")
  })
})
