---
feat-id: getbot-接入
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# GetBot 接入 — spec

## 触发原因

user 指令:把 GetBot(模型聚合平台,api.getbot.me)放到供应商列表第一位 + 显示推荐标 + 内置配置(只填 apiKey)。GetBot 是项目盈利核心,需要在所有 Provider 选择类入口稳定占据第一位。

## 用户故事

| 角色 | 想做什么 | 验收 |
|---|---|---|
| 非编码用户 | 打开"+ 连接提供商" | 第一眼看到 GetBot,带"推荐"标 + 一句话副文案"聚合多家大模型,国内直连按量付费" |
| 同上 | 点 GetBot | 弹窗显示介绍文案 + getbot.me 链接 + **只**要填 1 个 API Key |
| 同上 | 输入正确 key 提交 | 自动拉模型列表,GetBot 出现在已连接列表,模型可在选择器里选 |
| 同上 | 输入错误 key | 输入框下方红字"API 密钥验证不通过",**不**保存任何东西 |
| 同上 | 网络断 | 15 秒后红字"连接 api.getbot.me 超时",**不**保存 |
| 同上 | 之前断开过 GetBot 又重连 | 自动恢复,无需手动改配置(不能被 disabled_providers 卡住) |

## 验收标准

### A. Provider 列表场景 — GetBot 第一

- [x] 设置→提供商 热门列表:GetBot 第 1,带 tagline + 推荐 Tag
- [x] 选择提供商弹窗:GetBot 第 1,带 tagline + 推荐 Tag
- [x] 未付费模型选择弹窗→加更多供应商:GetBot 第 1,带 tagline + 推荐 Tag

### B. Model 列表场景 — GetBot 第二(OpenCode Zen 第一)

- [x] 选择模型弹窗:OpenCode Zen → GetBot → OpenCode Go → ...
- [x] 管理模型弹窗:同上
- [x] 设置→模型:同上
- [x] GetBot 模型**无任何 Tag**(连"免费"都没有,也没有"按量")

### C. 连接 GetBot 流程

- [x] 介绍区:line1(模型列表 Qwen / DeepSeek / Kimi / Minimax / GLM)+ line2(自动拉 chat 模型说明)+ getbot.me 链接
- [x] apiKey 输入框 + 提交按钮(submitting 时 disabled + "正在授权..." 文案)
- [x] 401/403 → 内联红字"API 密钥验证不通过",**不**保存
- [x] 15s 超时 → 内联红字"连接 api.getbot.me 超时",**不**保存
- [x] 其他错误(5xx/网络抖动)→ 保存 key + 空模型列表 + 警告 toast(可稍后从设置刷新)
- [x] 成功 → toast + 自动清 disabled_providers + 关闭弹窗

### D. 不动的部分

- [x] anthropic/openai/google/... 等其他 provider 行为不变
- [x] opencode 核心层 0 改动(GetBot 完全走"自定义 OpenAI 兼容 Provider"机制,rebase 永远不冲突)
- [x] GetBot 显示名 = "GetBot"(短名),tagline 单独走 i18n key 在 Provider 选择类弹窗显示

## 不做什么

- ❌ 不把 GetBot 注册成 opencode 核心内置 provider(方案 A,risk 高,跟上游热点冲突)
- ❌ 不修上游"connect/disconnect 后 UI 需重启才刷新"的 bug(经官方 OpenCode Desktop 对照实验确认是上游问题,跟 fork 无关,本笔不修)
- ❌ 不做模型名美化(qwen3-max-2025-09 直接当 name,不映射"通义千问 3 Max")
- ❌ 不在已连接列表给 GetBot 单独标"内置/GetBot" Tag(走默认"自定义"Tag,与其他 OpenAI 兼容 provider 一致)

## 架构选型

### 方案 A:opencode 核心层内置 Provider

改 `packages/opencode/src/provider/provider.ts` 的 `custom()` 字典 + `httpapi/provider.ts` 的 list 注入。

- 优点:CLI / TUI / desktop 都能看到 GetBot
- 缺点:provider.ts 是上游热点文件,每次升级冲突大;rebase 风险高
- 评估:**否决**

### 方案 B(选用):前端注入合成项 + 走 config.provider 机制

- 前端注入合成 GetBot 项,让用户没接入时也在列表里可见
- 用户提交 apiKey → 拉 /v1/models 校验 → 写 `config.provider.getbot`
- 之后 GetBot 与任何"自定义 OpenAI 兼容 Provider"行为一致
- opencode 核心层**完全不知道 GetBot**(只看到一条 user-config provider)

