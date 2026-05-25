---
feat-id: feishu-group-new-cmd-and-mention-rename
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-group-new-cmd-and-mention-rename — 1-spec(需求 + 验收)

## 背景

两个关联小改动合一个 feat:

### 改动 1:`/new` 命令群里启用条件

当前(`feishu-bridge-light`)`/new` **仅 p2p**,群里发 reply "/new 仅支持私聊(群里清会影响全员)"。

但 `feishu-group-mention-policy`(2026-05-24)引入了 `requireMention=false` 模式 — user 主动选择"1 群 1 项目独占用法"(bot 群里响应所有消息,channel-as-workspace)。这种场景下 `/new` 在群里**应该可用** — 整个群就是一个共享对话上下文,清 session 就是清这个共享上下文,跟 user 主动选择的 channel-as-workspace 模式契合。

行业调研支持(2026-05-25):
- **Slack / Teams**:无 `/new`,靠 thread 边界自然切分,不适用我们场景
- **Discord per-channel LLM bot**:`/reset` / `/clear` 标配 slash command,普遍提供;**部分 OSS 加 admin 门控** + confirmation card
- 我们的场景跟 Discord per-channel 模式 1:1 对应

**取舍**(方案 C):不加 admin 门控 / 不加 confirmation card,任意群成员可触发,只加"影响所有成员"提示。理由:user 主动开 `requireMention=false` 已经表达"这个群就是共享对话上下文"的 intent,场景信任度高(1 群 1 项目独占用法 = 群成员都是协作者),误清成本可接受。门控功能 ROI 低(飞书 bot 视角拿群主 role 复杂),先不上。

### 改动 2:GUI checkbox 语义反转 + 默认改关

当前 GUI(`feishu-group-mention-policy`):
- Label:**群里需要 @ 后再响应**
- 默认:**勾上**(对应 `requireMention=true`)

User 反馈(2026-05-25):"高级能力应该默认关闭"。两项默认值应该一致 — 第一项「允许 AI 自动创建新群」默认不勾,但第二项默认勾上,**视觉上不一致**。

修法:**GUI 层反转**(checkbox 显示语义反转,后端字段不动)。

- 新 Label:**允许 AI 免@ 读取群里所有信息**
- 新默认:**不勾**(对应 `requireMention=true`,即默认行为不变,bot 仍然只回 @ 自己的消息)
- 双向绑定:`checkbox.checked = !account.requireMention`,save 时 `requireMention = !checkbox.checked`

**后端 `requireMention` 字段不动**:0 兼容性风险 / 配置 schema 不变 / 飞书 server 端订阅模式契约不变 / 测试逻辑不变,只反 UI 一层。

## 用户视角(交付物)

### 场景 1:默认行为 — 老用户无感

- 老用户已有的 `requireMention=true`(老 GUI 勾上)→ 新 GUI 上"允许 AI 免@ 读取群里所有信息" 不勾 → 实际行为不变(bot 仍只回 @)
- 群里发 `/new` → reply 拒绝 + 引导文案"群里使用 /new 需先开启「允许 AI 免@ 读取群里所有信息」"

### 场景 2:user 主动开启免@ 模式

- user 在飞书后台改订阅模式为「全部群消息」+ DeskFox GUI 勾上"允许 AI 免@ 读取群里所有信息"(`requireMention=false`)
- bot 响应群里所有消息
- 群任一成员发 `/new` → 清当前群 session + reply "✅ 已开启新对话(群 session 已清,影响所有成员)"

### 场景 3:私聊行为 — 完全不变

- p2p `/new` → 永远允许(跟 requireMention 无关)

## 验收标准

### 功能

1. ✅ **GUI checkbox 反转**(`feishu-edit-account-dialog.tsx`):
   - Label:`"允许 AI 免@ 读取群里所有信息"` 替换 `"群里需要 @ 后再响应"`
   - 默认值:`!props.currentRequireMention ?? false`(老用户 requireMention=true → 不勾,新用户默认不勾)
   - `onChange`:`setRequireMention(!e.currentTarget.checked)`
   - save 调用:`requireMention: requireMention()` 不变(state 仍存后端字段语义)

2. ✅ **Hint 文案改写**(checkbox 下方说明):
   ```
   默认关闭:bot 群里只回 @ 自己的消息。
   开启后:① bot 响应群里所有消息(适合 1 群 1 项目独占用法);
        ② 群任一成员可发 /new 在当前群开新对话(清 session,影响所有人)。
   ⚠️ 开启前需在飞书后台改:open.feishu.cn → 选 bot → 事件配置
      `im.message.receive_v1` 订阅范围改「全部群消息」+
      权限管理申请 `im:message` + 重新发布。
   否则飞书不推非 @ 消息,本开关无效。
   ```

