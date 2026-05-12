---
feat-id: feishu-plugin-dedup-decision
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-plugin-dedup-decision — changelog

## 一句话

把"opencode.jsonc 累积多个 feishu-bridge plugin entry → multi-instance → 双推 user message"的根因诊断 + **不做产品层防御**的决策**显式写下**;`feishu_plugin_install.rs` 头加段决策注释防未来 agent 重复实施防御代码;`build-deskfox.{sh,ps1}` post-build 清开发机污染兜底。

## commit 列表

| commit | 简述 |
|---|---|
| `<本笔 commit>` | code + docs 一笔(Tiny 规模) |

## 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/desktop/src-tauri/src/feishu_plugin_install.rs` | +15 / -0 | 文件头 doc comment 加"**不做的事**(2026-05-12 决策)"段,列出理由 + 三层候选方案(L1/L2/L3),指向本文档 |
| `packages/branding/scripts/build-deskfox.sh` | +20 / -0 | `BUILD_EXIT == 0` 后加 jsonc 清理 — grep 计数 feishu-bridge 子串,>1 时备份原文件 + grep -v 删行 + `perl -i -0pe` 修悬空逗号 + mv 替换 |
| `packages/branding/scripts/build-deskfox.ps1` | +20 / -0 | Win 端对称 — `[regex]::Matches` 计数 + `Copy-Item` 备份 + Where-Object 过滤 + `[regex]::Replace` 修逗号 + `Set-Content -NoNewline` |
| `docs/features/feishu-plugin-dedup-decision/1-spec.md` | 新建 | 起源 / 真凶定位链路 / 决策表 + 理由 / 范围 / 验收 |
| `docs/features/feishu-plugin-dedup-decision/2-plan.md` | 新建 | 决策轨迹(初始诊断错→深查 plugin instance→长远修法选择→user 反问→最终决策)/ 顺序 / 不做 |
| `docs/features/feishu-plugin-dedup-decision/3-changelog.md` | 新建 | 本文件 |
| `docs/features/INDEX.md` | +1 | 索引行 |
| `改动日志.md` | +1 | 索引行 |

## 核心决策注释(feishu_plugin_install.rs 头)

```rust
// **不做的事**(2026-05-12 决策,[feat: feishu-plugin-dedup-decision]):
//   不做"同 plugin 多物理路径"清理 — 即当前 url 之外的 feishu-bridge entry,即使物理路径还在也保留。
//   理由:普通用户单装单跑场景永不撞(opencode.jsonc 永远 1 entry → 1 instance → 1 WSSClient → 飞书 server 单连接,
//   不会发"同 user message 分配不同 message_id 给不同 connection"的双推)。
//   触发"多 entry → multi-instance → 双推"的场景仅限:
//     ① 开发机三档来回切换(已由 build-deskfox.sh post-build 清理兜底)
//     ② 未来 auto-update 路径变化 / beta+prod 同跑
//   场景 ② 等真触发再评估,不预先实施防御代码(参 R1 三级跳 + 元原则"避免业务无限扩大")。
//   若未来需要,候选三层方案见 docs/features/feishu-plugin-dedup-decision/1-spec.md
//     L1 plugin process-level singleton(globalThis)
//     L2 inject 强制单 entry(改本文件 retain 逻辑成"当前 url 之外的 feishu-bridge entry 全清")
//     L3 file lock 跨进程 singleton
```

## 核心清理逻辑(build-deskfox.sh)

```bash
# === 3.5 开发机 jsonc 清理(防多档累积 → multi-instance 双推 message)===
if [[ "$BUILD_EXIT" -eq 0 ]]; then
    JSONC="$HOME/.config/opencode/opencode.jsonc"
    if [[ -f "$JSONC" ]]; then
        FEISHU_COUNT=$(grep -c "plugin/feishu-bridge" "$JSONC" 2>/dev/null || echo 0)
        if [[ "$FEISHU_COUNT" -gt 1 ]]; then
            echo "[deskfox] jsonc 发现 $FEISHU_COUNT 个 feishu-bridge entry,清理..."
            cp "$JSONC" "$JSONC.bak.build-cleanup"
            grep -v "plugin/feishu-bridge" "$JSONC.bak.build-cleanup" > "$JSONC.tmp"
            perl -i -0pe 's/,(\s*\])/\1/g' "$JSONC.tmp"
            mv "$JSONC.tmp" "$JSONC"
            echo "[deskfox] ✅ 已清,原文件备份至 $JSONC.bak.build-cleanup"
        fi
    fi
fi
```

## 测试

| Test | Result |
|---|---|
| `bash -n build-deskfox.sh` 语法 | ✅ |
| 本地 fixture 模拟 — 3 entry → 0 entry + 其他配置完整 | ✅ JSON 合法,plugin/agent/schema 全保留 |
| user 实测 — 手动清 jsonc + relaunch DeskFox → 双推消失 | ✅ 2026-05-12 user 反馈 |

**为什么没单测**:
- Bash / PowerShell 函数测试需 BATS / Pester 基础设施,本仓没用过
- 逻辑用 fixture 模拟跑通(grep -v + perl 替换),CI 不出意外
- Rust 注释 / sh 清理是 0 业务逻辑改动,改坏了 user 立刻发现
- 走 R5 测试纪律例外:Tiny < 50 行代码 / docs / 配置

## 行为验证(对照 user 实测痛点)

| 场景 | 改前 | 改后 |
|---|---|---|
| 开发机三档切换累积 4 entry | 3 instance → 双推 | build 后清掉 → 下次启动 setup hook inject 当前 .app → 1 entry → 1 instance |
| 普通用户单装 prod | 永远 1 entry → 0 影响 | 永远 1 entry → 0 影响(没变化)|
| 未来 user 报多 instance 撞双推 | 立刻动手修产品代码 | 1-spec.md 第一时间给出 L1/L2/L3 三层候选,直接挑 |

## 影响范围

- 净改动:3 代码文件 +55 / -0 行 + 3 新 docs
- 新文件:`~/.opencode` 路径下无新文件(只动 jsonc 清理逻辑)
- R4 override:0(packages/branding/scripts/ 是 fork-only,feishu_plugin_install.rs 也 fork-only)
- 上游侵入:0

## 不修的(scope-limited 留 backlog)

- **L1/L2/L3 三层防御**:auto-update / beta 公测前再评估
- **dedup-cache-persist / wss-text-dedup 撤回**:它们解决独立问题层(sidecar 重启 / 10s 内 IM 连击),跟本笔 multi-instance 不冲突,留着
- **plugin.ts module-level state 改造**:不动(它在 1 entry 场景下就是正常的 process-级单例,改 globalThis 是 over-engineering)

## 关联

- 起源:`imbot-permission-pragmatic` v2 + `wss-text-dedup` + `dedup-cache-persist` 后 user 仍撞双推 → 深查 plugin instance 数定位 jsonc 累积
- 不撤但相关:`dedup-cache-persist`(独立问题层 — sidecar 跨重启 dedup)/ `wss-text-dedup`(独立问题层 — IM 客户端 10s 连击)
- 用户视角:这次诊断纠正了我前一个 verdict 的方向错(误判为"飞书 server 行为,接受现状"),真凶在 opencode plugin loader + jsonc 累积层,**user 拒绝事后拦截哲学的判断完全正确**
