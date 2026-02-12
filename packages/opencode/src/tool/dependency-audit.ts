import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import DESCRIPTION from "./dependency-audit.txt"
import path from "path"
import { Log } from "../util/log"
import * as fs from "fs"

const log = Log.create({ service: "dependency-audit" })

interface DependencyFinding {
  package: string
  version: string
  severity: "critical" | "high" | "medium" | "low"
  title: string
  cve?: string
  fixedVersion?: string
  isDirect: boolean
  ecosystem: string
  description: string
  url?: string
}

interface PackageManifest {
  type: string
  file: string
  dependencies: Map<string, string>
  devDependencies: Map<string, string>
}

async function detectManifests(directory: string): Promise<PackageManifest[]> {
  const manifests: PackageManifest[] = []

  // Check for package.json (npm/yarn/pnpm/bun)
  const packageJsonPath = path.join(directory, "package.json")
  if (fs.existsSync(packageJsonPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
      const deps = new Map<string, string>()
      const devDeps = new Map<string, string>()
      for (const [name, version] of Object.entries(content.dependencies || {})) {
        deps.set(name, String(version))
      }
      for (const [name, version] of Object.entries(content.devDependencies || {})) {
        devDeps.set(name, String(version))
      }
      manifests.push({
        type: "npm",
        file: "package.json",
        dependencies: deps,
        devDependencies: devDeps,
      })
    } catch {
      // ignore parse errors
    }
  }

  // Check for requirements.txt (pip)
  const requirementsPath = path.join(directory, "requirements.txt")
  if (fs.existsSync(requirementsPath)) {
    try {
      const content = fs.readFileSync(requirementsPath, "utf8")
      const deps = new Map<string, string>()
      for (const line of content.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*(?:[=<>!~]+\s*(.+))?/)
        if (match) {
          deps.set(match[1], match[2] || "*")
        }
      }
      manifests.push({
        type: "pip",
        file: "requirements.txt",
        dependencies: deps,
        devDependencies: new Map(),
      })
    } catch {
      // ignore
    }
  }

  // Check for pyproject.toml (poetry/pip)
  const pyprojectPath = path.join(directory, "pyproject.toml")
  if (fs.existsSync(pyprojectPath)) {
    manifests.push({
      type: "pip",
      file: "pyproject.toml",
      dependencies: new Map(),
      devDependencies: new Map(),
    })
  }

  // Check for go.mod
  const goModPath = path.join(directory, "go.mod")
  if (fs.existsSync(goModPath)) {
    try {
      const content = fs.readFileSync(goModPath, "utf8")
      const deps = new Map<string, string>()
      const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/)
      if (requireBlock) {
        for (const line of requireBlock[1].split("\n")) {
          const match = line.trim().match(/^(\S+)\s+(\S+)/)
          if (match) {
            deps.set(match[1], match[2])
          }
        }
      }
      manifests.push({
        type: "go",
        file: "go.mod",
        dependencies: deps,
        devDependencies: new Map(),
      })
    } catch {
      // ignore
    }
  }

  // Check for Cargo.toml (Rust)
  const cargoPath = path.join(directory, "Cargo.toml")
  if (fs.existsSync(cargoPath)) {
    manifests.push({
      type: "cargo",
      file: "Cargo.toml",
      dependencies: new Map(),
      devDependencies: new Map(),
    })
  }

  // Check for Gemfile (Ruby)
  const gemfilePath = path.join(directory, "Gemfile")
  if (fs.existsSync(gemfilePath)) {
    manifests.push({
      type: "bundler",
      file: "Gemfile",
      dependencies: new Map(),
      devDependencies: new Map(),
    })
  }

  // Check for composer.json (PHP)
  const composerPath = path.join(directory, "composer.json")
  if (fs.existsSync(composerPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(composerPath, "utf8"))
      const deps = new Map<string, string>()
      for (const [name, version] of Object.entries(content.require || {})) {
        deps.set(name, String(version))
      }
      manifests.push({
        type: "composer",
        file: "composer.json",
        dependencies: deps,
        devDependencies: new Map(),
      })
    } catch {
      // ignore
    }
  }

  return manifests
}

