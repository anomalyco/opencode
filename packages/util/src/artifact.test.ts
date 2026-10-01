import { describe, expect, test } from "bun:test"
import { artifactKind } from "./artifact.js"

describe("artifactKind", () => {
  test.each([
    ["shot.PNG", "image"],
    ["logo.svg", "svg"],
    ["song.mp3", "audio"],
    ["demo.mp4", "video"],
    ["clip.webm", "video"],
    ["paper.pdf", "pdf"],
    ["out/index.html", "html"],
    ["README.md", "markdown"],
    ["flow.mmd", "mermaid"],
    ["data.csv", "table"],
    ["data.tsv", "table"],
    ["Inter.woff2", "font"],
    ["src/app.ts", "text"],
    ["Makefile", "text"],
    [".env", "text"],
    ["archive.tar.gz", "text"],
  ] as const)("classifies %s as %s", (path, kind) => {
    expect(artifactKind(path)).toBe(kind)
  })
})
