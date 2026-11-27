# Docs translation glossary

Shared terms for the V2 docs translations (`src/docs/content/<locale>/`). The English column stays first and unchanged; each language adds its own column after `zh` (for example `de`), keeping the same rows. When a term is missing, follow the nearest row and add the new term here after review.

## Keep in English

- Product names: OpenCode, Zen, Go, Go Plus, Go Teams, Console, Desktop.
- The role words `agent` and `subagent`, including compounds such as coding agent.
- Provider, model, company, app and tool names.
- Acronyms: MCP, LSP, SDK, CLI, API, TUI, JSON.
- Commands, flags, config keys and values, environment variables, paths, code, URLs and keys.
- English UI labels quoted from the product, such as **Settings › Billing** or **Add credits**.

## Terms

| English | zh | Notes |
| --- | --- | --- |
| agent, subagent | agent、subagent、编程 agent | `child agent` → 子 agent |
| workspace / team | 工作区 / 团队 | Go Teams stays in English |
| account | 账号 | Never 账户 |
| authentication / authenticate | 认证 | Never 身份验证 |
| OAuth, access, bearer or install token | 令牌 | Model, usage, design and contract tokens stay `token` |
| proxy (network) | 代理 | Only for network proxies |
| provider (model provider) | 提供商 | API providers such as the plugin Ipc provider → 提供者 |
| transcript | 对话记录 | |
| scrollback | 滚动历史 | |
| formatter | 格式化程序 | |
| references (the feature) | 引用 | A docs "Reference" section stays 参考 |
| checkpoint | 检查点 | |
| effort (reasoning) | 推理强度 | |
| loopback | 回环 | |
| expose (API or RPC) | 对外提供 | Avoid 暴露 |
| composer | 输入框 | On `build/` plugin and API pages, `composer` names the API object; 输入框 otherwise |
| bundle | bundle | |
| harness, profile (Codex) | harness、profile | Keep in English |
| invoice / invoiced billing / credit limit / credits / balance | 发票 / 按发票结算 / 授信额度 / 额度 / 余额 | |
| Free (price or tier label) | 免费 | |
| base URL | 基础 URL | |
| Diff (the viewer or its section) | Diff | Generic differences → 差异 |
