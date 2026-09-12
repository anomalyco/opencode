import { describe, expect, it } from "bun:test"
import { resolveTargetDiagram, buildInteractiveHtml } from "../../src/cli/cmd/visualize"

describe("visualize command", () => {
  it("resolves context target with System Context pipeline", () => {
    const res = resolveTargetDiagram("context", "")
    expect(res.key).toBe("context")
    expect(res.mermaid).toContain("flowchart TD")
    expect(res.mermaid).toContain("Context Sources")
    expect(res.mermaid).toContain("System Context Registry")
    expect(res.mermaid).toContain("Context Epoch")
    expect(res.ascii).toContain("CONTEXT SOURCES")
    expect(res.ascii).toContain("SYSTEM CONTEXT REGISTRY")
  })

  it("resolves architecture target with layers", () => {
    const res = resolveTargetDiagram("architecture", "")
    expect(res.key).toBe("architecture")
    expect(res.mermaid).toContain("ClientLayer")
    expect(res.mermaid).toContain("ServerLayer")
    expect(res.mermaid).toContain("CoreLayer")
    expect(res.ascii).toContain("PRESENTATION LAYER")
  })

  it("resolves schema target with entity relationship diagram", () => {
    const res = resolveTargetDiagram("schema", "")
    expect(res.key).toBe("schema")
    expect(res.mermaid).toContain("erDiagram")
    expect(res.mermaid).toContain("PROJECT")
    expect(res.mermaid).toContain("SESSION")
    expect(res.ascii).toContain("PROJECT")
    expect(res.ascii).toContain("SESSION")
  })

  it("resolves execution flow target with sequence diagram", () => {
    const res = resolveTargetDiagram("flow", "auth-pipeline")
    expect(res.key).toBe("flow")
    expect(res.title).toContain("auth-pipeline")
    expect(res.mermaid).toContain("sequenceDiagram")
    expect(res.ascii).toContain("Developer")
  })

  it("resolves dependency graph target", () => {
    const res = resolveTargetDiagram("deps", "")
    expect(res.key).toBe("deps")
    expect(res.mermaid).toContain("flowchart LR")
    expect(res.ascii).toContain("packages/core")
  })

  it("resolves state machine target", () => {
    const res = resolveTargetDiagram("state", "")
    expect(res.key).toBe("state")
    expect(res.mermaid).toContain("stateDiagram-v2")
    expect(res.ascii).toContain("Running Drain")
  })

  it("builds self-contained interactive HTML with Mermaid and pan-zoom controls", () => {
    const html = buildInteractiveHtml("Test Diagram", "flowchart TD\n  A --> B")
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain("mermaid.initialize")
    expect(html).toContain("Download SVG")
    expect(html).toContain("zoomIn()")
    expect(html).toContain("Test Diagram")
    expect(html).toContain("A --> B")
  })
})
