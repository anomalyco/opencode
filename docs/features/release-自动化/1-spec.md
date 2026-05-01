---
feat-id: release-自动化
status: in-progress
related: ./3-changelog.md
---

# DeskFox release 自动化(GitHub Actions)

> 状态:**实现中**(2026-05-01),首次跑通后改 status: done。
> 用途:把"本地 build + ISCC + 上传 GitHub Release"这条手动链路改成"push tag → 自动出 release",降低分发摩擦。

## 一、为什么做(触发原因)

2026-05-01 user 想把 prod installer 挂到 GitHub Releases 给他人下载。手动流程的痛点:
- 每次 build 在 user 本地机器,陌生人无法验证"代码 + binary 对应"
- 没有可复现 build,信任成本高
- 手工 ship 节奏快(7 天 6 次)易疲劳

CI build 的好处:
- binary ↔ commit hash 强绑定(任何人都能从 tag 看到对应 commit)
- 自动 SHA256 + Release notes
- user 本地不用每次都跑 30 分钟 build

## 二、设计决策

### 决策 1:tag 触发 vs PR 触发

**选 tag 触发**(`ship-prod-*` / `ship-beta-*`)。理由:
- ship 是 user 主动决策(不是每个 PR 都要 ship)
- 跟 v2 spec 既有 ship tag 命名规范天然对齐(`ship-<env>-<版本>`)
- PR 触发 + 自动发 release 太激进

### 决策 2:bump 在哪跑(本地 vs CI)

**选本地 bump**。CI 不跑 `bump-installer-version.ps1`。理由:
- bump 改 `.iss` 和 `docs/installer-versions.md`,这俩要进 commit
- CI 跑 bump 后 commit + push 容易陷入循环 / 污染 git history
- bump 后 user 还要手填 placeholder("ship 后回填本条"),CI 替不了

CI 跑 `pack-installer.ps1 -SkipBump`,version 从 tag 名解析(也跟 .iss 里 AppVersion 对账,避免 user 忘 bump)。

### 决策 3:Release 自动 publish vs draft

**选 draft**。CI 创建 draft Release,user 在 GitHub UI 审查 + 手动 publish。理由:
- 给 user 一道审查关(产物大小 / SHA256 / Release notes 文案)
- 万一 build 有诡异问题,draft 能回滚

### 决策 4:支不支持 dispatch 手动触发

**支持**(`workflow_dispatch`)。理由:
- 第一次配 workflow 必须能空跑测试(不打 tag、不发 release,只验证 build 流水线)
- dispatch 模式只 archive 产物,不发 Release,无副作用

## 三、最终流程(user 视角)

### 发布一笔 prod installer

```powershell
# 1. 本地 bump
.\packages\branding\scripts\bump-installer-version.ps1 -Platform Windows
# 假设 bump 出 2026.5.1.2

# 2. commit bump
git add packages/branding/installer/DeskFox.iss docs/installer-versions.md
git commit -m "chore(release): bump 2026.5.1.2 [feat: release-自动化]"

# 3. 打 tag + push
git tag ship-prod-2026.5.1.2
git push origin dev --tags
```

push 后 GitHub Actions 自动:
1. checkout `ship-prod-2026.5.1.2` tag
2. 装 Bun / Rust / Inno Setup
3. `build-deskfox.ps1 -Env prod -NoBundle`
4. `pack-installer.ps1 -Env prod -SkipBump -Version 2026.5.1.2`
5. 创建 **draft** Release,挂 `DeskFox-2026.5.1.2-setup.exe` + SHA256

user 后续:
- 在 GitHub UI 审 draft → publish
- 在 `docs/installer-versions.md` 把 placeholder 填完整(此条 commit 列表 / 知名 issue / etc.)

### 第一次跑通(只测 workflow,不发布)

GitHub Actions UI → release-deskfox → "Run workflow" → 选 dev / 跑 → 看 artifact tab 下载产物验证。

## 四、文件清单

| 文件 | 性质 |
|---|---|
| `.github/workflows/release-deskfox.yml` | 新增,fork-only(`-deskfox.yml` 后缀强制,跟上游 0 重名) |
| `packages/branding/scripts/pack-installer.ps1` | 改,加 `-SkipBump` + `-Version` 参数,本地行为不变 |
| `.husky/pre-commit` | 改,黑名单豁免加 `^\.github/workflows/.*-deskfox\.yml$` 规则 |
| `docs/features/release-自动化/{1-spec,3-changelog}.md` | 文档 |

## 五、风险与回退

| 风险 | 缓解 |
|---|---|
| CI 上 bun-windows-x64-baseline 下载失败(本地撞过) | 不致命,主 sidecar build 还是会成,只 baseline 副产物失败,跟本地行为一致 |
| Rust cold build 30+ 分钟 | 缓存 cargo registry + target,后续 build 缩到 10-15 分钟 |
| ISCC 路径 hardcoded `C:\ProgramData\chocolatey\bin\ISCC.exe` | chocolatey 默认装这,CI 上 `choco install innosetup` 装到这,正好兼容 |
| `.iss` AppVersion 跟 tag version 不一致(user 忘 bump) | workflow 启动时对账,不一致直接 fail with 清晰 error |
| GitHub Action permissions 不足 | workflow 显式声明 `permissions: contents: write` |

回退:删 `.github/workflows/release-deskfox.yml` 文件 + revert `pack-installer.ps1` + revert hook,本地手动 ship 流程恢复(本来也一直能用)。

## 六、修订记录

| 版本 | 日期 | 修订内容 |
|---|---|---|
| v0.1 | 2026-05-01 | 初版,首次实现待 push 后跑通 |
