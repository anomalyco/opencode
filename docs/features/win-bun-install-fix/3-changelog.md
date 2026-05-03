---
feat-id: win-bun-install-fix
status: done
related: ./3-changelog.md
---

# win-bun-install-fix — changelog

## 触发原因

2026-05-03 sync upstream merge 尝试期间(详见 `sync-2026-05-03-aborted/3-changelog.md`),`bun install` 反复在 Windows 上报:

```
'node-gyp.cmd' is not recognized as an internal or external command
error: install script from "tree-sitter-powershell" exited with 1
```

副作用:install 中途失败 → bun 没完成 link 阶段 → 部分 package 的 `node_modules/@types/...` 链接残缺 → 多个 package typecheck 假错(如 `@opencode-ai/shared` 的 `Buffer`/`process` 找不到 type)。

之前 user push doc commit 时也撞到了 → 走 `--no-verify` 绕过 pre-push hook。这是治标。

## Root cause(完整定位)

排查路径:

### 1. `tree-sitter-powershell@0.25.10` 的 install 脚本是 `node-gyp-build`

```json
"scripts": {
  "install": "node-gyp-build",
  ...
}
```

`node-gyp-build` 行为:① 先查 `prebuilds/<platform>/` 是否有匹配的 prebuilt `.node` 文件 → 找到就用;② 没找到 → fallback 到 `node-gyp build` 从源码编译。

### 2. `tree-sitter-powershell@0.25.10` **不发 Windows prebuilds**

对照 `tree-sitter-bash@0.25.0`(同样 setup):

| 包 | `prebuilds/` 目录 |
|---|---|
| `tree-sitter-bash@0.25.0` | ✅ darwin-arm64 / darwin-x64 / linux-arm64 / linux-x64 / **win32-arm64 / win32-x64** |
| `tree-sitter-powershell@0.25.10` | ❌ 整个 `prebuilds/` 目录都不存在 |

→ Windows 上 `node-gyp-build` 必然走 fallback `node-gyp build` → 需要 node-gyp 在 PATH(没装) → 报错。

### 3. fork(以及 upstream)实际只用 WASM,**根本不需要 native binding**

```ts
// packages/opencode/src/tool/bash.ts(fork)
const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, {
  with: { type: "wasm" },
})

// packages/opencode/src/tool/shell.ts(upstream/dev,文件名换了但用法一样)
const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, {
  ...
})
```

`tree-sitter-powershell.wasm` 是 npm 包内置的**静态文件**(`files: ["*.wasm", ...]`),跟 postinstall 无关。

### 4. 但 `trustedDependencies` 里**列了** `tree-sitter-powershell`

```json
// 上游 root package.json
"trustedDependencies": [
  "esbuild",
  "node-pty",
  "protobufjs",
  "tree-sitter",
  "tree-sitter-bash",
  "tree-sitter-powershell",   // ← 这个让 bun 跑它的 postinstall(node-gyp build)
  "web-tree-sitter",
  "electron"
]
```

bun 行为:`trustedDependencies` 内 → 跑 postinstall;不在 → 跳过。

### 综合结论

**上游 oversight**:`tree-sitter-powershell` 列进 `trustedDependencies` → postinstall 跑 → 在没 prebuilt 的 Windows 上 fallback 编译 → 装 VS Build Tools 才能跑。但 fork + upstream 都只用 WASM,native binding 完全没用 → **trust 是浪费**。

mac/linux dev 撞不到这个坑:`prebuilds/` 也没他们平台,但 mac/linux 上 node-gyp 一般有(brew/apt 装个 base build tools 即可),所以 `node-gyp build` 能跑通(虽然产出的 .node 没人用)。Windows 上要装 ~2GB 的 VS Build Tools,门槛高,坑就显出来了。

## 修复

### EDIT `package.json`(R4 override 第 3 笔本季)

```diff
  "trustedDependencies": [
    "esbuild",
    "node-pty",
    "protobufjs",
    "tree-sitter",
    "tree-sitter-bash",
-   "tree-sitter-powershell",
    "web-tree-sitter",
    "electron"
  ],
```

