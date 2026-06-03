// stop-gate.ts — stop Hook
// 模块级 gate 检查：prd/design → reviewDone，code → 测试通过，test → 覆盖率 ≥80%
// 多语言支持：Python(pytest) / Java(mvn/gradle+JaCoCo) / JS(jest/vitest) / Go / C#

import path from "path"
import { getState } from "../state.js"
import { UnifiedProgressManager } from "../progress/unified-progress-manager.js"
import type { PhaseId } from "../lingxi/config-loader.js"

// ── 覆盖率解析（多语言） ──────────────────────────────────────────────────────

/** 解析 pytest-cov 输出的覆盖率百分比 */
function parsePytestCoverage(output: string): number {
  const match = output.match(/TOTAL\s+\d+\s+\d+\s+(\d+)%/)
  if (match) return parseInt(match[1], 10)
  try {
    const data = JSON.parse(output)
    return Math.round(data.totals?.percent_covered ?? 0)
  } catch {
    return 0
  }
}

/** 解析 JaCoCo XML 报告的覆盖率百分比（instruction 维度） */
function parseJacocoCoverage(xmlContent: string): number {
  // <counter type="INSTRUCTION" missed="X" covered="Y"/>
  const match = xmlContent.match(/<counter type="INSTRUCTION"\s+missed="(\d+)"\s+covered="(\d+)"/)
  if (match) {
    const missed = parseInt(match[1], 10)
    const covered = parseInt(match[2], 10)
    const total = missed + covered
    return total > 0 ? Math.round((covered / total) * 100) : 0
  }
  return 0
}

/** 解析 Jest/Vitest coverage summary 的覆盖率百分比（lines 维度） */
function parseJestCoverage(output: string): number {
  // All files | XX | XX | XX | XX |
  const match = output.match(/All files\s*\|\s*([\d.]+)/)
  if (match) return Math.round(parseFloat(match[1]))
  // JSON 格式：{"total":{"lines":{"pct":XX}}}
  try {
    const data = JSON.parse(output)
    return Math.round(data.total?.lines?.pct ?? 0)
  } catch {
    return 0
  }
}

/** 解析 go test -cover 输出的覆盖率百分比 */
function parseGoCoverage(output: string): number {
  const match = output.match(/coverage:\s*([\d.]+)%/)
  if (match) return Math.round(parseFloat(match[1]))
  return 0
}

/** 解析 dotnet test coverage 的覆盖率百分比 */
function parseDotnetCoverage(output: string): number {
  // Line coverage: XX%
  const match = output.match(/Line coverage:\s*([\d.]+)%/i)
  if (match) return Math.round(parseFloat(match[1]))
  return 0
}

// ── 项目语言检测 ──────────────────────────────────────────────────────────────

type DetectedLang = "python" | "java-maven" | "java-gradle" | "js" | "go" | "csharp" | "unknown"

async function detectProjectLang(directory: string): Promise<DetectedLang> {
  const checks: Array<[string, DetectedLang]> = [
    ["pom.xml", "java-maven"],
    ["build.gradle", "java-gradle"],
    ["build.gradle.kts", "java-gradle"],
    ["package.json", "js"],
    ["go.mod", "go"],
    ["pyproject.toml", "python"],
    ["setup.py", "python"],
    ["requirements.txt", "python"],
  ]
  for (const [file, lang] of checks) {
    if (await Bun.file(path.join(directory, file)).exists()) return lang
  }
  // 检测 .csproj
  try {
    const glob = new Bun.Glob("**/*.csproj")
    for await (const _ of glob.scan({ cwd: directory })) {
      return "csharp"
    }
  } catch {}
  return "unknown"
}

// ── 多语言测试运行器 ──────────────────────────────────────────────────────────

async function runShellCmd(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited
    return { exitCode, stdout, stderr }
  } catch (err) {
    return { exitCode: 2, stdout: "", stderr: String(err) }
  }
}

