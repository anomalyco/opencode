---
feat-id: release-自动化
status: in-progress
related: ./1-spec.md
---

# 改动日志:release-自动化

| 笔 | commit | 文件 | 行数 | 说明 |
|---|---|---|---|---|
| 1 | (待填) | `.husky/pre-commit` | +2/-1 | 黑名单豁免加 `^\.github/workflows/.*-deskfox\.yml$` |
| 2 | (待填) | `.github/workflows/release-deskfox.yml`(新)+ `packages/branding/scripts/pack-installer.ps1`(改 +20/-3)+ `docs/features/release-自动化/{1-spec,3-changelog}.md`(新) | 总 ~250 | 主体实现 |

## 验证清单(commit 后跑通)

- [ ] push 主体到 origin/dev 后,GitHub Actions UI 能看到 release-deskfox workflow
- [ ] workflow_dispatch 手动触发 dev 模式,build 跑通(看 artifact tab 下载产物)
- [ ] 从 dispatch artifact 装一遍 DeskFox-Dev-*.exe 验证可启动
- [ ] 本地 bump → commit → tag `ship-prod-<version>` → push,自动出 draft Release
- [ ] draft Release 内容正确(SHA256 对、文案对、附件能下载)

## 回退方法

```bash
# 撤回主体 commit
git revert <commit-hash-2>

# 也撤回 hook 改进
git revert <commit-hash-1>
```
hook 撤回后,后续 fork-only workflow 的 commit 又会被拦,需要 `--no-verify` 临时绕。