优点:0 核心改动,跟上游永远不冲突,改动收口在 desktop app 层 + ui 包 sprite。
缺点:CLI / TUI 用户看不到 GetBot — 但 fork 目标用户是非编码人员,这个影响为 0。

## Provider/Model 体系内部参考

### 一、Provider — 数据流转

#### 数据源(4 个)

```
models.dev(远端注册表)→ database 基底
       ↓
config.provider.<id>(用户 jsonc 配置)→ extend / override
       ↓
环境变量(provider.env 字段)→ 标记 source: "env"
       ↓
auth 凭证存储 → 标记 source: "api"
       ↓
插件(plugin)→ 注册新 Provider
```

合并逻辑:`packages/opencode/src/provider/provider.ts` 的 `state init`(L1115-1290)。

#### 服务端输出

`GET /provider` → `ProviderListResponse`:

```ts
{
  all: Array<Provider>          // 含未连接
  default: { [providerID]: modelID }
  connected: Array<string>      // 已连接的 providerID
}
```

每个 Provider 结构:

```ts
{
  id: string                    // 唯一键,永不变
  name: string                  // UI 显示用短名
  source: "env" | "config" | "custom" | "api"
  env: string[]
  options: { ... }
  models: { [modelID]: Model }  // 模型嵌在 Provider 里
}
```

#### 前端封装

`packages/app/src/hooks/use-providers.ts` 的 `useProviders()`:

| 方法 | 含义 |
|---|---|
| `all()` | 全部 Provider(含未连接) |
| `popular()` | 在 `popularProviders` 数组里 |
| `connected()` | 已连接的 |
| `paid()` | 已连接 + 至少一个收费模型(opencode 特殊) |
| `default()` | 每个 Provider 的推荐默认模型 |

### 二、Model — 数据流转

**没有独立的"模型注册表"**。模型是 Provider 的子字段:

```ts
provider.models[modelID] = {
  id, name, family, release_date,
  attachment, reasoning, temperature, tool_call,
  cost: { input, output, cache_read, cache_write },
  limit: { context, input, output },
  modalities: { input: [...], output: [...] },
}
```

前端 `packages/app/src/context/models.tsx` 的 `useModels()`:`available()` 把 connected Provider 的 models 平铺成大列表。

### 三、用户交互点(共 8 处)

| # | 位置 | 文件 | 排序基准 |
|---|---|---|---|
| 1 | 选择提供商弹窗 | `dialog-select-provider.tsx` | popularProviders + getbot 强制置顶 |
| 2 | 连接提供商弹窗 | `dialog-connect-provider.tsx` | — |
| 3 | 自定义提供商弹窗 | `dialog-custom-provider.tsx` | — |
| 4 | 设置→提供商 | `settings-providers.tsx` | popularProviders + getbot 强制置顶 |
| 5 | 设置→模型 | `settings-models.tsx` | popularProviders 自然顺序 |
| 6 | 管理模型弹窗 | `dialog-manage-models.tsx` | popularProviders 自然顺序 |
| 7 | 选择模型弹窗 | `dialog-select-model.tsx` | popularProviders 自然顺序 |
| 7' | 未付费模型选择弹窗 | `dialog-select-model-unpaid.tsx` | popularProviders + getbot 强制置顶 |
| 8 | 输入框模型 pill | `prompt-input.tsx` | — |

### 四、命名口径

| 术语 | 例子 | 用途 |
|---|---|---|
| Provider ID(`providerID`) | `"getbot"` / `"opencode"` | 唯一键,永不变 |
| Provider Name(`provider.name`) | `"GetBot"` / `"OpenCode Zen"` | UI 短名,所有 group/pill/列表项吃它 |
| Provider Source(`provider.source`) | `"env" \| "config" \| "custom" \| "api"` | 影响 Tag 显示和断开逻辑 |
| Model ID(`model.id`) | `"qwen-max"` | 模型唯一键 |
| Model Name(`model.name`) | `"Qwen Max"` | UI 显示用 |

#### 排序口径

| UI 位置 | 排序 |
|---|---|
| Provider 选择类(选择提供商弹窗 / 设置→提供商热门 / 未付费模型选择弹窗加更多)| **getbot 强制第一**,其余按 popularProviders |
| Model 选择类(选择模型弹窗 / 管理模型 / 设置→模型)| popularProviders 自然顺序 = OpenCode Zen → GetBot → OpenCode Go → ... |

#### popularProviders 数组

```ts
["opencode", "getbot", "opencode-go", "anthropic", "github-copilot",
 "openai", "google", "openrouter", "vercel"]
```
