# OpenCode 私人定制版更新日志

本文档记录本次对 OpenCode 客户端自定义接入能力的两轮定制修改，重点围绕第三方 OpenAI-compatible API 的模型能力配置、思考强度、fast 模式，以及桌面端输入框旁的思考强度选择体验。

## 更新概览

- 目标仓库：`https://github.com/1134189025/opencode`
- 推送分支：`dev`
- 提交：`1597493e4 feat(app): customize provider capabilities`
- 主要范围：
  - `packages/app`：客户端自定义 provider 表单、模型能力配置 UI、输入框模型 variant 选择、i18n、测试
  - `packages/core`：provider options 降级/转换逻辑，支持更多 OpenAI-compatible 请求参数
  - `packages/opencode`：官方和 OpenAI-compatible provider variant / fast / reasoning 参数生成逻辑
  - `packages/ui`：Switch 组件选中态样式优化

---

## 第一次修改：增强自定义接入的模型参数能力

### 背景

原始 OpenCode 的自定义接入主要用于配置 OpenAI-compatible provider 的基础信息，例如 provider ID、名称、Base URL、API Key、模型 ID 和显示名称。

但对于第三方 API 或 Codex / GPT-5 类模型，原始自定义接入存在几个限制：

1. 自定义模型无法像官方接入那样声明 reasoning / thinking 能力。
2. 无法配置模型思考强度，例如 `low`、`medium`、`high` 等。
3. 无法配置 fast preset。
4. 部分 OpenAI-compatible 请求参数不能被正确转换为供应商 API 需要的实际字段。

### 核心变更

#### 1. 自定义模型增加 reasoning / fast 序列化能力

文件：`packages/app/src/components/dialog-custom-provider-form.ts`

新增模型配置字段：

```ts
configOpen: boolean
reasoning: boolean
fast: boolean
```

新增可选思考强度：

```ts
none
low
medium
high
xhigh
```

默认开启的思考强度为：

```ts
none / low / medium / high / xhigh
```

当模型启用 reasoning 后，会生成类似配置：

```ts
variants: {
  none: { reasoningEffort: "none" },
  low: { reasoningEffort: "low" },
  medium: { reasoningEffort: "medium" },
  high: { reasoningEffort: "high" },
  xhigh: { reasoningEffort: "xhigh" },
}
```

如果某个思考强度被关闭，则会生成：

```ts
high: { disabled: true }
```

这样客户端可以知道这个 variant 存在但不可选，从而避免用户误选不支持的能力。

#### 2. fast preset 支持

开启 `fast` 后，会生成 Codex 风格 Fast service tier 配置：

```ts
fast: {
  serviceTier: "fast",
}
```

这表示：

- 使用 Fast service tier：`serviceTier: "fast"`
- 不改变用户选择的思考强度
- 不改变输出详细度

这与项目中官方 OpenAI-compatible provider 的 fast 设计保持一致。

fast 不再依赖 reasoning 开关。用户如果想降低思考强度，应显式选择 `low` variant，而不是选择 `Fast`。

#### 3. OpenAI-compatible 请求参数转换增强

文件：`packages/core/src/v1/config/provider-options.ts`

增强 OpenAI-compatible lowerer，使配置中的 camelCase 参数可以转换为 OpenAI-compatible API 实际使用的字段。

已支持：

```ts
reasoningEffort -> reasoning_effort
textVerbosity -> text.verbosity
serviceTier -> service_tier
promptCacheKey -> prompt_cache_key
reasoningSummary -> reasoning.summary
```

其中 `textVerbosity` 的转换结果示例：

```json
{
  "text": {
    "verbosity": "low"
  }
}
```

这对 GPT-5 / Codex 风格模型尤其重要，因为它们常用 `text.verbosity` 控制回答详细程度。

#### 4. Provider transform 中补齐 OpenAI-compatible fast / Codex variant 行为

文件：`packages/opencode/src/provider/transform.ts`

官方 `@ai-sdk/openai-compatible` 分支中已有 fast 形式：

```ts
fast: {
  serviceTier: "fast",
}
```

本次修改让自定义接入生成的 fast 语义与官方 OpenAI-compatible provider 保持一致。

Codex 相关 reasoning effort 规则也被保留：

- Codex 基础 reasoning 能力至少支持：`low / medium / high`
- 较新 Codex / GPT-5 Codex 版本可支持：`xhigh`
- 部分新版本可支持：`none`

因此 fast 与 reasoning effort 分离，符合 Codex Fast Mode 作为服务层加速的语义。

---

## 第二次修改：独立配置按钮、开关样式和桌面端显示优化

### 背景

