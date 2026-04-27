---
feat-id: getbot-接入
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# GetBot 接入 — changelog

**关联 commit**: `8e4aa3944`
**所在分支**: `feat/editable-file-viewer`
**baseline tag**: 沿用线
**触发原因**: 见 1-spec.md "触发原因"段

## 实际改动

### 新文件 fork-only

- `packages/app/src/utils/getbot.ts`(~120 行):
  - 常量:`GETBOT_PROVIDER_ID/NAME/BASE_URL/NPM/SITE_URL`
  - `GetbotInvalidKeyError`(401/403)+ `GetbotTimeoutError`(15s)
  - `fetchGetbotChatModels(apiKey, { fetch?, signal?, timeoutMs? })`
  - `buildGetbotProviderConfig(apiKey, chatIds)`
  - `inferModelConfig(id)`(从 install.mjs 移植)
  - `filterChatModels(ids)`(CLASSIFY_RULES 过滤掉 image/tts/asr)

### 修改上游(9 个文件,均加 FORK marker)

- `packages/app/src/hooks/use-providers.ts`(+25 行):popularProviders 加 getbot;`withGetbot` 注入合成项
- `packages/app/src/components/dialog-select-provider.tsx`(+8 行):sortBy override + note + 推荐 Tag
- `packages/app/src/components/dialog-connect-provider.tsx`(+130 行):介绍区 Match + submitting 状态 + handleGetbotSubmit(401/403/超时/其他错误分流)+ 保存时清 disabled_providers
- `packages/app/src/components/dialog-select-model-unpaid.tsx`(+9 行):加 getbot Show(tagline + 推荐 Tag)
- `packages/app/src/components/settings-providers.tsx`(+13 行):PROVIDER_NOTES + popular sort override + 推荐 Tag
- `packages/app/src/i18n/en.ts`(+14 行):7 个新 key
- `packages/app/src/i18n/zh.ts`(+11 行):中文(tagline 含"国内直连")
- `packages/app/src/i18n/zht.ts`(+11 行):繁中
- `packages/ui/src/components/provider-icons/sprite.svg`(+10 行):getbot symbol(viewBox 24x24,currentColor)
- `packages/ui/src/components/provider-icons/types.ts`(+1 行):iconNames 加 `"getbot"`

### 新文件 docs

- `docs/features/getbot-接入/{1-spec,2-plan,3-changelog}.md`(本目录,~600 行)

### 删除

- `docs/provider-model-system.md`(已迁移到 `docs/features/getbot-接入/1-spec.md`)

## 行数

- 修改上游:~232 行
- 新文件 fork-only:120(getbot.ts)+ ~600(docs)= 720 行
- 总 staged:~952 行(超 500 阈值,走 `[large-diff: GetBot 接入横切性,utils+code+i18n+sprite+docs 紧耦合]`)

## override 论证

`packages/ui/src/components/provider-icons/{sprite.svg,types.ts}` **从规范 v2 起已出黑名单**(理由见 `docs/features/规范-v2/1-spec.md`),本笔不再需要 `[override-blacklist]` tag。

## 影响范围

- ✅ Provider 列表场景(选择提供商弹窗 / 设置→提供商热门 / 未付费模型选择弹窗加更多):GetBot 强制第一 + tagline + 推荐 Tag
- ✅ Model 列表场景(选择模型弹窗 / 管理模型 / 设置→模型):popularProviders 自然顺序,GetBot 第二
- ✅ 连接 GetBot:401/403 内联红字、超时内联红字、其他错误 toast 兜底,保存时清 disabled_providers
- ✅ 上游其他 provider(anthropic/openai/...)行为不变
- ⚠️ 已知遗留(非本笔引入):上游 connect/disconnect 后 UI 需重启才刷新

## 回归测试点

(release `DeskFox.exe` 已产出 user 验过 — 14:28)

- R1: 设置→提供商热门:GetBot 第一 + tagline + 推荐 Tag ✅
- R2: 选择提供商弹窗:GetBot 第一 + tagline + 推荐 Tag ✅
- R3: 选择模型/管理模型/设置-模型:OpenCode Zen → GetBot → OpenCode Go 顺序 ✅
- R4: 连接 GetBot 错误 key → 内联红字"API 密钥验证不通过" ✅
- R5: 连接 GetBot 正确 key → ~3 秒后成功 toast,27+ chat 模型可见 ✅
- R6: 之前断开过 GetBot → 重连自动清 disabled_providers ✅

## review 自检

- [x] 触动 fork 白名单 + 注册型扩展点豁免(规范 v2)
- [x] git diff --stat 在预算内(~952 行,走 [large-diff])
- [x] 大小写检查通过
- [x] 新增依赖:无
- [x] 无"顺手改"未记录
- [x] FORK marker 全加(11 处)
- [x] DeskFox build wrapper 验证通过

## 已知遗留

- 上游 connect/disconnect 后 UI 不刷新(必须重启)— 上游 bug,非本笔引入,跟官方 OpenCode Desktop 同症
- popularProviders 数组顺序约定:Provider 列表场景 getbot 强制第一,Model 列表场景按数组自然顺序(getbot 第二)— 通过 sortBy override 实现,在 3 处独立加,未提到公共 hook(future:可考虑封装成 `popularProvidersForProviderList` / `popularProvidersForModelList` 两个 derived hook,降低未来一致性维护成本)

## 回退方法

```
git revert <本笔 hash>
```
