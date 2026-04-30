---
feat-id: getbot-接入
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# GetBot 接入 — plan

## 实施步骤

1. **新文件 `packages/app/src/utils/getbot.ts`**:常量 + `fetchGetbotChatModels`(15s 超时 + 401/403 → `GetbotInvalidKeyError`)+ `buildGetbotProviderConfig` + `inferModelConfig` + `filterChatModels`(从 `D:\project\getbot-plugins\getbot-opencode\install.mjs` 移植 CLASSIFY_RULES)
2. **`hooks/use-providers.ts`**:`popularProviders` 加 `"getbot"` 排第二位;`all()`/`popular()` 用 `withGetbot` 注入合成项,`connected()`/`paid()` 不动
3. **`components/dialog-select-provider.tsx`**:sortBy override(getbot 强制置顶)+ note 加 getbot tagline + 推荐 Tag
4. **`components/dialog-connect-provider.tsx`**:介绍区加 getbot Match + handleSubmit 加 submitting + 新增 handleGetbotSubmit
5. **`components/dialog-select-model-unpaid.tsx`**:加 getbot Show(tagline + 推荐 Tag),与 opencode-go 同 pattern
6. **`components/settings-providers.tsx`**:PROVIDER_NOTES 加 getbot + popular sort 加 getbot 强制置顶 + 渲染加推荐 Tag
7. **`i18n/{en,zh,zht}.ts`**:加 7 个 key
8. **`packages/ui/src/components/provider-icons/sprite.svg` + `types.ts`**:注册 getbot icon

## 决策轨迹(开发中实时记录)

### 决策 1(2026-04-26):方案 A vs 方案 B

- 评估:见 1-spec.md "架构选型"段
- 选 B(0 核心改动)
- user 拍板理由:盈利核心要稳定,跟上游永远不冲突最重要

### 决策 2(2026-04-26):中文 tagline 文案

- 候选 1:"模型聚合平台 按量计费"(user 最早提议)
- 候选 2:"聚合多家大模型,按量计费"(实施第一版)
- 候选 3(终选):"聚合多家大模型,国内直连按量付费"(user 反馈后调整,加"国内直连"突出本地化卖点)

### 决策 3(2026-04-26):line1 模型列表换品牌

- 原:`Qwen / GPT / Claude / Gemini / GLM`
- 终:`Qwen / DeepSeek / Kimi / Minimax / GLM`(user 反馈调整,更贴合实际国产模型聚合)

### 决策 4(2026-04-27):provider.name 用长名 vs 短名

- 候选 A:`"GetBot 模型聚合平台 按量计费"`(所有位置都显示长名)
- 候选 B(选用):`"GetBot"`短名,长副标作为 tagline 单独显示
- 理由:长名在底部 model pill / 模型选择器分组头里太挤,短名 + tagline 视觉更清

### 决策 5(2026-04-27):未连 GetBot 时是否在选择模型弹窗显示占位组

- 候选 A:显示"GetBot"组头 + 提示去连接
- 候选 B(选用):**不显示**,模型选择弹窗只列已连接 provider 的模型
- 理由:与上游行为一致,引导用户去 Provider 弹窗连

### 决策 6(2026-04-27):key 校验失败时的反馈方式

- 候选 A:save apiKey + 警告 toast(我第一版做法)
- 候选 B(终选):401/403 → 内联红字 + 不 save;5xx/网络 → save + toast 兜底
- user 反馈:右下角 toast 不利于用户立即纠错,内联红字直接、显式

## 走过的弯路 / 中途调整

### 弯路 1:GetBot 连了"toast 显示成功但实际没连"

- 现象:user 输 key → toast"GetBot 已连接" → 重启后才发现实际没用
- 排查:直接 curl `/v1/models` 通,response 格式正常 → 排除 API 问题
- 看 user 本地 config:发现 `disabled_providers: ["getbot"]` 在阻止
- 根因:user 之前点过"断开连接",disconnect 函数对 isConfigCustom provider 走 `disableProvider` 写进 disabled_providers。重连时 handleGetbotSubmit **忘了同步清这一行**
- 修复:handleGetbotSubmit 保存 config 时同步 filter 出 getbot

### 弯路 2:试图修"connect/disconnect 后 UI 需重启才刷新"的 bug

- 怀疑 `bootstrapGlobal` 里的 `queryClient.fetchQuery` 缓存 stale 数据
- 加 `invalidateQueries` 在 `bootstrap()` 函数里 → 没用
- user 拿官方 OpenCode Desktop 对照实验:**官方版同样需要重启刷新** → 确认是上游 bug
- 撤销 invalidateQueries 改动,本笔不修

### 弯路 3:build 多次踩坑

- 错误 1:`taskkill /PID xxx /F` bash 把 `/PID` 当路径吃了 → 改用 PowerShell
- 错误 2:`OpenCode.exe` 进程占用 sidecar 文件 → PermissionDenied → user 决定后续 build 前自动杀进程,不询问
- 错误 3:一直直接跑 `tauri build` 出 `OpenCode.exe`,没用 `build-deskfox.ps1` wrapper → user 给软件定名 DeskFox,strict enforce wrapper

(这 3 个踩坑都已写进 CLAUDE.md 验证约定段,后续不会再犯)

## 风险

| 风险 | 概率 | 缓解 |
|---|---|---|
| sprite.svg / types.ts rebase 跟上游冲突 | 低 | 文件本身 append-only 性质,FORK marker 已加 |
| popularProviders 数组顺序漂移(上游加新内置 provider 插队) | 低 | popularProviders 是 fork-only 数组,上游不会动 |
| getbot.me API 域名变更 / 接口非 OpenAI 兼容 | 中 | 常量集中在 `utils/getbot.ts`,改一处 |
| /v1/models 响应格式变化 | 低 | extractModelIds 兼容 array / { data } / { models } 三种结构 |

## 预算

- 改上游 9 个文件 + 注册型扩展点 2 个:~250 行
- 新文件 fork-only 1 个(`utils/getbot.ts`):~120 行
- 新文件 fork-only 文档(本目录三文档):~600 行
- 总:~970 行(超 500 阈值,预计走 [large-diff] tag)
