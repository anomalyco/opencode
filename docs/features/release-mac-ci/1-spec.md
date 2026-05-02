---
feat-id: release-mac-ci
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# release-mac-ci — GitHub Actions 自动打 macOS .dmg

> 状态:spec 草稿,**等 user 审签后动工**(规模 Medium-Large,按 v2 规范 1-spec 改前 user 审)。
> 起源:user 想让 GitHub 也能打 mac 包(现状 mac 只能本地手工 `pack-installer.sh`)。
> 关联:扩展现有 [release-自动化](../release-自动化/)(Win 已落地)到 mac 端。

---

## 一、目标 & 验收

**目标**:push 一个 mac 专用 ship tag 后,GitHub Actions 自动:
1. 在 `macos-latest` runner 上 build DeskFox.app + .dmg(arm64,不签名)
2. 上传 .dmg 作为 artifact
3. 创建 draft GitHub Release(user 审完手动 publish)

**验收**:
1. 本地 `bump-installer-version.sh -Platform macOS` → commit → tag `ship-mac-prod-<version>` → push,GitHub Actions 自动跑 mac job
2. 产物 `DeskFox-<version>_aarch64.dmg` 出现在 draft Release 附件
3. 下载 .dmg → 拖 Applications → 右键打开 → DeskFox 启动正常
4. workflow_dispatch 模式手动触发 dev/beta/prod build,只上传 artifact 不发 Release

---

## 二、关键决策(基于现有惯例,无大决策需 user 拍)

| 决策点 | 选择 | 理由 |
|---|---|---|
| **是否签名 / notarize** | ❌ **不签名** | 对齐 [`docs/governance/数字签名问题.md`](../../governance/数字签名问题.md) 既定路线;Win 端也不签;Apple Developer ID 要 $99/年。Gatekeeper "右键打开"的现有惯例继续用 |
| **架构** | **arm64 only** | 对齐 `macos-打包` feature 已落地实际(`aarch64-apple-darwin`);user 自己也是 Apple Silicon;universal build 时间 x2 + 体积大,无明确需求 |
| **tag 命名** | **`ship-mac-(prod\|beta)-<version>` 独立 tag** | bump 脚本本就是 per-platform N 序列设计(Mac 和 Win 各有 N),复用同一 tag 反而要改 bump 序列设计;独立 tag 解耦 — 想出 mac 时只发 mac,想出 win 只发 win |
| **workflow 文件** | **新增 `release-mac-deskfox.yml`,与 win 独立** | 两端 build 步骤差异大(Win:Inno Setup + .iss / Mac:tauri build → .dmg + 重命名);独立文件维护清晰,通过 hook 豁免规则 `*-deskfox.yml` 自动放行 |
| **workflow_dispatch** | **保留** | 对齐 Win,平时调试 workflow 不出 Release |
| **dmg 命名** | `DeskFox-<version>_aarch64.dmg`(prod) / `DeskFox Beta-<version>_aarch64.dmg`(beta) | 沿用 `pack-installer.sh` 已有的重命名规则,只需补 `--version` 参数 |
| **bump 流程** | **本地 bump 然后 push tag**(同 Win) | bump 脚本只算 N + 写 placeholder 到 `docs/installer-versions.md`,Mac 没有 .iss AppVersion 可校验。**workflow 解析 tag 拿 version,不再校验** — 信任本地 bump |

---

## 三、改动范围

### 新增文件

| 文件 | 大致行数 | 用途 |
|---|---|---|
| `.github/workflows/release-mac-deskfox.yml` | ~140 行 | mac CI 主体 |
| `docs/features/release-mac-ci/{1-spec,2-plan,3-changelog}.md` | ~300 行 | 三文档 |