第一次修改解决了自定义接入能不能表达 reasoning / fast 能力的问题，但 UI 上仍需要进一步优化：

1. 不希望模型基础信息区域过于复杂。
2. 希望每个模型拥有独立配置按钮。
3. 希望 fast、reasoning、思考强度都使用开关样式。
4. 希望思考强度默认选项固定为 `none / low / medium / high / xhigh`。
5. 希望开启思考强度支持后，桌面端输入框旁可以直接选择思考强度。

### 核心变更

#### 1. 自定义模型新增独立配置按钮

文件：`packages/app/src/components/dialog-custom-provider.tsx`

每个模型行现在包含一个独立按钮：

```text
Configure model capabilities
```

点击后展开模型能力配置区域。

该设计将基础字段与高级能力分离：

- 基础字段：模型 ID、模型名称、删除按钮
- 高级配置：fast、reasoning、thinking intensity

这样可以避免普通用户首次添加模型时看到过多复杂配置，同时让高级用户可以按模型单独配置能力。

#### 2. fast 和 reasoning 改为开关样式

配置区内新增两个 Switch：

```text
Add fast preset
Supports reasoning / thinking
```

对应行为：

- `Add fast preset` 控制是否生成 `fast` variant。
- `Supports reasoning / thinking` 控制是否生成 reasoning variants。

#### 3. 思考强度也改为开关样式

当开启 `Supports reasoning / thinking` 后，会显示思考强度开关列表：

```text
None
Low
Medium
High
XHigh
```

每个思考强度都是独立开关。

关闭某个思考强度不会简单删除它，而是生成：

```ts
{ disabled: true }
```

这样可以让配置结构更明确，也方便客户端统一过滤不可用 variant。

#### 4. 输入框旁显示思考强度选择器

文件：`packages/app/src/components/prompt-input.tsx`

当当前模型存在可用 variants 时，输入框下方控制栏会显示思考强度选择器。

选择项包含：

```text
Default
Fast
None
Low
Medium
High
XHigh
```

具体显示取决于当前模型暴露的 enabled variants。

其中：

- `default` 显示为 `Default`
- `fast` 显示为 `Fast`
- 其他 effort 保持原 variant 名称显示

该选择器会调用已有的 model variant 选择逻辑，不改变模型选择本身，只改变当前模型的 variant。

#### 5. 过滤 disabled variants

文件：`packages/app/src/context/model-variant.ts`

新增：

```ts
enabledModelVariants(variants)
```

用于过滤：

```ts
{ disabled: true }
```

这样以下场景都不会显示或使用被禁用的 variant：

- 输入框旁的思考强度选择器
- 快捷键循环思考强度
- agent 配置中的默认 variant 解析
- 本地缓存中的 variant 恢复

#### 6. Switch 选中态样式优化

文件：`packages/ui/src/components/switch.css`

调整 Switch 组件在选中状态下 hover 的表现。

之前选中状态 hover 时可能会切回普通 hover 背景，视觉上容易误以为未选中。

现在选中 hover 仍保持选中颜色：

```css
&[data-checked]:hover:not([data-disabled], [data-readonly]) [data-slot="switch-control"] {
  border-color: var(--icon-strong-base);
  background-color: var(--icon-strong-base);
}
```

这样更接近桌面应用中稳定、明确的开关视觉状态。

---

## Codex fast 模式兼容性说明

当前实现下，Codex 风格 fast 的关键配置为：

```ts
fast: {
  serviceTier: "fast",
}
```

经过 lowerer 转换后，OpenAI-compatible 请求会得到：

```json
{
  "service_tier": "fast"
}
```

这符合 Codex fast 的核心要求：

- 使用 Fast service tier
- 不降低思考强度
- 不改变输出详细度
- 通过服务层获得更快响应

需要注意：

fast 与 `Supports reasoning / thinking` 相互独立。即使用户关闭 `Supports reasoning / thinking`，fast 仍会生成：

```ts
fast: {
  serviceTier: "fast",
}
```

这样可以避免 fast 隐式注入 `reasoning_effort`，也不会改变用户选择的 thinking effort。

如果目标模型是 Codex / GPT-5 Codex，推荐同时开启：

```text
Add fast preset
Supports reasoning / thinking
```

这样可以同时提供 Fast service tier 和独立的 thinking effort 选择。

---

## 涉及文件清单

### App 客户端

- `packages/app/src/components/dialog-custom-provider-form.ts`
  - 自定义 provider 表单状态扩展
  - reasoning effort 列表定义
  - fast / reasoning variant 序列化
  - disabled variant 输出

- `packages/app/src/components/dialog-custom-provider.tsx`
  - 模型能力配置按钮
  - fast / reasoning switch
  - thinking intensity switch 列表

