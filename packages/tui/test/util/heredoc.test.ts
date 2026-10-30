import { describe, expect, test } from "bun:test"
import type { SimpleHighlight } from "@opentui/core"
import { heredocLanguage, heredocs, highlightHeredocs } from "../../src/util/heredoc"

function language(command: string) {
  return heredocs(command).map((heredoc) => heredoc.language)
}

describe("heredocs", () => {
  test("finds the body between the operator line and the closing line", () => {
    const command = "python3 - <<'EOF'\nprint(1)\nprint(2)\nEOF\necho done"
    const [heredoc] = heredocs(command)
    expect(command.slice(heredoc.start, heredoc.end)).toBe("print(1)\nprint(2)")
    expect(heredoc.language).toBe("python")
  })

  test("reads several heredocs, including two opened on one line", () => {
    const command = "cat <<A > a.json\n{}\nA\npaste <<B <<C\nb\nB\nc\nC\npsql <<SQL\nselect 1;\nSQL"
    const bodies = heredocs(command).map((heredoc) => command.slice(heredoc.start, heredoc.end))
    expect(bodies).toEqual(["{}", "b", "c", "select 1;"])
    expect(language(command)).toEqual(["json", undefined, undefined, "sql"])
  })

  test("accepts tab-indented closing lines for <<- and a closing paren after the delimiter", () => {
    expect(heredocs("if true; then\n\tbash <<-X\n\techo hi\n\tX\nfi").map((heredoc) => heredoc.language)).toEqual([
      "bash",
    ])
    const command = 'msg="$(cat <<EOF\nhello\nEOF)"\ngit commit -m "$msg"'
    expect(heredocs(command).map((heredoc) => command.slice(heredoc.start, heredoc.end))).toEqual(["hello"])
  })

  test("skips here-strings, shifts and unterminated operators", () => {
    expect(heredocs('grep x <<< "$v"\necho $((1 << 2))\necho "a <<b"\nls')).toEqual([])
  })

  test("colors each of two heredocs that write files in one command", () => {
    const command = [
      "mkdir -p tools && cat > tools/run.py <<'EOF'",
      "print('run')",
      "EOF",
      "cat > tools/config.json <<'EOF'",
      '{"run": true}',
      "EOF",
    ].join("\n")
    const found = heredocs(command)
    expect(found.map((heredoc) => heredoc.language)).toEqual(["python", "json"])
    expect(found.map((heredoc) => command.slice(heredoc.start, heredoc.end))).toEqual(["print('run')", '{"run": true}'])
  })

  test("leaves an empty body out", () => {
    expect(heredocs("cat <<EOF\nEOF\n")).toEqual([])
  })
})

describe("heredocLanguage", () => {
  const cases: [string, string, string | undefined][] = [
    ["python3 - <<'PY'", "", "python"],
    ["python3.12 <<PY", "", "python"],
    ["uv run --with httpx python - <<'PY'", "", "python"],
    ["node <<'JS'", "", "javascript"],
    ["bun - <<'TS'", "", "typescript"],
    ["deno run - <<'TS'", "", "typescript"],
    ["ruby <<'RB'", "", "ruby"],
    ["bundle exec rails runner - <<'RB'", "", "ruby"],
    ["perl <<'PL'", "", "perl"],
    ["php <<'PHP'", "", "php"],
    ["sqlite3 db.sqlite <<'SQL'", "", "sql"],
    ["sudo -u postgres psql <<'SQL'", "", "sql"],
    ["mysql -u root <<SQL", "", "sql"],
    ["duckdb <<SQL", "", "sql"],
    ["jq . <<'JSON'", "", "json"],
    ["curl -X POST --data @- https://x <<'JSON'", "", "json"],
    ["kubectl apply -f - <<'YAML'", "", "yaml"],
    ["kubectl exec -i db -- psql <<'SQL'", "", "sql"],
    ["yq . <<'YAML'", "", "yaml"],
    ["bash -s <<'SH'", "", "bash"],
    ["ssh host <<'SH'", "", "bash"],
    ["ssh host 'psql app' <<'SQL'", "", "sql"],
    ["docker exec -i db psql <<'SQL'", "", "sql"],
    ["cat > src/x.ts <<'EOF'", "", "typescript"],
    ["cat <<'EOF'", " > script.py", "python"],
    ["sudo tee /etc/app.json <<'EOF'", "", "json"],
    ["cat <<'EOF'", " | python3 -", "python"],
    ["cat <<'EOF'", " | kubectl apply -f -", "yaml"],
    ["cat <<'EOF'", " 2>/dev/null | psql", "sql"],
    ["git commit -F - <<'MSG'", "", "markdown"],
    ["git apply <<'PATCH'", "", "diff"],
    ["gh pr create --body-file - <<'MD'", "", "markdown"],
    ["FOO=1 timeout 30 python3 <<'PY'", "", "python"],
    ["echo start; ruby <<'RB'", "", "ruby"],
    ["cat <<'EOF'", "", undefined],
    ["cat > notes.txt <<'EOF'", "", undefined],
    ["while read line; do echo $line; done <<EOF", "", undefined],
    ["mystery-tool <<EOF", "", undefined],
  ]
  for (const [before, after, expected] of cases) {
    test(`${before}${after} -> ${expected}`, () => {
      expect(heredocLanguage(before, after, "plain body")).toBe(expected)
    })
  }

  test("falls back to the body's shebang", () => {
    expect(heredocLanguage("cat > run <<'EOF'", "", "#!/usr/bin/env python3\nprint(1)")).toBe("python")
    expect(heredocLanguage("mystery <<'EOF'", "", "#!/bin/bash\necho hi")).toBe("bash")
    expect(heredocLanguage("cat <<'EOF'", "", "#!/usr/bin/env -S node --no-warnings\n")).toBe("javascript")
    expect(heredocLanguage("mystery <<'EOF'", "", "#!/opt/weird\n")).toBeUndefined()
  })
})

describe("highlightHeredocs", () => {
  const command = "psql <<SQL\nselect 1;\nSQL\necho hi"
  const body = command.indexOf("select")
  const bashHighlights: SimpleHighlight[] = [
    [0, 4, "function"],
    [5, 10, "operator"],
    [body - 1, body + 10, "string"],
    [command.indexOf("echo"), command.indexOf("echo") + 4, "function"],
  ]

  test("replaces bash's string color on the body with the body language's highlights", async () => {
    const requests: string[] = []
    const result = await highlightHeredocs(bashHighlights, command, async (content, filetype) => {
      requests.push(`${filetype}:${content}`)
      return {
        highlights: [
          [0, 6, "keyword"],
          [7, 8, "number"],
        ],
      }
    })
    expect(requests).toEqual(["sql:select 1;"])
    expect(result).toEqual([
      [0, 4, "function"],
      [5, 10, "operator"],
      [body - 1, body, "string"],
      [body, body + 6, "keyword"],
      [body + 7, body + 8, "number"],
      [body + 9, body + 10, "string"],
      [command.indexOf("echo"), command.indexOf("echo") + 4, "function"],
    ])
  })

  test("keeps bash's highlights when the body language has none or the worker fails", async () => {
    expect(await highlightHeredocs(bashHighlights, command, async () => ({ highlights: [] }))).toBeUndefined()
    expect(
      await highlightHeredocs(bashHighlights, command, () => Promise.reject(new Error("no parser"))),
    ).toBeUndefined()
    expect(await highlightHeredocs(bashHighlights, "echo hi", async () => ({ highlights: [] }))).toBeUndefined()
  })
})