/** 尝试 Maven Wrapper，回退到系统 mvn */
async function resolveMvnCmd(directory: string): Promise<string> {
  const wrapper = process.platform === "win32" ? "mvnw.cmd" : "./mvnw"
  const wrapperPath = path.join(directory, process.platform === "win32" ? "mvnw.cmd" : "mvnw")
  if (await Bun.file(wrapperPath).exists()) return wrapper
  return "mvn"
}

/** 尝试 Gradle Wrapper，回退到系统 gradle */
async function resolveGradleCmd(directory: string): Promise<string> {
  const wrapper = process.platform === "win32" ? "gradlew.bat" : "./gradlew"
  const wrapperPath = path.join(directory, process.platform === "win32" ? "gradlew.bat" : "gradlew")
  if (await Bun.file(wrapperPath).exists()) return wrapper
  return "gradle"
}

interface TestResult {
  exitCode: number
  stdout: string
  coverage: number  // 0-100，-1 表示未能获取
}

async function runTestsForLang(lang: DetectedLang, directory: string): Promise<TestResult> {
  switch (lang) {
    case "python": {
      const result = await runShellCmd("python", ["-m", "pytest", "--tb=short", "-q"], directory)
      return { exitCode: result.exitCode, stdout: result.stdout + result.stderr, coverage: -1 }
    }

    case "java-maven": {
      const mvn = await resolveMvnCmd(directory)
      // 预检：运行 mvn validate 确认 pom.xml 配置正确（JMockit argLine / JaCoCo 等）
      const validateResult = await runShellCmd(mvn, ["validate", "-q"], directory)
      if (validateResult.exitCode !== 0) {
        return {
          exitCode: validateResult.exitCode,
          stdout: `pom.xml 校验失败（mvn validate），请检查 pom.xml 配置：\n${validateResult.stdout + validateResult.stderr}`,
          coverage: -1,
        }
      }
      const result = await runShellCmd(mvn, ["test", "-q"], directory)
      return { exitCode: result.exitCode, stdout: result.stdout + result.stderr, coverage: -1 }
    }

    case "java-gradle": {
      const gradle = await resolveGradleCmd(directory)
      const result = await runShellCmd(gradle, ["test"], directory)
      return { exitCode: result.exitCode, stdout: result.stdout + result.stderr, coverage: -1 }
    }

    case "js": {
      // 优先 vitest，回退 jest
      let result = await runShellCmd("npx", ["vitest", "run", "--reporter=verbose"], directory)
      if (result.exitCode === 127 || result.stderr.includes("not found")) {
        result = await runShellCmd("npx", ["jest", "--passWithNoTests"], directory)
      }
      return { exitCode: result.exitCode, stdout: result.stdout + result.stderr, coverage: -1 }
    }

    case "go": {
      const result = await runShellCmd("go", ["test", "./..."], directory)
      return { exitCode: result.exitCode, stdout: result.stdout + result.stderr, coverage: -1 }
    }

    case "csharp": {
      const result = await runShellCmd("dotnet", ["test", "--no-build", "-q"], directory)
      return { exitCode: result.exitCode, stdout: result.stdout + result.stderr, coverage: -1 }
    }

    default: {
      const result = await runShellCmd("python", ["-m", "pytest", "--tb=short", "-q"], directory)
      return { exitCode: result.exitCode, stdout: result.stdout + result.stderr, coverage: -1 }
    }
  }
}

