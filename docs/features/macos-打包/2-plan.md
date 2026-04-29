---
feat-id: macos-打包
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# macos-打包 — plan

## 总览

Phase 1(Windows 上 scaffolding)→ Phase 2(Mac 上首次 build + troubleshoot)→ Phase 3(出 .dmg + user 验证)。

**Phase 1 已完成本会话**(详见 [3-changelog.md](./3-changelog.md))。Phase 2/3 待 user Mac 上动手。

## Phase 2 — user Mac 上具体步骤

### Step 0:装环境(一次性)

```bash
# 1. Xcode Command Line Tools(iconutil / clang / Mac SDK)
xcode-select --install   # 弹 GUI 装,~30s 下载

# 2. rustup(Rust toolchain)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustup target add aarch64-apple-darwin   # 你 M 系列默认 host 就是这个,但加一遍稳

# 3. bun(JS runtime + 包管理)
curl -fsSL https://bun.sh/install | bash
exec $SHELL   # 重载 shell 环境

# 验证
bun --version       # ≥ 1.0
rustc --version     # ≥ 1.70
iconutil --version  # macOS 自带,有就行
```

### Step 1:clone 仓

```bash
mkdir -p ~/projects && cd ~/projects
git clone https://gitee.com/zoulukuang/opencode-for-office-deskfox.git opencode-fork
cd opencode-fork
git checkout feat/editable-file-viewer
```

> 仓库别名见 [docs/PLANNING-OVERVIEW.md](../../PLANNING-OVERVIEW.md);本地目录建议同名 `opencode-fork`(跟 Windows 端对齐)。

### Step 2:装依赖

```bash
bun install   # ~3-5 分钟,首次会装 1000+ 包
```

### Step 3:首次 build

```bash
bash packages/branding/scripts/build-deskfox.sh -Env prod
```

预期输出:
- `[deskfox] RUST_TARGET=aarch64-apple-darwin`
- `[deskfox] sidecar not found, building via predev.ts...` →(bun --compile,~1-3 分钟)
- `[deskfox] sidecar built: ~160MB`
- `applied DeskFox prod icons → ...`
- `wrote .../icon.icns (...) bytes`
- `also synced → ...icons/dev/icon.icns (mac bundle base path)`
- `tauri build` 跑(rust 编译 ~5-10 分钟首次,后续增量 ~30s)
- 产物:
  - `packages/desktop/src-tauri/target/release/DeskFox`(raw binary)
  - `packages/desktop/src-tauri/target/release/bundle/macos/DeskFox.app`
  - `packages/desktop/src-tauri/target/release/bundle/dmg/DeskFox_1.14.21_aarch64.dmg`

### Step 4:验证

```bash
# 直接跑 .app,绕 Gatekeeper(首次)
xattr -cr packages/desktop/src-tauri/target/release/bundle/macos/DeskFox.app
open packages/desktop/src-tauri/target/release/bundle/macos/DeskFox.app
```

或:Finder 双击 `.dmg` → 拖 `DeskFox.app` → Applications → 首次启动 **右键 → 打开 → 仍要打开**。

**验证清单**:
- [ ] DeskFox 启动,主窗口出来
- [ ] Dock 图标是 DeskFox 狐狸(scale 1.4 大狐狸)
- [ ] 窗口标题栏 / Mission Control 显示也是狐狸
- [ ] file viewer 能打开文件、编辑、保存
- [ ] chat 能用(provider 配好的话)
- [ ] sidecar 正常 spawn,不报"无法找到 opencode-cli"

### Step 5:回填文档

build 跑通 → commit hash 拿到 → 回填:
- `docs/features/macos-打包/3-changelog.md`(填实际命中的坑、产物大小、commit hash)
- `改动日志.md` 索引表加 macos-打包 行
- `docs/features/INDEX.md` macos-打包 状态置 done

## 风险与预案