### 修改文件

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/branding/scripts/pack-installer.sh` | 加 `--version <X>` 参数(NO_BUMP 模式下用于 dmg 重命名);**不在 workflow 里调用 pack-installer.sh,走更细粒度** | +5 行 |
| `docs/features/INDEX.md` | 加一行 `release-mac-ci` | +1 行 |
| `本仓 改动日志.md` | 加索引行 | +1 行 |

### **不改**(避免无关动)

- 现有 `release-deskfox.yml`(Win)— 不动,新文件独立
- `bump-installer-version.sh` — 已支持 `-Platform macOS`,不改
- `build-deskfox.sh` — 已支持 mac,不改

### 估总规模

- **代码 + workflow**:~150 行
- **文档**:~300 行
- **触动 fork-only 文件 ≤ 3 个,新增上游 0 文件,不破上游** ✅

按 v2 规范判定:**Medium**(50-500 行 + 单一主题 + 不触上游核心)。

---

## 四、workflow 主体设计(对照 win 版)

### 触发

```yaml
on:
  push:
    tags:
      - 'ship-mac-prod-*'
      - 'ship-mac-beta-*'
  workflow_dispatch:
    inputs:
      env:
        description: 'Build env'
        type: choice
        options: [dev, beta, prod]
```

### Job 步骤

```
1. checkout (fetch-depth: 0)
2. parse meta:
   - tag 模式: 解析 ship-mac-(prod|beta)-(.+) → env / version / is_release=true
   - dispatch 模式: env=inputs.env / version=YYYY.M.D.dispatchN / is_release=false
3. setup bun + rust(target=aarch64-apple-darwin)
4. cache rust target
5. bun install
6. build sidecar(predev.ts 自动)— 由 build-deskfox.sh 内嵌
7. build-deskfox.sh -Env <env>(出 .app + .dmg)
8. rename .dmg(.dmg 文件名带上 installer version,与 Win 对齐)
9. locate artifact:
   - 路径:packages/desktop/src-tauri/target/release/bundle/dmg/<name>.dmg
   - 算 size + sha256
10. upload-artifact(总是上传)
11. 仅 tag 模式: 创 draft GitHub Release(action-gh-release@v2)
    - body 包含 commit / tag / 文件名 / 大小 / sha256 / 未签名说明 + xattr 提示
```

### 关键差异 vs Win

| 项 | Win | Mac |
|---|---|---|
| runner | `windows-latest` | `macos-latest`(默认 arm64) |
| 装额外工具 | Inno Setup(choco) | 无(Xcode CLI 默认在 runner) |
| 版本一致性校验 | .iss AppVersion vs tag | **不校验**(Mac 无承载点;信任本地 bump) |
| 重命名产物 | Inno Setup 已用 AppVersion 命名 | `pack-installer.sh` 重命名逻辑(或在 workflow 里直接 mv) |
| 安装提示 | SmartScreen "更多信息 → 仍要运行" | Gatekeeper "右键打开"或 `xattr -cr <.app>` |

---

## 五、风险 & 回滚

### 风险

| 风险 | 严重度 | 缓解 |
|---|---|---|
| macos-latest runner 是 arm64 还是 x64? | 低 | GitHub 2024 起默认 arm64,`runs-on: macos-latest` 自动 M 系列;build target=`aarch64-apple-darwin` 一致 |
| sidecar build(predev.ts)在 CI 失败 | 中 | Win workflow 已踩过坑(`49ba8005c` 修目标目录),mac sidecar build 路径独立,先实测 |
| Gatekeeper 阻塞下载 .dmg 的用户 | 低 | Release body 已写"右键打开"提示;用户照做即可 |
| .dmg 命名规则与 pack-installer.sh 不一致 | 中 | workflow 里直接 mv 不调用 pack-installer.sh(避免 pack-installer 嵌的 bump 逻辑) |

### 回滚

```bash
# 整笔回滚:revert workflow 文件 + pack-installer.sh 改动
git revert <commit-hash>
# 单个 mac release 失败:删 tag + draft release(GitHub UI),修后重发
```

不影响 win workflow 现有功能(独立文件)。

---

## 六、未来扩展点(本笔不做)

1. **签名 / notarize**:future feature。需要 Apple Developer ID + 配置 secrets(APPLE_ID / APPLE_TEAM_ID / APP_SPECIFIC_PASSWORD / SIGN_IDENTITY)
2. **universal binary**(arm64 + x86_64):需要时再加 `lipo` 合并步骤
3. **统一 `ship-prod-*` 出 win + mac**:需要先把 bump 序列改成跨平台统一,工作量大,等真正需要"一个 release 含两端产物"时再做

---

## 七、修订记录

| 版本 | 日期 | 修订内容 | 修订人 |
|---|---|---|---|
| v0.1(草稿) | 2026-05-02 | 初版起草,等 user 审 | Claude |