async function runCoverageForLang(lang: DetectedLang, directory: string): Promise<TestResult> {
  switch (lang) {
    case "python": {
      const result = await runShellCmd("python", ["-m", "pytest", "--cov", "--cov-report=term-missing", "-q"], directory)
      const output = result.stdout + result.stderr
      return {
        exitCode: result.exitCode,
        stdout: output,
        coverage: parsePytestCoverage(output),
      }
    }

    case "java-maven": {
      const mvn = await resolveMvnCmd(directory)
      // 先运行测试，再生成 JaCoCo 报告
      const testResult = await runShellCmd(mvn, ["test", "jacoco:report", "-q"], directory)
      if (testResult.exitCode !== 0) {
        return { exitCode: testResult.exitCode, stdout: testResult.stdout + testResult.stderr, coverage: 0 }
      }
      // 读取 JaCoCo XML 报告（多路径回退：target 默认路径 → 短路径）
      const jacocoPaths = [
        path.join(directory, "target", "jacoco-report", "jacoco.xml"),
        path.join(directory, "target", "site", "jacoco", "jacoco.xml"),
      ]
      // 短路径回退（中文路径兼容）：从 pom.xml 解析 JaCoCo destFile 配置
      try {
        const pomContent = await Bun.file(path.join(directory, "pom.xml")).text()
        const destFileMatch = pomContent.match(/<destFile>([^<]+)<\/destFile>/)
        if (destFileMatch) {
          // 用户在 pom.xml 中配置了 JaCoCo destFile（通常是短路径方案）
          const execPath = destFileMatch[1]
          if (await Bun.file(execPath).exists()) {
            const execDir = path.dirname(execPath)
            const artifactMatch = pomContent.match(/<artifactId>([^<]+)<\/artifactId>/)
            const reportDir = artifactMatch
              ? path.join(execDir, `${artifactMatch[1]}-report`)
              : path.join(execDir, "report")
            jacocoPaths.unshift(path.join(reportDir, "jacoco.xml"))
          }
        }
      } catch {}
      for (const jacocoXml of jacocoPaths) {
        try {
          const xmlContent = await Bun.file(jacocoXml).text()
          const coverage = parseJacocoCoverage(xmlContent)
          return { exitCode: 0, stdout: `JaCoCo coverage: ${coverage}%`, coverage }
        } catch { continue }
      }
      return { exitCode: 0, stdout: "JaCoCo XML 未找到，请确认 jacoco-maven-plugin 已配置且路径不含中文", coverage: 0 }
    }

    case "java-gradle": {
      const gradle = await resolveGradleCmd(directory)
      const testResult = await runShellCmd(gradle, ["test", "jacocoTestReport"], directory)
      if (testResult.exitCode !== 0) {
        return { exitCode: testResult.exitCode, stdout: testResult.stdout + testResult.stderr, coverage: 0 }
      }
      // 读取 JaCoCo XML 报告（Gradle 默认路径）
      const jacocoXml = path.join(directory, "build", "reports", "jacoco", "test", "jacocoTestReport.xml")
      try {
        const xmlContent = await Bun.file(jacocoXml).text()
        const coverage = parseJacocoCoverage(xmlContent)
        return { exitCode: 0, stdout: `JaCoCo coverage: ${coverage}%`, coverage }
      } catch {
        return { exitCode: 0, stdout: "JaCoCo XML 未找到，请确认 jacoco 插件已配置", coverage: 0 }
      }
    }

    case "js": {
      let result = await runShellCmd("npx", ["vitest", "run", "--coverage"], directory)
      if (result.exitCode === 127 || result.stderr.includes("not found")) {
        result = await runShellCmd("npx", ["jest", "--coverage", "--passWithNoTests"], directory)
      }
      const coverage = parseJestCoverage(result.stdout + result.stderr)
      return { exitCode: result.exitCode, stdout: result.stdout + result.stderr, coverage }
    }

    case "go": {
      const result = await runShellCmd("go", ["test", "-cover", "./..."], directory)
      const coverage = parseGoCoverage(result.stdout + result.stderr)
      return { exitCode: result.exitCode, stdout: result.stdout + result.stderr, coverage }
    }

    case "csharp": {
      const result = await runShellCmd(
        "dotnet",
        ["test", "--collect:XPlat Code Coverage", "-q"],
        directory,
      )
      const coverage = parseDotnetCoverage(result.stdout + result.stderr)
      return { exitCode: result.exitCode, stdout: result.stdout + result.stderr, coverage }
    }

    default: {
      const result = await runShellCmd("python", ["-m", "pytest", "--cov", "--cov-report=term-missing", "-q"], directory)
      const output = result.stdout + result.stderr
      return {
        exitCode: result.exitCode,
        stdout: output,
        coverage: parsePytestCoverage(output),
      }
    }
  }
}

