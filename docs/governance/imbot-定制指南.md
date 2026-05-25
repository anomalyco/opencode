# imbot 定制指南

> **target audience**:DeskFox 用户(尤其是想增强 IM 桥接 bot 能力的 power user)
> **配套架构文档**:[`/Volumes/ExtSSD/OPENCODE-PLAN/架构决策/im桥接-imbot单一架构.md`](file:///Volumes/ExtSSD/OPENCODE-PLAN/架构决策/im桥接-imbot单一架构.md)
> **最后更新**:2026-05-25

## 一、imbot 是什么

DeskFox 的 IM 桥接(飞书 / 未来 telegram / 钉钉)用一个叫 **`imbot`** 的 opencode agent 来响应用户消息。

`imbot` 是个 **安全 agent** — DeskFox 安装时自动注入到 user 的 opencode 配置(`~/.config/opencode/opencode.jsonc`),默认权限收紧:
- `bash` / `edit` / `write` / `apply_patch` / `webfetch` **默认 ask**(每次使用需 user 在飞书 CardKit 弹卡片同意)
- 敏感目录(SSH / AWS / Kube / GPG / Keychain)**默认 read 也 ask**

这是 IM 桥接的安全防线 —— 防止 user 通过 IM 让 bot 在背后悄悄读 / 改文件不知情。

## 二、为什么要定制 imbot

默认的全局 `imbot` 是个通用助手,**对你的具体使用场景不知情**。比如:
- 你的项目目录在哪里?
- 你有几个项目?分别是什么主题?
- 你想让 imbot 用什么语气?
- 你有哪些常用的工作流?

这些都是 **user 自己最清楚** 的事。

DeskFox 的设计**不强行**通过 GUI 收集这些信息 —— 因为这种"按账号 / 按对话填配置项"的模式既笨重又有边界(参考 [架构决策文档](file:///Volumes/ExtSSD/OPENCODE-PLAN/架构决策/im桥接-imbot单一架构.md))。

**取而代之**:你编辑一个文件,把上述信息**用自然语言**告诉 imbot,opencode 自动加载,imbot 就懂了。

## 三、imbot.md 文件在哪里

```
~/.opencode/imbot-workspace/.opencode/agent/imbot.md
```

绝对路径:`$HOME/.opencode/imbot-workspace/.opencode/agent/imbot.md`

- macOS / Linux:`/Users/<你>/.opencode/imbot-workspace/.opencode/agent/imbot.md`
- Windows:`C:\Users\<你>\.opencode\imbot-workspace\.opencode\agent\imbot.md`

> 💡 **为什么是这个路径**:`~/.opencode/imbot-workspace` 是飞书桥接固定的 home base(所有 IM 共享 cwd 不变);`.opencode/agent/<name>.md` 是 opencode 原生支持的**项目级 agent 定义**位置,**会覆盖全局 imbot.md**。

## 四、怎么定制

### 4.1 文件不存在时怎么办

刚装 DeskFox 时这个文件**不存在**。你需要手动创建:

```bash
# macOS / Linux
mkdir -p ~/.opencode/imbot-workspace/.opencode/agent
nano ~/.opencode/imbot-workspace/.opencode/agent/imbot.md  # 或用任何编辑器

# Windows PowerShell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.opencode\imbot-workspace\.opencode\agent"
notepad "$env:USERPROFILE\.opencode\imbot-workspace\.opencode\agent\imbot.md"
```

### 4.2 文件格式

agent.md 文件由两部分组成:

```markdown
---
# (可选)frontmatter,YAML 格式
# 不写 frontmatter 时,继承全局 imbot 的权限设置(推荐)
description: 我的个人飞书桥接助手
---

# (主体)自由格式的 markdown / 自然语言 prompt
你是我的助手,叫做小狐狸 ...
```

**关键约束**:**不要**在 frontmatter 里覆盖 `permission` 字段。如果你写了 `permission: { bash: allow }` 等,**会绕过 DeskFox 的安全收紧**,这是高风险操作。

### 4.3 单项目模板(最常见)

```markdown
你是我的飞书桥接助手。

## 我的工作环境
我用 macOS / Windows,工作目录默认是 `~/.opencode/imbot-workspace`。
所有文件操作默认在这里。

## 我的偏好
- 中文回复
- 简洁,不要废话
- 写代码前先告诉我思路,我同意后再写
```

### 4.4 多项目模板(power user 场景)

```markdown
你是我的飞书桥接助手,知道我有以下项目:

| 主题 | 目录 | 说明 |
|---|---|---|
| 健康管理 | `~/health` | 饮食 / 运动 / 体检数据 |
| Web 项目 | `~/projects/web` | React + Next.js |
| API 项目 | `~/projects/api` | Go + Postgres |
| 子女教育 | `~/child` | 作业 / 学习计划 |

## 工作流
- 根据我的消息内容判断该读 / 写哪个项目目录
- 读写跨目录文件**用绝对路径**(file tool 接受 `~/...` 或 `/Users/...`)
- 每次跨目录访问前简要告诉我你要读 / 写哪个文件
- 不确定我说的是哪个项目时,主动问

## 我的偏好
- 默认中文回复
- 技术细节用代码块格式
- 提到金额带 ¥ 符号
```

### 4.5 多 persona 模板(进阶)

```markdown
你是我的飞书桥接助手。根据消息内容切换 persona:

## Persona 1: 工作 mode
触发条件:消息含"项目 / 代码 / API / 部署 / 测试"
表现:
- 严肃 / 简洁 / 技术化
- 读写 `~/projects/...`
- 不闲聊

## Persona 2: 生活 mode
触发条件:消息含"血压 / 体检 / 饮食 / 运动 / 心情"
表现:
- 温暖 / 关怀
- 读写 `~/health`
- 适度提醒

## Persona 3: 教育 mode
触发条件:消息含"作业 / 学习 / 孩子 / 阅读"
表现:
- 耐心 / 鼓励
- 读写 `~/child`
- 避免说教
```

### 4.6 跨 IM 共享(未来场景)

当 DeskFox 加 telegram / 钉钉 plugin 后,**imbot.md 是所有 IM 共享**的(home base 同一个)。你可以在 prompt 里加 IM 区分:

```markdown
你是我的助手,跨多个 IM 服务我:
- **飞书**:工作 + 协作场景,语气严肃
- **telegram**:私人 + 灵感,语气放松

opencode session 里你可以从消息上下文判断当前是哪个 IM。
```

## 五、跟全局 imbot 的关系

```
~/.config/opencode/agent/imbot.md      ← 全局,DeskFox setup hook 注入(权限收紧基线)
~/.opencode/imbot-workspace/.opencode/agent/imbot.md  ← 项目级,你自己定制(本指南教的)
```

opencode 加载 agent 时的**优先级**:**项目级 > 全局级**(merged,项目级覆盖同名字段)。

**含义**:
- 你写的 prompt 内容**完全覆盖**全局的默认 prompt
- 但如果你不在 frontmatter 里覆盖 permission,**权限收紧从全局继承**(安全)
- 如果你**显式**覆盖 permission,优先级也是项目级胜 → ⚠️ 慎用

**推荐做法**:不写 frontmatter,只写主体 markdown prompt。这样**安全防线保留,定制能力到位**。

## 六、权限 ask 工作机制

imbot 默认对敏感操作 ask。在飞书桥接场景下,ask 的呈现方式是 **飞书 CardKit 卡片**:

1. user 飞书发"读 `~/projects/foo/README.md`"
2. imbot 决定调 `Read` tool,full path
3. **路径越出 home base** → imbot 触发 `Read` 权限 ask(因为全局 imbot 配了 read for 项目目录 也是 ask)
4. DeskFox plugin 发飞书 CardKit:"imbot 想读 ~/projects/foo/README.md,允许吗?"
5. user 点【✅ 允许 】/ 【❌ 拒绝 】
6. imbot 继续 / 中止

> 💡 这是 IM 桥接的**核心安全保障**。哪怕 imbot.md 里写 "你读什么文件都不用问我",**全局 imbot 权限收紧依然生效**(只要你不显式覆盖 permission)。

## 七、调试 / 常见问题

### Q1:我编辑了 imbot.md,但飞书 bot 行为没变

opencode session 启动时加载 agent.md。**已有的 session 不会热更新**。

解决:user 在飞书私聊发 `/new` 清当前 session,下条消息会用新 prompt 重启 session 加载新版 imbot.md。

### Q2:加载新 imbot.md 后 imbot 跑得不像我期望的

可能原因:
- prompt 太长,LLM 注意力分散 → 精简,只放最关键的规则
- prompt 跟全局 imbot 的内置约束冲突(罕见,跟 setup hook 一致性问题)→ 看 DeskFox 日志(`~/Library/Logs/ai.deskfox.app/...`)有无 conflict warning
- LLM model 不够强 → 切到更强的 model(Settings → Models)

### Q3:我想看完整生效的 imbot prompt 是什么样

opencode 在 session 启动时把 agent.md 内容 + 系统 prompt 合并发给 LLM。完整 prompt 可以从 DeskFox 日志或 opencode 调试 endpoint 取。

具体方法:看 `~/Library/Logs/ai.deskfox.app/opencode-desktop_*.log`,搜 `agent: imbot` 附近上下文。

### Q4:不同 user 用同一台 DeskFox(罕见)

每个 user 的 `~/` 不同 → 各自 imbot.md 独立。无冲突。

### Q5:我想完全禁用 imbot 的权限 ask(我对自己机器有信心)

**❌ 不推荐**。但如果坚持,在 imbot.md frontmatter 里写:

```yaml
---
permission:
  bash: allow
  edit: allow
  write: allow
---
```

⚠️ **风险自负**:这等于让飞书 IM 端的任何人(被你飞书 bot 服务的人)都能让 bot 在你的电脑上执行任意 bash / edit / write,**包括恶意 prompt injection 场景**。

### Q6:可不可以用相对路径让 imbot 跨 workspace?

不行。**session.cwd 永远是 home base(~/.opencode/imbot-workspace)**。跨目录访问必须用绝对路径(`~/projects/foo/file.md` 或 `/Users/me/projects/foo/file.md`)。

### Q7:我想完全换一个 agent,不用 imbot 怎么办

**默认路径**(推荐 99% user):**不要换**。imbot 是 DeskFox 为飞书桥接设计的安全 agent,把 bash/edit/write 等收紧为 ask。换其他 agent 会绕过这层防线。

**Opt-out 路径**(研发能力 user 自担风险):编辑 `~/.opencode/feishu-config.json`,把对应账号的 `agent` 字段从 `"imbot"` 改成其他 agent 名(如 `"build"`)。这是开源软件"默认安全 + 显式 opt-out"范式,DeskFox 故意不在 GUI 暴露这个选项 — 但 config 编辑能力对研发 user 开放。

```jsonc
{
  "accounts": {
    "cli_xxx": {
      // ...其他字段...
      "agent": "build",   // ← 从 imbot 改成其他 agent,自担风险
    }
  }
}
```

⚠️ **改完后下条消息 imbot 的安全收紧不再生效**,bash/edit/write 等可能不弹权限卡片直接执行。**只在你 100% 信任飞书 IM 端 user 不会发恶意 prompt 时才开**(典型场景:本机自己跟自己的 bot 聊;或团队内部高信任群)。

详 [架构决策 ADR §1.1](file:///Volumes/ExtSSD/OPENCODE-PLAN/架构决策/im桥接-imbot单一架构.md)。

## 八、最佳实践

1. **prompt 短而具体**:50-200 行最佳,LLM 注意力有限,堆砌噪音降效果
2. **用结构化 markdown**:headers + tables + lists 比纯叙述更好,LLM 更容易索引
3. **明确触发条件**:不要 "看情况而定" 这种模糊词,给 LLM 可执行的判断规则
4. **不要尝试在 prompt 里禁用权限**:不安全,且 ask 流程是 user-friendly 不是负担
5. **git 管理你的 imbot.md**:这是你的"AI 助手 DNA",值得版本控制
6. **跟同事 / 朋友分享**:`imbot.md` 是个文件,分享你的写法帮别人 setup 飞书桥接

## 九、关联文档

- **架构决策**(为什么不通过 GUI 配置而通过文件):[`/Volumes/ExtSSD/OPENCODE-PLAN/架构决策/im桥接-imbot单一架构.md`](file:///Volumes/ExtSSD/OPENCODE-PLAN/架构决策/im桥接-imbot单一架构.md)
- **imbot 安全 agent 注入机制**(全局 setup hook):memory `reference_imbot_agent.md`
- **opencode agent 系统总览**:upstream [opencode docs](https://docs.opencode.com/agent)(英文)
- **被本架构取代的 GUI 配置方案**:[`OPENCODE-PLAN/需求池/im账号-agent-workspace-绑定.md`](file:///Volumes/ExtSSD/OPENCODE-PLAN/需求池/im账号-agent-workspace-绑定.md)(superseded)