- `packages/app/src/components/prompt-input.tsx`
  - 输入框旁 variant / thinking effort 选择器
  - `Fast` 显示文案

- `packages/app/src/context/model-variant.ts`
  - enabled variants 过滤
  - 忽略 `{ disabled: true }` 的 variant

- `packages/app/src/context/local.tsx`
  - 当前模型 variant 列表改为只返回 enabled variants

- `packages/app/src/i18n/en.ts`
  - 新增自定义模型配置和思考强度相关英文文案

### Core

- `packages/core/src/v1/config/provider-options.ts`
  - OpenAI-compatible 参数 lowerer 扩展
  - 支持 `textVerbosity`、`reasoningSummary` 等请求字段转换

### Provider transform

- `packages/opencode/src/provider/transform.ts`
  - 对齐 OpenAI-compatible fast / reasoning variant 行为
  - 保持 Codex / GPT-5 Codex effort 能力判断

### UI

- `packages/ui/src/components/switch.css`
  - Switch 选中 hover 样式优化

### 测试

- `packages/app/src/components/dialog-custom-provider.test.ts`
  - 验证自定义 provider 配置输出
  - 验证 fast preset
  - 验证 disabled variants
  - 验证 fast 可以独立于 reasoning 输出

- `packages/app/src/context/model-variant.test.ts`
  - 验证 disabled variant 不可被选择
  - 验证 enabled variant 列表过滤

- `packages/core/test/config/provider-options.test.ts`
  - 验证 provider options lowerer 转换

- `packages/opencode/test/provider/transform.test.ts`
  - 验证 provider transform 的 fast / reasoning 行为

---

## 验证结果

已执行：

```powershell
bun --cwd "C:\Users\11341\Desktop\opencode\packages\app" test --preload "./happydom.ts" "./src/components/dialog-custom-provider.test.ts" "./src/context/model-variant.test.ts"
```

结果：

```text
17 pass
0 fail
```

已执行：

```powershell
bun --cwd "C:\Users\11341\Desktop\opencode\packages\app" typecheck
```

结果：

```text
tsgo -b
0 error
```

---

## 使用建议

### 普通第三方 OpenAI-compatible API

如果第三方 API 只支持基础 OpenAI-compatible 调用：

- 可以只配置模型 ID 和模型名称。
- 不开启 fast。
- 不开启 reasoning。

这样生成的配置最保守，兼容性最高。

### 支持 Fast service tier 的第三方 API

如果第三方 API 支持 OpenAI 风格的 `service_tier`：

- 开启 `Add fast preset`
- 可以按需开启或关闭 reasoning

生成：

```ts
fast: {
  serviceTier: "fast",
}
```

### Codex / GPT-5 Codex 类模型

推荐开启：

```text
Add fast preset
Supports reasoning / thinking
```

并根据模型实际支持情况保留：

```text
low
medium
high
```

如果模型支持新能力，再开启：

```text
none
xhigh
```

完整 fast 会生成：

```ts
fast: {
  serviceTier: "fast",
}
```

### 不支持某些思考强度的模型

如果模型不支持某个思考强度，例如 `xhigh`，应在配置区关闭该开关。

关闭后客户端不会再在输入框旁选择器中显示该 variant。

---

## 风险和注意事项

1. `none` 和 `xhigh` 并非所有模型都支持。
   - 新版 Codex / GPT-5 系列通常支持更多 effort。
   - 老模型可能只支持 `low / medium / high`。

2. fast 对 Codex 合规，且不再需要 reasoning 开关配合。
   - fast 只表示 Fast service tier。
   - thinking effort 由 `low / medium / high / xhigh` 等 variant 独立控制。

3. 部分第三方 API 即使号称 OpenAI-compatible，也可能不支持 `service_tier`。
   - 如果开启 fast 后接口报错，可以关闭 fast。

4. disabled variants 会保留在配置里。
   - 这是有意设计，用于明确记录模型不支持的 variant。
   - 客户端会过滤这些 disabled variants，不会显示给用户选择。

---

## 总结

这两次修改将 OpenCode 的自定义接入从“只能配置基础模型”升级为“可以按模型声明能力的第三方 API 接入”。

最终效果：

- 自定义 provider 可以配置 fast。
- 自定义 provider 可以配置 thinking / reasoning。
- 自定义模型可以选择支持哪些思考强度。
- 输入框旁可以直接选择当前模型的 thinking effort。
- Codex fast 行为与官方 OpenAI-compatible fast 逻辑保持一致。
- 不支持的 variant 会被过滤，不会误显示给用户。