async function runNativeAudit(directory: string, abort: AbortSignal): Promise<DependencyFinding[]> {
  const findings: DependencyFinding[] = []

  // Try npm audit
  const packageJsonPath = path.join(directory, "package.json")
  if (fs.existsSync(packageJsonPath)) {
    try {
      const proc = Bun.spawn(["npm", "audit", "--json", "--omit=dev"], {
        cwd: directory,
        stdout: "pipe",
        stderr: "pipe",
        signal: abort,
      })
      const output = await new Response(proc.stdout).text()
      await proc.exited

      if (output.trim()) {
        try {
          const audit = JSON.parse(output)
          if (audit.vulnerabilities) {
            for (const [pkgName, vuln] of Object.entries<any>(audit.vulnerabilities)) {
              findings.push({
                package: pkgName,
                version: vuln.range || "unknown",
                severity: vuln.severity || "medium",
                title: vuln.title || `Vulnerability in ${pkgName}`,
                cve: vuln.cve,
                fixedVersion: vuln.fixAvailable?.version,
                isDirect: vuln.isDirect ?? false,
                ecosystem: "npm",
                description: vuln.title || `Known vulnerability in ${pkgName}`,
                url: vuln.url,
              })
            }
          }
        } catch {
          // JSON parse failed, try parsing as text
        }
      }
    } catch {
      log.info("npm audit failed, continuing with other checks")
    }
  }

  // Try pip audit if available
  const requirementsPath = path.join(directory, "requirements.txt")
  if (fs.existsSync(requirementsPath)) {
    try {
      const proc = Bun.spawn(["pip-audit", "--format=json", "-r", "requirements.txt"], {
        cwd: directory,
        stdout: "pipe",
        stderr: "pipe",
        signal: abort,
      })
      const output = await new Response(proc.stdout).text()
      await proc.exited

      if (output.trim()) {
        try {
          const audit = JSON.parse(output)
          if (Array.isArray(audit)) {
            for (const vuln of audit) {
              findings.push({
                package: vuln.name,
                version: vuln.version,
                severity: "high",
                title: vuln.id || `Vulnerability in ${vuln.name}`,
                cve: vuln.id,
                fixedVersion: vuln.fix_versions?.[0],
                isDirect: true,
                ecosystem: "pip",
                description: vuln.description || `Known vulnerability in ${vuln.name}`,
              })
            }
          }
        } catch {
          // parse failed
        }
      }
    } catch {
      log.info("pip-audit not available")
    }
  }

  return findings
}

async function queryOSV(
  ecosystem: string,
  packageName: string,
  version: string,
  abort: AbortSignal,
): Promise<DependencyFinding[]> {
  const findings: DependencyFinding[] = []
  try {
    const response = await fetch("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version,
        package: { name: packageName, ecosystem },
      }),
      signal: abort,
    })

    if (response.ok) {
      const data = await response.json() as any
      if (data.vulns && Array.isArray(data.vulns)) {
        for (const vuln of data.vulns) {
          const cve = vuln.aliases?.find((a: string) => a.startsWith("CVE-"))
          const severity =
            vuln.database_specific?.severity?.toLowerCase() ||
            (vuln.severity?.[0]?.score >= 9.0
              ? "critical"
              : vuln.severity?.[0]?.score >= 7.0
                ? "high"
                : vuln.severity?.[0]?.score >= 4.0
                  ? "medium"
                  : "low")

          const fixedVersion = vuln.affected?.[0]?.ranges?.[0]?.events?.find((e: any) => e.fixed)?.fixed

          findings.push({
            package: packageName,
            version,
            severity: severity as any,
            title: vuln.summary || vuln.id,
            cve: cve || vuln.id,
            fixedVersion,
            isDirect: true,
            ecosystem,
            description: vuln.details?.substring(0, 300) || vuln.summary || "",
            url: `https://osv.dev/vulnerability/${vuln.id}`,
          })
        }
      }
    }
  } catch {
    // OSV query failed, continue
  }
  return findings
}

