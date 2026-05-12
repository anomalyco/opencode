---
name: release
description: Publish packages to npm, AUR, Homebrew, Chocolatey, Docker, VS Code Marketplace, Zed
---

# Release

## 发布入口
```bash
script/release [major|minor|patch]  # default: patch
```

## publish.yml 阶段
1. `script/version.ts` — 版本号 + Tag
2. `script/build.ts` — 跨平台构建(Linux/macOS/Windows)
3. Azure Trusted Signing — Windows .exe
4. `script/publish.ts` — npm + AUR + Homebrew + Chocolatey + Docker + GitHub Release

## 7 条发布路径
| 平台 | 工具 |
|------|------|
| npm | `npm publish` (scope: `@octopus-ai/*`) |
| AUR | Arch Linux PKGBUILD |
| Homebrew | formula |
| Chocolatey | Windows 包 |
| Docker | GHCR push |
| VS Code | `publish-vscode.yml` |
| Zed | `sync-zed-extension.yml` |

## 回滚 SOP
触发: 错误率>基线×2 / P0 安全漏洞 / 核心功能断言失败
1. `git bisect` 定位
2. `git revert <commit>` 或 `git reset --hard <last-good-tag>`
3. Hotfix 发布
4. 验证正常 + RCA 报告
