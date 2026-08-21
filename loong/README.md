# opencode loongarch64 移植

## 环境

- **机器**: 龙芯 loongarch64（172.16.16.149）
- **Node.js**: v26.7.0
- **Bun**: 无（本机无 bun，所有 bun 依赖均用 shim 替代）
- **esbuild**: 0.28.2（支持 loongarch64 原生二进制）

## 快速开始

```bash
cd ~                         # 关键：不要在仓库目录内，否则模型被 mock 覆盖
opencode                     # 进入 TUI
```

TUI 启动约 6s，使用免费模型 `deepseek-v4-flash-free`（`opencode.ai/zen` 网关，免 API Key）。

## 文件结构

```
loong/                          # 龙芯移植文件
├── README.md                   # 本文件
├── build-loong.mjs             # esbuild 打包脚本（生成 dist/loong/）
├── oc-boot4.mjs                # 源码启动入口（备选，已废弃）
├── preload-tsx.mjs             # Bun 全局 shim + worker 兼容 + asset-loader 注册
├── oc-jsxbabel-loader.mjs      # .ts/.tsx → babel 编译 + 盘缓存（.jsx-cache/）
├── asset-loader.mjs            # resolve/load hooks：@/ 别名、扩展名解析、资产加载
├── bun-global-shim.mjs         # Bun 全局对象模拟
├── bun-shim.mjs                # Bun 运行时模拟
├── bun-ffi-shim.mjs            # bun:ffi → Node FFI 适配
├── bun-sqlite-shim.mjs         # bun:sqlite 空壳（不持久化）
├── package.json                # 空包（占位）
└── package-lock.json

dist/loong/                     # 构建产物（不提交）
├── opencode.mjs                # 主 bundle（esbuild 单文件，~17MB minified）
├── worker.mjs                  # TUI worker bundle
└── shims.mjs                   # 运行时 shim（Worker/onmessage/postMessage 兼容）

~/.local/bin/opencode           # 全局快捷命令
~/.config/opencode/opencode.jsonc  # 默认模型配置
~/.cache/opencode/              # 模型网关卡缓存
```

## 构建

### 前置依赖

```bash
# 1. 安装 babel 工具链（独立目录，避免污染仓库）
mkdir -p ~/jsx-babel && cd ~/jsx-babel
npm init -y
npm install @babel/core@^7.28.0 @babel/preset-typescript@^7.27.1 babel-preset-solid@^1.9.15

# 2. 确保仓库 node_modules 已安装
cd ~/devel/opencode && pnpm install
```

### 构建 bundle

```bash
cd ~/devel/opencode
node loong/build-loong.mjs
```

产物在 `dist/loong/opencode.mjs` + `worker.mjs`。

### 安装 wrapper

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/opencode << 'EOF'
#!/usr/bin/env bash
set -e
REPO="$HOME/devel/opencode"
exec node --experimental-ffi --conditions=browser --import "$REPO/dist/loong/shims.mjs" "$REPO/dist/loong/opencode.mjs" "$@"
EOF
chmod +x ~/.local/bin/opencode
```

确保 `~/.local/bin` 在 `PATH` 中（`~/.bashrc` 第 13 行）。

## 源码改动清单

以下为相对原仓库的修改（MIT 协议，合法合规）：

| 文件 | 改动 | 原因 |
|------|------|------|
| `packages/core/src/global.ts` | 顶层 `await Promise.all(mkdir)` → 同步 `mkdirSync` | 消除顶层 await，避免 esbuild 打包后 async 循环死锁 |
| `packages/core/src/database/migration.gen.ts` | 动态 `await import()` → 静态 `import` | 同上 |
| `packages/opencode/src/util/rpc.ts` | 删除 6 处 RPC-DBG 调试 stderr | 屏幕刷屏 |
| `packages/opencode/src/index.ts` | 删除 3 处 DBG 调试 stderr | 屏幕刷屏 |
| `packages/tui/src/context/helper.tsx` | 删除 CTX-PROV 调试 | 屏幕刷屏 |
| `packages/tui/src/context/sync.tsx` | 删除 BOOTSTRAP-START/SYNC-ONMOUNT | 屏幕刷屏 |
| `packages/tui/src/context/clipboard.tsx` | 删除 CLIP-BODY | 屏幕刷屏 |
| `packages/tui/src/context/location.tsx` | 删除 LOCATION-BODY | 屏幕刷屏 |
| `packages/tui/src/context/runtime.tsx` | 删除 TUI-PATHS-BODY/TTE-BODY/TSTARTUP-BODY | 屏幕刷屏 |
| `packages/tui/src/component/startup-loading.tsx` | 删除 STARTUP-EFFECT | 屏幕刷屏 |
| `packages/tui/src/app.tsx` | 删除 APP-BODY | 屏幕刷屏 |
| `packages/tui/src/shell/shell.tsx` | 删除 TTE-BODY | 屏幕刷屏 |
| `packages/tui/src/shell/startup.tsx` | 删除 TSTARTUP-BODY | 屏幕刷屏 |
| `packages/tui/src/shell/clipboard.tsx` | 删除 CLIP-BODY | 屏幕刷屏 |
| `packages/opencode/src/cli/tui/content.ts` | 删除 TUI-PATHS-BODY | 屏幕刷屏 |
| `node_modules` @opentui/core dist | 删除 CAPS-*/MOUNT-SOLID/[D2] 调试 | 第三方库自带调试输出（用 patch-package 管理） |

## 已知限制

- **bun:sqlite 是空壳**：会话/消息不落盘，重启后丢失。对话功能正常（走网关），只是不持久化。
- **TUI 输入需真机终端**：pty 模拟（script/docker）下字符输入可能不进去，本机物理终端或 `ssh -t` 没问题。
- **必须在仓库目录外运行**：`~/devel/opencode/.opencode/opencode.json` 会把模型覆盖为 `mock/mock`。从 `~` 或任意非仓库目录执行。
- **shims.mjs 含硬编码绝对路径**：`dist/loong/shims.mjs` 里引用了 `file:///home/Way-Kwok_Chu/devel/opencode/loong/bun-global-shim.mjs`，更换用户/目录需同步修改。

## 性能

| 方式 | --version | 备注 |
|------|-----------|------|
| tsx 源码（冷启动） | 31s | 已废弃 |
| babel 源码（boot4） | 12s | 保留备选 |
| esbuild bundle（minify） | 6s | 当前默认 |

## 清理

```bash
# 仓库根目录下本会话创建的测试文件，可删除
rm -f ~/devel/opencode/tmp-empty.mjs ~/devel/opencode/tmp-m1.mjs
# loong/ 下旧版本 loader（不再使用）
# hooktest.mjs myjsx-loader.mjs myjsx2-loader.mjs myjsx3-loader.mjs
# oc-boot.mjs oc-boot2.mjs oc-boot3.mjs w.ts
```