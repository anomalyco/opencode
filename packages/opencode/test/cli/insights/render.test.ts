import { describe, expect, test } from "bun:test"
import { renderReport } from "@/insights/render"
import type { Aggregate, Sections } from "@/insights/schema"

const baseAggregate: Aggregate = {
  total_sessions: 2,
  sessions_with_facets: 1,
  date_range: { start_ms: 0, end_ms: 86_400_000 },
  total_user_messages: 5,
  total_assistant_messages: 6,
  total_duration_hours: 1,
  total_cost: 0.5,
  totals_tokens: { input: 1000, output: 200, reasoning: 0, cache_read: 0, cache_write: 0 },
  tool_counts: { bash: 3, edit: 2 },
  languages: { TypeScript: 2 },
  git_commits: 1,
  git_pushes: 0,
  projects: { p1: { id: "p1", path: "/tmp/p1", sessions: 2 } },
  goal_categories: {},
  outcomes: {},
  satisfaction: {},
  helpfulness: {},
  session_types: {},
  friction: {},
  success: {},
  total_interruptions: 0,
  total_tool_errors: 0,
  tool_error_categories: {},
  user_response_times_sec: [],
  median_response_time_sec: 0,
  avg_response_time_sec: 0,
  sessions_using_task_agent: 0,
  sessions_using_mcp: 0,
  sessions_using_web_search: 0,
  sessions_using_web_fetch: 0,
  total_lines_added: 5,
  total_lines_removed: 1,
  total_files_modified: 1,
  days_active: 1,
  messages_per_day: 5,
  message_hours: [9, 10, 14],
  multi_clauding: { overlap_events: 0, sessions_involved: 0, user_messages_during: 0 },
  models_used: { "anthropic/claude-opus-4-7": 6 },
  agents_used: { build: 6 },
  session_summaries: [{ id: "abc", started_iso: "1970-01-01", project_path: "/tmp/p1", summary: "hi" }],
}