export const DependencyAuditTool = Tool.define("dependency_audit", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      target: z
        .string()
        .optional()
        .describe("Directory to audit. Defaults to project root."),
      ecosystem: z
        .enum(["all", "npm", "pip", "go", "cargo", "bundler", "composer"])
        .default("all")
        .describe("Package ecosystem to audit"),
      includeDevDeps: z
        .boolean()
        .default(false)
        .describe("Include development dependencies in the audit"),
      useOSV: z
        .boolean()
        .default(true)
        .describe("Query the OSV (Open Source Vulnerabilities) database for additional results"),
      severity: z
        .enum(["critical", "high", "medium", "low"])
        .optional()
        .describe("Minimum severity to report"),
    }),
    async execute(params, ctx) {
      const target = params.target
        ? path.isAbsolute(params.target)
          ? params.target
          : path.resolve(Instance.directory, params.target)
        : Instance.directory

      await ctx.ask({
        permission: "dependency_audit",
        patterns: [target],
        always: ["*"],
        metadata: { target, ecosystem: params.ecosystem },
      })

      log.info("starting dependency audit", { target, ecosystem: params.ecosystem })

      // Step 1: Detect package manifests
      const manifests = await detectManifests(target)

      // Filter by ecosystem if specified
      const filteredManifests =
        params.ecosystem === "all"
          ? manifests
          : manifests.filter((m) => m.type === params.ecosystem)

      // Step 2: Run native audit tools
      const nativeFindings = await runNativeAudit(target, ctx.abort)

      // Step 3: Query OSV for additional data
      const osvFindings: DependencyFinding[] = []
      if (params.useOSV) {
        for (const manifest of filteredManifests) {
          const deps = params.includeDevDeps
            ? new Map([...manifest.dependencies, ...manifest.devDependencies])
            : manifest.dependencies

          // Limit OSV queries to prevent timeout
          let queryCount = 0
          const MAX_OSV_QUERIES = 50

          const ecosystemMap: Record<string, string> = {
            npm: "npm",
            pip: "PyPI",
            go: "Go",
            cargo: "crates.io",
            bundler: "RubyGems",
            composer: "Packagist",
          }

          const osvEcosystem = ecosystemMap[manifest.type]
          if (osvEcosystem) {
            for (const [name, version] of deps) {
              if (queryCount >= MAX_OSV_QUERIES) break
              const cleanVersion = version.replace(/[\^~>=<]/g, "").trim()
              if (!cleanVersion || cleanVersion === "*") continue

              const results = await queryOSV(osvEcosystem, name, cleanVersion, ctx.abort)
              osvFindings.push(...results)
              queryCount++
            }
          }
        }
      }

      // Merge and deduplicate findings
      const allFindings = [...nativeFindings, ...osvFindings]
      const seen = new Set<string>()
      const findings = allFindings.filter((f) => {
        const key = `${f.package}:${f.cve || f.title}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      // Filter by severity
      const severityOrder = ["critical", "high", "medium", "low"]
      const minIdx = params.severity ? severityOrder.indexOf(params.severity) : severityOrder.length - 1
      const filteredFindings = findings.filter((f) => severityOrder.indexOf(f.severity) <= minIdx)

      // Sort by severity
      filteredFindings.sort((a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity))

      // Calculate stats
      const totalDeps = filteredManifests.reduce(
        (sum, m) => sum + m.dependencies.size + (params.includeDevDeps ? m.devDependencies.size : 0),
        0,
      )

      const bySeverity = {
        critical: filteredFindings.filter((f) => f.severity === "critical").length,
        high: filteredFindings.filter((f) => f.severity === "high").length,
        medium: filteredFindings.filter((f) => f.severity === "medium").length,
        low: filteredFindings.filter((f) => f.severity === "low").length,
      }

      // Build output
      const outputLines: string[] = []

      outputLines.push("=".repeat(80))
      outputLines.push("  OPENCODE DEPENDENCY AUDIT REPORT")
      outputLines.push("=".repeat(80))
      outputLines.push("")
      outputLines.push(`  Target:       ${target}`)
      outputLines.push(`  Date:         ${new Date().toISOString()}`)
      outputLines.push(`  Ecosystems:   ${filteredManifests.map((m) => m.type).join(", ") || "none detected"}`)
      outputLines.push(`  Manifests:    ${filteredManifests.map((m) => m.file).join(", ") || "none found"}`)
      outputLines.push(`  Dependencies: ${totalDeps} total analyzed`)
      outputLines.push(`  OSV Queries:  ${params.useOSV ? "enabled" : "disabled"}`)
      outputLines.push("")

      outputLines.push("-".repeat(80))
      outputLines.push("  VULNERABILITY SUMMARY")
      outputLines.push("-".repeat(80))
      outputLines.push(`  Total Vulnerabilities: ${filteredFindings.length}`)
      outputLines.push(`  Critical: ${bySeverity.critical}  |  High: ${bySeverity.high}  |  Medium: ${bySeverity.medium}  |  Low: ${bySeverity.low}`)
      outputLines.push("")

      if (filteredFindings.length === 0) {
        outputLines.push("  No known vulnerabilities found in dependencies.")
        outputLines.push("")
        outputLines.push("  RECOMMENDATION: Continue to regularly audit dependencies and keep")
        outputLines.push("  packages updated to their latest stable versions.")
      } else {
        // By ecosystem
        const byEcosystem = new Map<string, number>()
        for (const f of filteredFindings) {
          byEcosystem.set(f.ecosystem, (byEcosystem.get(f.ecosystem) || 0) + 1)
        }

        outputLines.push("-".repeat(80))
        outputLines.push("  BY ECOSYSTEM")
        outputLines.push("-".repeat(80))
        for (const [eco, count] of byEcosystem) {
          outputLines.push(`  ${eco}: ${count} vulnerability/ies`)
        }
        outputLines.push("")

        // Detailed findings
        outputLines.push("-".repeat(80))
        outputLines.push("  VULNERABLE DEPENDENCIES")
        outputLines.push("-".repeat(80))

        for (let i = 0; i < filteredFindings.length; i++) {
          const f = filteredFindings[i]
          outputLines.push("")
          outputLines.push(`  [${f.severity.toUpperCase()}] #${i + 1}: ${f.package}@${f.version}`)
          outputLines.push(`  ${"~".repeat(70)}`)
          outputLines.push(`  Title:        ${f.title}`)
          if (f.cve) outputLines.push(`  CVE:          ${f.cve}`)
          outputLines.push(`  Ecosystem:    ${f.ecosystem}`)
          outputLines.push(`  Direct Dep:   ${f.isDirect ? "Yes" : "No (transitive)"}`)
          if (f.fixedVersion) outputLines.push(`  Fixed in:     ${f.fixedVersion}`)
          if (f.url) outputLines.push(`  Advisory:     ${f.url}`)
          outputLines.push(`  Description:  ${f.description}`)
        }

        // Remediation plan
        outputLines.push("")
        outputLines.push("-".repeat(80))
        outputLines.push("  REMEDIATION PLAN")
        outputLines.push("-".repeat(80))
        outputLines.push("")

        const fixable = filteredFindings.filter((f) => f.fixedVersion)
        const unfixable = filteredFindings.filter((f) => !f.fixedVersion)

        if (fixable.length > 0) {
          outputLines.push("  Packages with available fixes:")
          for (const f of fixable) {
            outputLines.push(`    - ${f.package}: upgrade to ${f.fixedVersion}`)
          }
        }

        if (unfixable.length > 0) {
          outputLines.push("")
          outputLines.push("  Packages without available fixes:")
          for (const f of unfixable) {
            outputLines.push(`    - ${f.package}@${f.version}: No fix available - consider alternatives`)
          }
        }
      }

      outputLines.push("")
      outputLines.push("=".repeat(80))
      outputLines.push("  End of Dependency Audit Report")
      outputLines.push("=".repeat(80))

      return {
        title: `Dependency Audit: ${filteredFindings.length} vulnerabilities (${bySeverity.critical}C/${bySeverity.high}H/${bySeverity.medium}M)`,
        metadata: {
          total: filteredFindings.length,
          critical: bySeverity.critical,
          high: bySeverity.high,
          medium: bySeverity.medium,
          low: bySeverity.low,
          totalDeps,
          ecosystems: filteredManifests.map((m) => m.type),
        },
        output: outputLines.join("\n"),
      }
    },
  }
})
