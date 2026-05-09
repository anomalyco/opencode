#!/usr/bin/env swift
// [fork-only] 生成 .dmg 安装窗口背景图(660x400 PNG)
// [feat: feishu-bridge-newuser-onboarding] 2026-05-10
//
// 用 CoreGraphics 画拖拽引导:
//   - 顶部:中文标题 "将 DeskFox 拖到 Applications 即可安装"
//   - 中部:从 (180, 170) 指向 (480, 170) 的箭头(对齐 Tauri 默认 dmg layout 中 .app 与 Applications 链接位置)
//   - 底部小字:Gatekeeper 提示
//
// 跑法:
//   swift packages/branding/scripts/generate-dmg-background.swift
// 输出:packages/branding/assets/dmg-background.png

import AppKit
import CoreGraphics
import Foundation

let width: CGFloat = 660
let height: CGFloat = 400

// 解析输出路径(脚本相对仓库根)
let scriptURL = URL(fileURLWithPath: CommandLine.arguments[0])
let repoRoot = scriptURL
    .deletingLastPathComponent()  // scripts/
    .deletingLastPathComponent()  // branding/
    .deletingLastPathComponent()  // packages/
    .deletingLastPathComponent()  // <repo root>
let outDir = repoRoot.appendingPathComponent("packages/branding/assets")
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let outURL = outDir.appendingPathComponent("dmg-background.png")

// CGContext bitmap
let colorSpace = CGColorSpaceCreateDeviceRGB()
guard
    let ctx = CGContext(
        data: nil,
        width: Int(width),
        height: Int(height),
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
else {
    print("Failed to create CGContext")
    exit(1)
}

// 切到 NSGraphicsContext 给文字渲染用
let nsCtx = NSGraphicsContext(cgContext: ctx, flipped: false)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = nsCtx

// 1. 背景:浅灰渐变(用 light system gray 配色)
ctx.setFillColor(CGColor(red: 0.96, green: 0.96, blue: 0.97, alpha: 1.0))
ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))

// 2. 顶部标题
let title = "将 DeskFox 拖到 Applications 即可安装"
let titleAttrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 18, weight: .medium),
    .foregroundColor: NSColor(red: 0.2, green: 0.2, blue: 0.25, alpha: 1.0),
]
let titleStr = NSAttributedString(string: title, attributes: titleAttrs)
let titleSize = titleStr.size()
titleStr.draw(at: NSPoint(x: (width - titleSize.width) / 2, y: height - 60))

// 3. 副标题(英文)
let subtitle = "Drag DeskFox into Applications to install"
let subtitleAttrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 12),
    .foregroundColor: NSColor(red: 0.45, green: 0.45, blue: 0.5, alpha: 1.0),
]
let subStr = NSAttributedString(string: subtitle, attributes: subtitleAttrs)
let subSize = subStr.size()
subStr.draw(at: NSPoint(x: (width - subSize.width) / 2, y: height - 88))

// 4. 中部箭头:从 (180, 170) 指向 (480, 170)— Tauri 默认 dmg layout
// Position 是 Tauri 配置坐标(原点左上),CoreGraphics 原点左下,翻 y
let appPos = CGPoint(x: 180, y: height - 170)
let appsPos = CGPoint(x: 480, y: height - 170)
let arrowStart = CGPoint(x: appPos.x + 70, y: appPos.y)  // 离 .app icon 右侧空 70px
let arrowEnd = CGPoint(x: appsPos.x - 70, y: appsPos.y)  // 离 Applications icon 左侧空 70px

ctx.setStrokeColor(CGColor(red: 0.55, green: 0.55, blue: 0.6, alpha: 1.0))
ctx.setFillColor(CGColor(red: 0.55, green: 0.55, blue: 0.6, alpha: 1.0))
ctx.setLineWidth(3)
ctx.setLineCap(.round)
ctx.move(to: arrowStart)
ctx.addLine(to: arrowEnd)
ctx.strokePath()

// 箭头头部(三角形)
let headSize: CGFloat = 14
ctx.move(to: arrowEnd)
ctx.addLine(to: CGPoint(x: arrowEnd.x - headSize, y: arrowEnd.y - headSize / 1.5))
ctx.addLine(to: CGPoint(x: arrowEnd.x - headSize, y: arrowEnd.y + headSize / 1.5))
ctx.closePath()
ctx.fillPath()

// 5. 底部 Gatekeeper 提示(浅色小字)
let footer = "首次打开如被拦截:右键 .app → 打开 → 仍要打开    First launch: right-click .app → Open → Open"
let footerAttrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 10),
    .foregroundColor: NSColor(red: 0.6, green: 0.6, blue: 0.65, alpha: 1.0),
]
let footerStr = NSAttributedString(string: footer, attributes: footerAttrs)
let footerSize = footerStr.size()
footerStr.draw(at: NSPoint(x: (width - footerSize.width) / 2, y: 24))

NSGraphicsContext.restoreGraphicsState()

// 输出 PNG
guard let cgImage = ctx.makeImage() else {
    print("Failed to make image")
    exit(1)
}
let bitmapRep = NSBitmapImageRep(cgImage: cgImage)
guard let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
    print("Failed to encode PNG")
    exit(1)
}
try pngData.write(to: outURL)
print("✓ wrote \(outURL.path) (\(pngData.count) bytes)")
