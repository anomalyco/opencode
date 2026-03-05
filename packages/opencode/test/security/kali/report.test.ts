// packages/opencode/test/security/kali/report.test.ts
import { describe, test, expect } from "bun:test"
import { ReportGenerator } from "@/security/kali/report"

describe("ReportGenerator", () => {
  test("genera markdown básico", () => {
    const report = ReportGenerator.generate({
      target: "192.168.1.1",
      duration: 300000,
      tools: ["nmap", "nuclei"],
      findings: {
        critical: 1,
        high: 2,
        medium: 5,
        low: 3,
      },
    })

    expect(report).toContain("# Auditoría de Seguridad")
    expect(report).toContain("192.168.1.1")
    expect(report).toContain("Críticas: 1")
  })

  test("incluye recomendaciones", () => {
    const report = ReportGenerator.generate({
      target: "example.com",
      duration: 60000,
      tools: ["nuclei"],
      findings: { critical: 0, high: 1, medium: 0, low: 0 },
      recommendations: ["Actualizar servidor nginx a versión más reciente"],
    })

    expect(report).toContain("## Recomendaciones")
    expect(report).toContain("Actualizar servidor nginx")
  })

  test("genera ruta de reporte correctamente", () => {
    const path = ReportGenerator.getReportPath("example.com")
    expect(path).toContain("/tmp/opensacia-reports/")
    expect(path).toContain("example.com")
  })
})