describe("renderReport", () => {
  test("emits valid skeleton, escapes summary text", () => {
    const sections: Sections = { interaction_style: { narrative: "x", key_pattern: "you iterate quickly <fast>" } }
    const html = renderReport({ aggregate: baseAggregate, sections, generated_at_iso: "1970-01-01T00:00:00Z" })
    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html).toContain("<title>OpenCode — Usage")
    expect(html).toContain("<h1>Your Usage Report</h1>")
    expect(html).toMatch(/<meta name="viewport"[^>]*width=device-width/)
    expect(html).toContain("you iterate quickly &lt;fast&gt;")
    expect(html).not.toContain("<script")
  })

  test("omits sections that are absent", () => {
    const html = renderReport({ aggregate: baseAggregate, sections: {}, generated_at_iso: "x" })
    expect(html.toLowerCase().includes("memorable")).toBe(false)
  })

  test("inlines the IBM Plex Mono font and OpenCode logo", () => {
    const html = renderReport({ aggregate: baseAggregate, sections: {}, generated_at_iso: "x" })
    expect(html).toContain("IBM Plex Mono")
    expect(html).toContain('aria-label="opencode"')
  })

  test("converts inline **bold** markdown into <strong> in narrative fields", () => {
    const sections: Sections = {
      interaction_style: {
        narrative: "You are **highly methodical** and *iterative*.",
        key_pattern: "**Verification-driven** approach",
      },
      fun_ending: { headline: "**Fun headline**", detail: "Detail with `code` inside." },
    }
    const html = renderReport({ aggregate: baseAggregate, sections, generated_at_iso: "x" })
    expect(html).toContain("<strong>highly methodical</strong>")
    expect(html).toContain("<em>iterative</em>")
    expect(html).toContain("<strong>Verification-driven</strong>")
    expect(html).toContain("<strong>Fun headline</strong>")
    expect(html).toContain("<code>code</code>")
    expect(html).not.toContain("**highly methodical**")
    expect(html).not.toContain("**Verification-driven**")
  })

  test("logo header keeps the SVG from being squeezed (flex-shrink:0)", () => {
    const html = renderReport({ aggregate: baseAggregate, sections: {}, generated_at_iso: "x" })
    expect(html).toContain("flex: 0 0 auto")
    expect(html).toContain('class="head-body"')
  })

  test("escapes HTML inside markdown payload (no XSS)", () => {
    const sections: Sections = {
      interaction_style: { narrative: "**<script>alert(1)</script>**", key_pattern: "" },
    }
    const html = renderReport({ aggregate: baseAggregate, sections, generated_at_iso: "x" })
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>")
  })

  test("renders block markdown: headings, lists, paragraphs in agents_md_additions", () => {
    const sections: Sections = {
      suggestions: {
        agents_md_additions: [
          {
            addition: "## Frequently Given Instructions\n\n### Document Rewriting\n\nWhen you see X, follow:\n- Load skill\n- Extract content\n- Verify",
            why: "User asked 40+ times.",
            prompt_scaffold: "",
          },
        ],
        features_to_try: [],
        usage_patterns: [],
      },
    }
    const html = renderReport({ aggregate: baseAggregate, sections, generated_at_iso: "x" })
    // headings preserved (## → h4 since # → h3)
    expect(html).toMatch(/<h4>Frequently Given Instructions<\/h4>/)
    expect(html).toMatch(/<h5>Document Rewriting<\/h5>/)
    // bullet list
    expect(html).toContain("<ul><li>Load skill</li><li>Extract content</li><li>Verify</li></ul>")
    // paragraph between headings and list
    expect(html).toContain("<p>When you see X, follow:</p>")
    // raw markdown markers no longer present
    expect(html).not.toMatch(/^##\s/m)
    expect(html).not.toMatch(/^- /m)
  })

  test("renders fenced code blocks with HTML-escaped contents", () => {
    const sections: Sections = {
      suggestions: {
        agents_md_additions: [
          { addition: "Here is config:\n\n```json\n{\"foo\": \"<bar>\"}\n```", why: "", prompt_scaffold: "" },
        ],
        features_to_try: [],
        usage_patterns: [],
      },
    }
    const html = renderReport({ aggregate: baseAggregate, sections, generated_at_iso: "x" })
    expect(html).toContain("<pre>")
    expect(html).toContain("&lt;bar&gt;")
    expect(html).not.toContain("<bar>")
    expect(html).not.toContain("```")
  })

  test("renders multi-paragraph narrative with blank-line separation", () => {
    const sections: Sections = {
      interaction_style: {
        narrative: "First paragraph here.\n\nSecond paragraph **bold** word.",
        key_pattern: "",
      },
    }
    const html = renderReport({ aggregate: baseAggregate, sections, generated_at_iso: "x" })
    expect(html).toContain("<p>First paragraph here.</p>")
    expect(html).toContain("<p>Second paragraph <strong>bold</strong> word.</p>")
  })

  test("ordered lists become <ol>", () => {
    const sections: Sections = {
      suggestions: {
        agents_md_additions: [
          { addition: "Steps:\n\n1. Do A\n2. Do B\n3. Do C", why: "", prompt_scaffold: "" },
        ],
        features_to_try: [],
        usage_patterns: [],
      },
    }
    const html = renderReport({ aggregate: baseAggregate, sections, generated_at_iso: "x" })
    expect(html).toContain("<ol><li>Do A</li><li>Do B</li><li>Do C</li></ol>")
  })

  test("normalizes \\r\\n line endings before parsing markdown", () => {
    const sections: Sections = {
      interaction_style: { narrative: "## Title\r\n\r\nFirst paragraph.\r\n\r\n- one\r\n- two", key_pattern: "" },
    }
    const html = renderReport({ aggregate: baseAggregate, sections, generated_at_iso: "x" })
    expect(html).toContain("<h4>Title</h4>")
    expect(html).toContain("<p>First paragraph.</p>")
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>")
  })

  test("joins indented continuation lines into the previous list item", () => {
    const sections: Sections = {
      suggestions: {
        agents_md_additions: [
          {
            addition: "- first item that\n  continues on next line\n- second item",
            why: "",
            prompt_scaffold: "",
          },
        ],
        features_to_try: [],
        usage_patterns: [],
      },
    }
    const html = renderReport({ aggregate: baseAggregate, sections, generated_at_iso: "x" })
    expect(html).toContain("<li>first item that continues on next line</li>")
    expect(html).toContain("<li>second item</li>")
  })

  test("heading immediately followed by list (no blank line)", () => {
    const sections: Sections = {
      suggestions: {
        agents_md_additions: [
          {
            addition: "## Title\n- one\n- two",
            why: "",
            prompt_scaffold: "",
          },
        ],
        features_to_try: [],
        usage_patterns: [],
      },
    }
    const html = renderReport({ aggregate: baseAggregate, sections, generated_at_iso: "x" })
    expect(html).toContain("<h4>Title</h4>")
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>")
  })

  test("# heading renders as h3 (h1/h2 reserved for shell + sections)", () => {
    const sections: Sections = {
      interaction_style: { narrative: "# Solo hash heading", key_pattern: "" },
    }
    const html = renderReport({ aggregate: baseAggregate, sections, generated_at_iso: "x" })
    expect(html).toContain("<h3>Solo hash heading</h3>")
  })
})