1 行删除。bun 不再跑 `tree-sitter-powershell` postinstall → 不再 fallback 编译 → install 不再被 native build 失败阻断 → 后续 link 阶段完整 → 各 package 的 `@types/*` 链接完好 → typecheck 真过。

WASM 文件仍然 ship(static `*.wasm` in npm package),fork 运行时用 wasm 不受影响。

## 验证

| 项 | 结果 |
|---|---|
| `bun install`(clean from scratch)| `tree-sitter-powershell` 错消失 ✅(electron 网络下载偶尔失败属另一独立 issue,不影响 link 阶段) |
| `bun turbo typecheck --force` | **15/15 successful**(0 错,过去 shared 的 Buffer/process 假错没了) |
| `build-deskfox.ps1 -Env dev -NoBundle` 端到端 release build | **DeskFox.exe ready**(86s) |
| 实际 PowerShell 解析(opencode 的 bash tool 处理 .ps1)| 待 user 自验(应该不变,因为走 wasm 路径) |

## 影响范围

### 直接收益
- Windows `bun install` 不再被 tree-sitter-powershell 阻断
- `pre-push` hook 真过(不需要再 `--no-verify`),safety net 恢复
- sync upstream merge workflow 不再因 install 状态不稳被卡(下次 sync 立即受益)

### 长期
- 上游升级 `tree-sitter-powershell` 后(若发了 Windows prebuilds),fork 这笔变成 dead override —— 那时考虑加回 trustedDependencies 跟上游对齐(但本质无妨,留着也不影响行为)
- 也可以同时去 sst/opencode PR 把 entry 删掉(让所有 Windows dev 受益,本笔 fork override 可以撤回)—— **本次 user 决定不做 D 路径**(详见 sync-prep 决策对话)

### 风险
- **几乎没有**:
  - 真要用 native binding 的人会碰到运行时找不到 .node → 但全 codebase grep 0 处用 native(都用 wasm)
  - 上游某天加用 native binding 的代码 → 会显性 import 失败 → 立即可见(非静默回归)

## R4 override

**第 3 笔本季配额**(超本季 ≤2 配额 1 笔)。论证:

| 项 | 论证 |
|---|---|
| 触动文件 | `package.json`(blacklist `^package\.json$`) |
| wrapper 替代不可行 | `trustedDependencies` 是 bun 的 package.json-only 机制,无 `bunfig.toml` / env var / 文件夹 override 等替代路径 |
| `patchedDependencies` 替代评估 | 也要改 `package.json` 加 `patchedDependencies` 字段 + 维护 patch 文件,**反而**多依赖 + 上游升包 patch 易失效。1 行 `trustedDependencies` 删除是最小改动 |
| 收益 vs 配额代价 | 1 行改 → 永久解决 Windows install 痛点 + 解锁 sync workflow 流畅度。**本季 R4 第 3 笔超 1 笔配额**,但属于"减 fork 漂移 / 修上游 oversight"类,不是"加 fork 政策" → 风险 risk profile 跟典型 R4 不同 |
| 用户授权 | 本笔在 R4 超额情况下 user 明确同意(2026-05-03 对话中"同意 A,D 暂时不做") |

## 回退方法

```bash
# 单 commit revert,无 lock-in
git revert <本笔 commit hash>
```

回退后:postinstall 重新跑 → Windows 装 VS Build Tools 可让它跑 → 不装则 install 失败回到老问题。

## 关联

- 触发文档:[`docs/features/sync-2026-05-03-aborted/3-changelog.md`](../sync-2026-05-03-aborted/3-changelog.md) — sync 期间踩坑全过程
- bun install 工艺:[`docs/governance/UPSTREAM-MERGE-GUIDE.md`](../../governance/UPSTREAM-MERGE-GUIDE.md) §4.7 `bun.lock` 处理 + §7 踩坑表
- 未做的 D 路径:PR upstream 删 entry(本次 user 暂不做,可未来某次顺手提)
