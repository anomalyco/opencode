---
feat-id: network-bind-safety-guard
status: done
related: ./3-changelog.md
---

# network-bind-safety-guard — changelog

## 一句话

`feishu-server-loopback-bind` 教训沉淀 — 加 CLAUDE.md R6 网络监听安全规则 + pre-commit §4.5 hook,任何新增 `Bun.serve` / `*.listen()` 不显式指定 loopback 直接 commit block,杜绝同款"端口暴露公网"安全 bug 再发生。

> Tiny:2 文件 / 46 行 / 0 R4 / 0 上游侵入。

## commit 列表

| commit | 简述 |
|---|---|
| `9bba58b07` | `chore(governance): R6 网络监听安全规则 + pre-commit 4.5 hook 拦截 Bun.serve 默认 0.0.0.0` |

## 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `CLAUDE.md` | +12 行 | 加 R6 规则段(在 R5 测试纪律之后),说明任何新增 bind 必须显式 loopback,例外走 `[network-bind-public]` tag override |
| `.husky/pre-commit` | +34 行 | 加 §4.5 网络绑定闸:扫 staged 新增行匹配 `Bun.serve(` / `.listen(<num>)`,同文件搜安全标记(`hostname: "127.0.0.1"` / `"localhost"` / `.listen(port, "127.0.0.1")`),无标记则 block;测试文件(`__tests__` / `.test.` / `.spec.`)豁免 |

## 起源

`feishu-server-loopback-bind`(2026-05-10 同日)发现 `Bun.serve()` 缺 hostname → 默认 0.0.0.0 → 安全 + UX 双 bug。Audit 全仓发现 5 个 listen/serve 站点,1 个 fork-only 已修,2 个上游 OAuth callback server 也有同款 bug(独立 backlog REQ-019 走上游 PR)。

为防类似改动再次落网,本笔加规则 + 自动化闸。

## R6 规则要点

- 任何新增 `Bun.serve` / `*.listen()` 必须显式指定 `127.0.0.1` 或 `localhost`
- 默认 `0.0.0.0` 监听 = 暴露端口到所有网卡(LAN/公网)= Win Firewall 弹窗 + 安全风险
- 例外:走 `[network-bind-public: <理由>]` commit message tag override
- pre-commit hook §4.5 自动拦截违规
- 测试文件豁免

## §4.5 hook 实现

```sh
unsafe_bind_files=""
STAGED_TS=$(git diff --cached --name-only --diff-filter=AM | \
  grep -E '\.(ts|tsx|js|mjs)$' | grep -vE '__tests__|\.test\.|\.spec\.' || true)

for f in $STAGED_TS; do
  added=$(git diff --cached -- "$f" | grep -E '^\+' | grep -vE '^\+\+\+' || true)
  if echo "$added" | grep -qE 'Bun\.serve\(|\.listen\(\s*[0-9a-zA-Z_$]'; then
    if ! grep -qE 'hostname\s*:\s*["'"'"']?(127\.0\.0\.1|localhost)["'"'"']?|\.listen\([^)]+,\s*["'"'"'](127\.0\.0\.1|localhost)["'"'"']' "$f"; then
      unsafe_bind_files="$unsafe_bind_files\n  $f"
    fi
  fi
done
```

## 实测验证

实施时实测两个 case:

1. **故意写 `Bun.serve({ port: 3000, fetch: ... })` 无 hostname** → hook block ✅,显示提示"默认绑 0.0.0.0 = 暴露端口"
2. **写 `Bun.serve({ port: 3000, hostname: "127.0.0.1", fetch: ... })`** → hook 通过 ✅

提示文案统一"白名单 / diff 阈值 / 大小写 / 网络绑定 四项检查通过"。

## R4 / 上游侵入

- 0 R4 override
- 0 上游侵入(`.husky/pre-commit` 是 fork-only,`CLAUDE.md` 是 fork-only governance)

## 跟进

- **REQ-019 上游 OAuth server** 也有同款 bug,见 [`OPENCODE-PLAN/需求池/上游-oauth-server-loopback-bind.md`](../../../OPENCODE-PLAN/需求池/上游-oauth-server-loopback-bind.md),走上游 PR(本仓 hook 管不到上游)
