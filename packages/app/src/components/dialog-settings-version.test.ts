// FORK: dialog-settings 版本牌 helper 测试 — D1 SolidJS component test 路径
// 走 helper extract 模式(file-tree.test.ts / dialog-custom-provider.test.ts 同款)
// 不真 render 组件 — 把纯计算抽到 dialog-settings-version.ts 单独测,
// 100% 覆盖 helper,JSX 部分通过 e2e 间接覆盖。

import { describe, expect, test } from "bun:test"
import { getPlatformLabel, formatAppName, getInstallerVersion } from "./dialog-settings-version"
import installerVersions from "@opencode-ai/branding/installer-versions.json"

describe("getPlatformLabel(行业惯例大小写)", () => {
  test("macos → macOS(m 小写,OS 大写,Apple 风格指南)", () => {
    expect(getPlatformLabel("macos")).toBe("macOS")
  })

  test("windows → Windows(W 大写,Microsoft 注册商标)", () => {
    expect(getPlatformLabel("windows")).toBe("Windows")
  })

  test("linux → Linux(L 大写,Linus 命名习惯)", () => {
    expect(getPlatformLabel("linux")).toBe("Linux")
  })

  test("undefined → 空字符串(web 模式 / 未识别 OS)", () => {
    expect(getPlatformLabel(undefined)).toBe("")
  })
})

describe("formatAppName", () => {
  test("已知 OS → DeskFox for <Platform>", () => {
    expect(formatAppName("macos")).toBe("DeskFox for macOS")
    expect(formatAppName("windows")).toBe("DeskFox for Windows")
    expect(formatAppName("linux")).toBe("DeskFox for Linux")
  })

  test("undefined → DeskFox(不带 for,因为没平台名)", () => {
    expect(formatAppName(undefined)).toBe("DeskFox")
  })

  test("for 介词小写(行业产品名惯例:`Microsoft Edge for Windows` / `Adobe Acrobat for Mac`)", () => {
    const out = formatAppName("windows")
    expect(out).toContain(" for ") // 全小写 " for "
    expect(out).not.toContain(" For ")
  })
})

describe("getInstallerVersion", () => {
  test("macos → installerVersions.macos(对应 Mac installer 版本号)", () => {
    expect(getInstallerVersion("macos", "1.0.0")).toBe(installerVersions.macos)
  })

  test("windows → installerVersions.windows", () => {
    expect(getInstallerVersion("windows", "1.0.0")).toBe(installerVersions.windows)
  })

  test("linux → fallback 到 pkgVersion(暂无 Linux installer 版本)", () => {
    expect(getInstallerVersion("linux", "1.14.33")).toBe("1.14.33")
  })

  test("undefined → fallback 到 pkgVersion(web 模式)", () => {
    expect(getInstallerVersion(undefined, "1.14.33")).toBe("1.14.33")
  })

  test("pkgVersion undefined(极端 case)→ 返 'unknown'(防 UI 显示 vundefined)", () => {
    expect(getInstallerVersion(undefined, undefined)).toBe("unknown")
    expect(getInstallerVersion("linux", undefined)).toBe("unknown")
  })

  test("installer 版本号是 YYYY.M.D.N 格式(从 JSON 取的真实值)", () => {
    expect(getInstallerVersion("windows", "")).toMatch(/^\d{4}\.\d{1,2}\.\d{1,2}\.\d+$/)
    expect(getInstallerVersion("macos", "")).toMatch(/^\d{4}\.\d{1,2}\.\d{1,2}\.\d+$/)
  })
})

describe("integration — 三档 OS 完整渲染输出", () => {
  test("Win 用户看到的 — DeskFox for Windows / v<win 版本>", () => {
    const os = "windows" as const
    const pkgVersion = "1.14.33"
    expect(formatAppName(os)).toBe("DeskFox for Windows")
    expect(getInstallerVersion(os, pkgVersion)).toBe(installerVersions.windows)
  })

  test("Mac 用户看到的 — DeskFox for macOS / v<mac 版本>", () => {
    const os = "macos" as const
    const pkgVersion = "1.14.33"
    expect(formatAppName(os)).toBe("DeskFox for macOS")
    expect(getInstallerVersion(os, pkgVersion)).toBe(installerVersions.macos)
  })

  test("Web 模式(无 platform.os)— DeskFox / v1.14.33(上游 pkg version)", () => {
    const os = undefined
    const pkgVersion = "1.14.33"
    expect(formatAppName(os)).toBe("DeskFox")
    expect(getInstallerVersion(os, pkgVersion)).toBe("1.14.33")
  })
})
