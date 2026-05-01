---
feat-id: release-自动化
status: done
related: ./1-spec.md
---

# 改动日志:release-自动化

| 笔 | commit | 文件 | 行数 | 说明 |
|---|---|---|---|---|
| 1 | `10c98374a` | `.husky/pre-commit` | +2/-1 | 黑名单豁免加 `^\.github/workflows/.*-deskfox\.yml$` |
| 2 | `17b159f25` | `.github/workflows/release-deskfox.yml`(新)+ `packages/branding/scripts/pack-installer.ps1`(改)+ `docs/features/release-自动化/{1-spec,3-changelog}.md`(新) | 总 ~250 | 主体实现 |
| 3 | `49ba8005c` | `packages/branding/scripts/build-deskfox.ps1` | +3 | sidecar copy 前 `New-Item -Force` 兜底目标目录(CI runner 无 target/release/) |
| 4 | `b1092742a` | `packages/branding/installer/DeskFox.iss` | +5/-1 | `IconFile` 按 `AppEnv` 走分档 ico(prod/beta/dev),修 CI dev/beta build 找不到 prod 路径的问题 |
| 5 | `59afb8413` | `docs/installer-versions.md` + `packages/desktop/src-tauri/{Cargo.toml,tauri.conf.json}` + `packages/branding/installer/DeskFox.iss` | bump | 2026.5.1.2 — 首次走 GitHub Actions 全自动 release 触发 |

## 验证清单

- [x] push 主体到 origin/dev 后,GitHub Actions UI 看到 release-deskfox workflow
- [x] workflow_dispatch 手动触发 dev 模式,build 跑通
- [x] 本地 bump → commit → tag `ship-prod-2026.5.1.2` → push,自动出 draft Release
- [x] draft Release 内容正确(SHA256 对、文案对、附件能下载)
- [x] 首笔 GitHub Release 公开发布:[ship-prod-2026.5.1.2](https://github.com/yuesoue/opencode-for-office-deskfox/releases/tag/ship-prod-2026.5.1.2)(2026-05-01)

## 回退方法

```bash
# 撤回主体 commit
git revert <commit-hash-2>

# 也撤回 hook 改进
git revert <commit-hash-1>
```
hook 撤回后,后续 fork-only workflow 的 commit 又会被拦,需要 `--no-verify` 临时绕。
