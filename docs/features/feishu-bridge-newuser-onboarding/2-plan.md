---
feat-id: feishu-bridge-newuser-onboarding
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-bridge-newuser-onboarding — plan

## 顺序

按严重度 + 依赖链:**A1 → A4 → A3**(单一 feat 分支三笔 commit + docs 落盘)。

A1 是其他人(包括 A3 引导失效时)的兜底,先做。
A4 独立。
A3 不影响代码 path,放最后。

## 决策轨迹

### A1 idempotent 失效检测策略

**初版方案**:子串匹配 `plugin/feishu-bridge` 跳过 — bug:user 移动 .app 后旧路径失效但子串仍匹配,跳过保留废 entry。

**修法选项**:
1. ❌ 全清空再插入 — 破坏 dev 手动配的开发版路径
2. ❌ 强制覆盖第一个含子串的 entry — 同上
3. ✅ **遍历所有含子串项 → 各自检测路径是否存在 → 失效移除有效保留**

选 3。dev 自己手动配开发版路径**不会**含 `plugin/feishu-bridge` 子串(开发版直接指 `adapter-feishu-lark/src/plugin.ts`),所以子串匹配就是"本 feat ship-packaging 注入的项"的精确指纹。

### A4 默认 model 检测 — 前端 vs 后端

**两端都做,各管一段**:
- 前端预防(A4.A):user 进 Settings → 飞书桥接 tab 时**立刻**看到 warning,**绑账号前**就知道要先配 model。reuse 现有 `feishuListProviders` API,0 新 endpoint。
- 后端兜底(A4.B):前端 warning 即使 user 不看 / 不操作,后端**消息进来时**也要给 friendly 回复,不让飞书那头静默。

不在 plugin sync 时一次性检测 + 缓存 — 因为 user 可能**在 plugin 跑期间**才去 Settings 配 model,缓存会 stale。每条消息进来 catch 错误时 friendlyErrorReply 关键字识别 — 正常 path 0 overhead,异常 path 才走识别。

### A4 错误识别用关键字 vs 主动检测

考虑过收消息时主动调 `client.config.providers()` 检测 default — 否决:每条消息多一次 API 调用,且检测只能识别 "未配"不能识别"配了但 key 无效"。

最终用**关键字识别**(opencode 源码核实):
- `no providers found` / `no models found` — `provider.ts:1706/1708`
- `Invalid model ${x}. Model must be ...` — `cli/cmd/github.ts:722`
- `API key` / `api_key` / `401` — provider SDK 401 时常含

非典型错误保留原 message 不误伤(network timeout 之类)。

### A3 dmg 引导图生成方式

**选项**:
1. ❌ ImageMagick / PIL — 本机没装
2. ❌ SVG → 让 user 手转 — 不及时
3. ✅ **Swift + CoreGraphics 脚本** — macOS 原生,可复跑,文本渲染好

Swift 脚本入仓 + 生成的 PNG 也入仓(23KB,branding/icons 历史已有 PNG 入仓先例)。脚本可复跑让未来美术升级简单。

### A3 dmg layout 选项

Tauri 默认值已经合理(.app 在 180,170 / Applications 在 480,170 / 窗口 660x400)。**仍显式写出**到 tauri.conf.json,让未来调整不需要查 Tauri 默认值;同时 background 图坐标对齐这套 default,移植到其他 layout 时一并改。

## 关联

- 起源:`feishu-bridge-ship-packaging` 主 commit + Win 路径 follow-up 推完后,从 fresh user 视角审查发现的 5 个潜在阻塞。
- A1 修的是 ship-packaging 已记的"已知 trade-off #1"(idempotent 不修 stale)。
- A4 的前端 warning 跟现有 `adapter.notReady` 卡片样式对齐,降低代码入侵。
- A3 不依赖 A1 但二者**协同**:A3 降低 user 误操作 → 减少 A1 兜底次数。