3. ✅ **i18n key 改名**(zh / zht / en 三份):
   - `settings.feishu.edit.requireMention.label` → `settings.feishu.edit.allowReadAll.label`
   - `settings.feishu.edit.requireMention.hint` → `settings.feishu.edit.allowReadAll.hint`
   - GUI 引用同步改

4. ✅ **/new 在群里启用条件**(`message-pipeline.ts handle()`):
   - p2p:无条件允许(行为不变)
   - group + `requireMention=true`:拒绝 + 引导文案
   - group + `requireMention=false`:**允许**,reply "✅ 已开启新对话(群 session 已清,影响所有成员)"

### 数据 / 不回归

5. ✅ 后端 `requireMention` 字段语义不变(true = 需要 @,false = 不需要),`config-schema.ts` / `account-store.ts` 全链路不动
6. ✅ 默认值不变 `z.boolean().default(true)`(后端默认 bot 只回 @,UI 反转不影响默认行为)
7. ✅ 现有 `/group` / `/new`(p2p)/ `requireMention` 在 group 的判断(`isBotMentioned`)行为全不变
8. ✅ `account-store.test.ts` 默认值测试(`requireMention: true`)继续通过

### 安全

9. ✅ `/new` 群里**任意成员**可触发(方案 C,无 admin 门控)— 跟 user 主动选择 `requireMention=false` 的 intent 一致
10. ✅ 群里清 session reply 含"影响所有成员"提示 — 防误清
11. ✅ 文案改写不暴露任何凭证 / 内部 path

### 测试 / 治理

12. ✅ R5 Medium ≥ 3 unit + 1 集成:
    - `message-pipeline.test.ts` 新加 `/new` 群里 case ≥ 3(group + requireMention=true 拒绝 / group + false 允许 + 文案 / p2p 行为不变)
13. ✅ `bun run typecheck` 16/16
14. ✅ 三文档全套 + INDEX + 改动日志 entry

## 非目标(Out of scope)

- ❌ admin 门控 / bot owner 限制(方案 A 行业最佳但 ROI 低,留 backlog)
- ❌ confirmation card 二次确认(方案 B,留 backlog)
- ❌ 后端 `requireMention` 字段改名 `allowReadAll`(后端契约稳定优先)
- ❌ migration 老配置(后端不动,无需 migration)
- ❌ 默认值改 `requireMention: z.boolean().default(false)`(默认行为应该保守,user 主动 opt-in 才走免@ 模式)

## 安全 / 边界

- **方案 C 信任假设**:user 主动开 `requireMention=false` = 主动选择 channel-as-workspace 模式 = 隐含信任群成员(协作场景)。误清成本 user 主动接受
- **后端字段不反**:UI 反转看起来是"反向"的,user 看 GUI 切换跟 v1(GUI mention checkbox 勾上 = requireMention=true)对比,**默认行为完全一致**(都是 bot 只回 @)— 老用户 0 行为变化
- **i18n key 重命名是 breaking 但低风险**:i18n 用旧 key 会 fallback 到 key 字面值(SolidJS i18n 行为),不会崩;new bundle 同步换 key + 调用,无 stale

## 决策轨迹

- **方案 A/B/C 三选**(2026-05-25):
  - A:admin 门控 + confirmation card(行业最佳)
  - B:仅 confirmation card(中庸,~30 行)
  - C(选):无门控,纯文案提示(~5 行)
- **行业调研支持方案 C**:Discord per-channel bot 普遍提供 /new 但部分加门控;我们场景下信任度高,无门控可接受
- **后端字段不反**:稳定性优先,UI 层反转成本极小
- **i18n key 改名**:跟 UI 文案语义对齐,key 反映 user 看到的意思

## 关联

- 上游:
  - `feishu-bridge-light`(2026-05-23) — `/new` 引入,p2p only
  - `feishu-group-mention-policy`(2026-05-24) — `requireMention` 字段 + GUI checkbox + i18n
  - `feishu-group-slash-command`(2026-05-24) — `/group` 引入,验证 slash command 在 plugin 模式可行
- 触动文件:
  - `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts`(handle() `/new` 分支)
  - `packages/app/src/components/feishu-edit-account-dialog.tsx`(GUI checkbox 反转)
  - `packages/app/src/i18n/{zh,zht,en}.ts`(i18n key 改名 + 文案)
  - 测试:`packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts`
- 不动:
  - 后端 `requireMention` 字段 / schema / store / server endpoint(改 1 个 UI checkbox 不动 backend)
  - `isBotMentioned` 逻辑 / `requireMention` 在群里的 enforcement 早退
