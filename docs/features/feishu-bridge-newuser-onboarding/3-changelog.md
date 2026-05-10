---
feat-id: feishu-bridge-newuser-onboarding
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-bridge-newuser-onboarding — changelog

## 一句话

让全新用户拿 .dmg 装完即用 — A1 plugin 路径失效自愈 + A4 default model 缺失警告与友好降级 + A3 .dmg 拖拽引导。

## commit 列表

| commit | 简述 |
|---|---|
| `839e0d4c8` | A1 — `fix(feishu-plugin-install): 路径失效自愈 — user 拖 .app 到 Applications 后插件不再卡死` |
| `3281c9396` | A4 — `feat(feishu-bridge): default model 缺失检测 + 友好降级回复` |
| `827bfd2f0` | A3 — `feat(branding): .dmg 拖拽引导背景图 + 显式 dmg layout` |
| `49616d7f8` | A4.A follow-up — `fix(feishu-bridge): A4.A 检测逻辑修 — data.default key 是 provider id 不是 agent name` |

## A1 — plugin 路径失效自愈(`839e0d4c8`)

### 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/desktop/src-tauri/src/feishu_plugin_install.rs` | 改 | idempotent 升级 + 5 unit test |

### 核心 diff

```rust
// 原:any 含子串就跳过(bug:旧路径失效仍占位)
let already_has = arr.iter().any(|v| ...contains(PLUGIN_DIR_NAME));
if already_has { return Ok(()); }

// 新:遍历分类(retain),失效移除有效保留,记录是否找到当前 plugin_url
arr.retain(|v| {
    // 不是本 plugin entry → 保留
    if !path_str.contains(PLUGIN_DIR_NAME) { return true; }
    // 是本 plugin entry → 检测路径
    if path_still_valid(path_str) {
        if path_str == plugin_url { found_current = true; }
        true
    } else {
        tracing::info!("removing stale entry: {path_str}");
        removed += 1;
        false
    }
});
if found_current { /* 跳过 push,真 idempotent */ }
else { arr.push(plugin_url); }
```

新增 `path_still_valid(raw)` helper:strip `file://` 前缀 → 平台分支(Win 多 strip 一个 `/`)→ `Path::exists()`.

### 测试

5 个 unit test(`cargo test --lib feishu_plugin_install::`):
- `first_inject_writes_entry_into_empty_config` — 空 config inject
- `idempotent_when_same_path_present_and_valid` — 第二次同路径不 rewrite 文件
- `stale_entry_is_replaced_when_path_changes` — **核心**:模拟 user 在 .dmg 挂载点双击 → 卸载 → 拖 Applications → idempotent 自愈
- `unrelated_plugin_entries_preserved` — user 自己加的非本 plugin entry 不动
- `path_still_valid_strips_file_url_prefix` — file:// 前缀剥离 + 路径删后探测正确

5/5 ✅

## A4 — default model 缺失检测 + 友好降级回复(`3281c9396`)

### 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/app/src/components/settings-feishu.tsx` | 改 | onMount 加 `checkDefaultModel` + warning 卡片 |
| `packages/app/src/i18n/{en,zh,zht}.ts` | 改 | 加 2 个 key:`settings.feishu.noDefaultModel.{title,hint}` |
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` | 改 | 抽 `friendlyErrorReply` 函数,session.create + promptAsync 失败两处统一调 |
| `packages/adapter-feishu-lark/src/feishu/__tests__/friendly-error.test.ts` | 新 | 7 unit test |

### A4.A 前端预防

```tsx
const [hasDefaultModel, setHasDefaultModel] = createSignal<boolean | null>(null)

const checkDefaultModel = async () => {
  try {
    const data = await feishuListProviders()
    setHasDefaultModel(Boolean(data.default?.build))
  } catch {
    setHasDefaultModel(null)
  }
}

onMount(async () => {
  const ready = await feishuAdapterStatus()
  setAdapterReady(ready)
  if (ready) { await refetch(); await checkDefaultModel() }
})

// JSX:adapter 就绪 + 没配 default → warning 卡片
<Show when={adapterReady() === true && hasDefaultModel() === false}>
  <div class="bg-surface-warning rounded-md p-4 ...">
    <p>{t("settings.feishu.noDefaultModel.title")}</p>
    <p>{t("settings.feishu.noDefaultModel.hint")}</p>
  </div>
</Show>
```

样式沿用现有 `adapter.notReady` 卡片(同 `bg-surface-warning` + 同样 spacing),0 新 token。

### A4.B 后端兜底

```ts
export function friendlyErrorReply(err: Error): string {
  const msg = err.message ?? String(err)
  const lower = msg.toLowerCase()
  if (lower.includes("no providers found") ||
      lower.includes("no models found") ||
      lower.includes("no model configured") ||
      lower.includes("invalid model")) {
    return "❌ DeskFox 未配置默认 LLM model。\n请打开 ... Settings → Providers ...\n(原始错误:" + msg + ")"
  }
  if (lower.includes("api key") || lower.includes("api_key") || lower.includes("401")) {
    return "❌ DeskFox 调用 LLM 失败 — API key 可能无效或额度不足 ..."
  }
  return `❌ DeskFox 处理出错:${msg}`
}
```

关键字来源(opencode source verified 2026-05-10):`provider.ts:1706/1708` + `cli/cmd/github.ts:722`。

### 测试

7 个 unit test(`bun test src/feishu/__tests__/friendly-error.test.ts`):
- 4 类识别:`no providers` / `no models` / `Invalid model` / API key 类
- 2 类不误伤:network timeout / 空 message
- 1 个 snake_case `api_key` 识别

7/7 ✅;i18n completeness 8/8 ✅;monorepo typecheck 16/16 ✅。

## A3 — .dmg 拖拽引导(`827bfd2f0`)

### 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/branding/scripts/generate-dmg-background.swift` | 新 | Swift CoreGraphics 脚本生成 660x400 PNG(可复跑) |
| `packages/branding/assets/dmg-background.png` | 新 | 生成产物(23KB,占位级)|
| `packages/desktop/src-tauri/tauri.conf.json` | 改 | 加 `bundle.macOS.dmg.{background, windowSize, appPosition, applicationFolderPosition}` |