// ── Gate Hook ─────────────────────────────────────────────────────────────────

export const stopGateHook = {
  stop: async (input: any) => {
    const sessionId: string = input.sessionID ?? input.session_id ?? ""
    const state = getState(sessionId)

    if (!state.currentModule) return  // 非模块化场景，直接放行

    const directory: string = input.directory ?? process.cwd()
    const lang = await detectProjectLang(directory)

    switch (state.currentModule) {
      case "prd":
      case "design": {
        // 文档模块：审查完成
        if (!state.stageProgress.reviewDone) {
          await input.client?.session?.promptAsync?.({
            path: { id: sessionId },
            body: {
              parts: [{
                type: "text",
                text: `文档尚未审查。请先执行审查流程（Step_4），确认文档完整性和合规性后再停止。`,
              }],
            },
          })
          return
        }
        break
      }

      case "code": {
        // 代码模块：测试写入 + 测试通过
        if (!state.stageProgress.testsWritten || !state.stageProgress.testsPassed) {
          await input.client?.session?.promptAsync?.({
            path: { id: sessionId },
            body: {
              parts: [{
                type: "text",
                text: `代码模块 gate 未满足：\n- testsWritten: ${state.stageProgress.testsWritten}\n- testsPassed: ${state.stageProgress.testsPassed}\n请确保测试用例已编写且全部通过。`,
              }],
            },
          })
          return
        }
        // 运行测试确认（多语言）
        const testResult = await runTestsForLang(lang, directory)
        if (testResult.exitCode !== 0) {
          await input.client?.session?.promptAsync?.({
            path: { id: sessionId },
            body: {
              parts: [{
                type: "text",
                text: `测试存在失败用例（${lang}），请修复后再停止：\n${testResult.stdout}`,
              }],
            },
          })
          return
        }
        break
      }

      case "test": {
        // 测试模块：覆盖率达标（80%）
        const covResult = await runCoverageForLang(lang, directory)
        if (covResult.coverage < 0) {
          // 覆盖率获取失败，降级为只检查测试通过
          if (covResult.exitCode !== 0) {
            await input.client?.session?.promptAsync?.({
              path: { id: sessionId },
              body: {
                parts: [{
                  type: "text",
                  text: `测试执行失败（${lang}），请修复后再停止：\n${covResult.stdout}`,
                }],
              },
            })
            return
          }
        } else if (covResult.coverage < 80) {
          await input.client?.session?.promptAsync?.({
            path: { id: sessionId },
            body: {
              parts: [{
                type: "text",
                text: `覆盖率 ${covResult.coverage}% 未达 80% 阈值（${lang}），请补充测试用例后再停止。\n${covResult.stdout}`,
              }],
            },
          })
          return
        }
        break
      }
    }

    // Gate 通过，更新 .harness/progress.json（lingxi 模式由 LingxiProgressTracker 统一管理）
    if (state.currentModule && !state.isLingxiHarness) {
      const pm = new UnifiedProgressManager(directory)
      await pm.initFeature({
        id: "default",
        title: "当前功能",
        request: "default",
        requirementText: "当前功能",
        requirementSource: {
          type: "fallback",
          contentHash: "sha256:default",
        },
      }, sessionId).catch(() => {})
      if (isPhaseId(state.currentModule)) {
        await pm.updatePhase("default", state.currentModule, "completed").catch(() => {})
      }
    }
  },
}

function isPhaseId(value: string): value is PhaseId {
  return value === "prd" || value === "design" || value === "code" || value === "test"
}