| 风险 | 概率 | 预案 |
|---|---|---|
| sidecar build 失败(bun --compile 在 Mac 上有 bug) | 低 | 单独跑 `cd packages/opencode && bun run build --single` 看错误;最差从 sst/opencode releases 下载 1.14.21 Mac binary 手动放 `src-tauri/sidecars/opencode-cli-aarch64-apple-darwin`(选项 A 兜底) |
| icon.icns 嵌入坑(等价 winres bug) | **高**(已主动防范) | apply-icons.sh 已自动同步覆盖 `dev/icon.icns`;若仍错,用 Windows 同款 A/B 法验证(把 prod ico 直接覆盖到 dev,看 .app 嵌入是否变) |
| Tauri Rust 依赖编译慢 / 失败 | 中 | rust + clang + Mac SDK 都装好;首次 5-10 分钟正常;失败常因 macOS 版本太旧(< 11)或 Xcode CLI 没装齐 |
| Gatekeeper 拦得太死(.app 完全不能打开) | 低 | `xattr -cr` 去 quarantine attr;或系统偏好设置 → 安全性 → "仍要打开" |
| `.dmg` 不是 ARM only 而是 universal,体积翻倍 | 低 | Tauri 默认按 host 架构;若 target 配置出错,加 `--target aarch64-apple-darwin` |
| sidecar 名字不匹配(predev 产 `opencode-cli` 而非 `opencode-cli-aarch64-apple-darwin`) | 中 | utils.ts 的 `copyBinaryToSidecarFolder` 已自动加 target-triple 后缀,理论无问题;若有,看 RUST_TARGET 环境变量是否正确设置 |
| identifier 跟 sst 官方 OpenCode 撞(都装时 Library data 共用) | 低 | 当前不动 identifier(跟 Windows 策略一致);要分家 prod.json 加 `"identifier": "ai.deskfox.desktop"`,需重 build + .app data 路径变 |

## 决策轨迹

| 决策点 | 选 | 理由 |
|---|---|---|
| sidecar 来源 | B 本地 build | 上游 predev.ts 已自动支持,版本绝对一致,零外部依赖 |
| icon.icns 工具 | macOS 内置 iconutil | 无 brew 依赖,标准 Apple 工具链 |
| build 主入口 | 新写 .sh 对称 .ps1(不合并)| 各自清晰;cross-platform script 改造风险大,以后再说 |
| 是否签名 | 不签 | 跟 Windows 同策略,$99/年不投 |
| 是否公证 notarize | 不做 | Apple 审核流程不值 |
| 目标架构 | 仅 arm64 | user 是 M 系列,Intel 暂不分发 |
| @2x.png 处理(dev env 源没 256) | 留旧 dev/128x128@2x.png | dev build 不分发,影响小 |

## 预算

| 项 | 行数 / 说明 |
|---|---|
| `packages/branding/scripts/build-deskfox.sh` | ~140 行 |
| `packages/branding/scripts/apply-icons.sh` | ~100 行 |
| `packages/branding/scripts/restore-icons.sh` | ~20 行 |
| `packages/branding/scripts/png-to-icns.sh` | ~70 行 |
| `packages/branding/tauri-overrides/prod.json` 加 .icns | +1 行 |
| `packages/branding/src/assets/icons/{prod,beta}/ico-source/{512,1024}.png` | +4 binary 文件 |
| `docs/features/macos-打包/{1-spec,2-plan,3-changelog}.md` | ~400 行 docs |
| **总计** | ~700 行 source + 4 binary |

Medium 规模(< 500 行 source 但接近上限)。

## 重启后 resume 提示

下次 user 说"开始打 Mac 版":
1. 提醒 user 在 Mac 上动手(不在 Windows)
2. 直接走 [2-plan.md](./2-plan.md) Step 0-5
3. 第一次 build 多半会有 1-2 个真实坑(sidecar / icns / Tauri Mac config),记到 3-changelog "走过的弯路" 段
4. 跑通后回填 commit hash