### 引导图布局

660x400,白底:
- **顶部**:中文标题"将 DeskFox 拖到 Applications 即可安装"(18pt)+ 英文副标题
- **中部**:从 (180+70, 170) 到 (480-70, 170) 灰色箭头,起止避开 .app 与 Applications icon 70px 留白
- **底部**:Gatekeeper 提示中英双语 "首次打开如被拦截:右键 .app → 打开 → 仍要打开"(10pt 浅色)

### Tauri dmg 配置

```json
"macOS": {
  "entitlements": "./entitlements.plist",
  "dmg": {
    "background": "../../branding/assets/dmg-background.png",
    "windowSize": { "width": 660, "height": 400 },
    "appPosition": { "x": 180, "y": 170 },
    "applicationFolderPosition": { "x": 480, "y": 170 }
  }
}
```

windowSize / appPosition / applicationFolderPosition 跟 Tauri 默认值一致(`tauri-utils-2.8.0/src/config.rs:585-598` 核实),显式写出便于未来美术升级直接调坐标不需查 Tauri 内部。

### 验证

- Swift 脚本本机跑通,PNG 23099 bytes
- typecheck + 单测全 pass
- **dmg 实际装机效果**留 ship 时 user 实测(release build 慢,本笔不强制走完整 build)

## 影响范围 & 健康指标

- **新增行**:~270 行净代码 + ~120 行 Swift 脚本 + 12 个 unit test
- **改上游行**:0(全 fork-only,P1 隔离原则)
- **R4 override**:0
- **R3 黑名单**:0
- **新增 dep**:0

## 回退

```sh
git revert 827bfd2f0 3281c9396 839e0d4c8
```

按从后往前 revert(避免 conflict)。三笔互不依赖,可分别独立 revert。

## 关联

- 起源:`feishu-bridge-ship-packaging` 推完后从 fresh user 视角审查 happy path 5 项潜在阻塞,本笔做 A1+A4+A3。
- A1 修的是 ship-packaging 已记的"已知 trade-off #1"。
- A2(Gatekeeper 文档)/ A5(macOS notification)留下批,见 1-spec.md 的"不做"段。

## FUTURE

- A2:.dmg 内 readme.txt 或首启 dialog 引导 Gatekeeper 首次打开
- A5:macOS notification 权限请求 + tray badge 显示未读
- 美术升级:dmg-background.png drop-in 替换为带 logo / 品牌色的精装版本
- A4 friendlyErrorReply 文案 i18n 化(目前是中文 hardcode)— 若 DeskFox 用户群扩大到非中文 locale 再做
- `feishu-edit-account-dialog.tsx:69` 的 `data.default?.build` 同样 latent bug,但只影响"当前默认 model"文案(永远显示 `defaultUnset`),不阻塞功能 — 后续顺手修

## Follow-up #1(2026-05-10):A4.A 检测逻辑修 — `data.default` key 是 provider id 不是 agent name

### 起源

dev 实测 A4.A 警告卡片:user 已配 3 个 default(`minimax-cn-coding-plan` / `opencode` / `claude-code`)+ 已绑定飞书账号,**仍显示** "尚未配置默认 LLM model" 警告 — false positive。curl plugin server `/providers` 看实际响应:

```json
{
  "default": {
    "minimax-cn-coding-plan": "MiniMax-M2.7-highspeed",
    "opencode": "big-pickle",
    "claude-code": "sonnet"
  }
}
```

`data.default` 的 key 是**provider id**(`minimax-cn-coding-plan` 之类),**不是 agent name**(我以为的 `build` / `plan`)。所以 `data.default?.build` 永远是 undefined。

### 修法

`packages/app/src/components/settings-feishu.tsx`:

```ts
// 旧(false positive):
setHasDefaultModel(Boolean(data.default?.build))

// 新(实测 schema 对齐):
const defaults = data.default ?? {}
setHasDefaultModel(Object.keys(defaults).length > 0)
```

非空字典 = user 至少配过一个 provider 的 default model → 飞书消息进来时 opencode 能 routing → 不报警。

### 同样 bug 的 latent 副本

`feishu-edit-account-dialog.tsx:69` 同样的 `data.default?.build` 判断,导致"当前默认 model"文案永远显示 `defaultUnset` — latent bug,但只影响显示文案不阻塞功能(user 在 edit dialog 也没注意)。**本笔不修**(不在范围内,留 FUTURE)。

### 教训

抄现有代码做 follow-up feature 时,**抄的代码本身可能有 latent bug**。本来该看 opencode SDK schema 或 curl server response 自己确认,而不是机械对齐 sibling 代码。memory 加警示。
