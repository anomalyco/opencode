# YunPat 独立运行说明

本文说明脱离 OpenCode 官方基础设施后，如何完成本地开发与内测。

## 不依赖 opencode.ai 的最小闭环

1. 克隆 `git clone https://github.com/xujian519/yunpat-ts.git`（仓库名 `yunpat-ts`，产品名 `yunpat`）并 `bun install`
2. 在项目中配置 `.yunpat-agent/`（或兼容的 `OPENCODE_*` 环境变量）
3. 在配置中填写**自备** LLM Provider API Key（OpenAI、Anthropic、本地模型等）
4. 启动引擎：`bun run dev` 或 `packages/opencode` 下 `serve`
5. （可选）Web：`bun run dev:web`
6. （可选）桌面：`bun run dev:desktop` 或打包 `packages/desktop`

无需：

- `curl https://opencode.ai/install`
- OpenCode Zen / `api.opencode.ai` 账号（除非你在配置里主动选用相关 endpoint）

## 仍可能出现的上游字符串

引擎与配置 schema 中可能保留 `OPENCODE_*` 环境变量、`https://opencode.ai/...` 的 JSON `$schema` 链接等。这些多为兼容层，不影响本地专网部署。

## 桌面端内测（约 4 台 Mac）

- 使用 **Electron**（`packages/desktop`），不必使用 Swift Mac 壳
- 无 Apple Developer Program 时可分发**未签名** DMG/.app
- 测试机首次启动：右键 → 打开，或 `xattr -cr <app路径>`

## 与上游同步（可选）

```bash
git remote add upstream https://github.com/sst/opencode.git  # 若尚未添加
git fetch upstream
# 仅 cherry-pick 需要的提交，避免整分支 merge
```

## 发布清单（对外分发二进制时）

- 附带 [LICENSE](../LICENSE) 与 [NOTICE](../NOTICE)
- 使用自有 GitHub Release 命名（如 `yunpat-desktop-v1.0.0`）
- 配置自有 Sentry / 更新源（勿指向上游 opencode.ai）
