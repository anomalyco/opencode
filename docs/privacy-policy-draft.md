# DeskFox Privacy Policy / 隐私政策(草稿)

> **状态**:DRAFT V0.1 — 2026-04-29
> **待办**:法务/合规审阅 → 由维护者发布到 https://deskfox.ai/privacy
> **生效条件**:发布到上述 URL 且 README 已链接至此政策

---

## 中文版本

### 1. 我们是谁

DeskFox(以下简称"我们")是一款开源 AI 辅助开发工具的桌面应用。本政策说明在你使用 DeskFox **桌面应用**时,我们如何收集、使用、保留和保护数据。

### 2. 我们收集什么

为了改进产品,**默认开启**匿名使用统计。仅收集以下字段,**不与任何身份关联**:

| 字段 | 用途 |
|---|---|
| 应用版本 (`version`) | 了解版本分布,推送升级 |
| 操作系统 (`os`) 与 CPU 架构 (`arch`) | 优先级排序、问题排查 |
| 国家(由 IP 即时推断后**立即丢弃 IP**) | 大致地理分布 |
| 安装 ID (`install_id`) | 一台机器一个的随机 UUID,**不与邮箱/账号/IP 关联** |
| 启动事件 (`pageview`) | 估算日活/月活 |
| 5 个核心动作计数(`desktop.app_open` / `desktop.project_open` / `desktop.ai_request` / `desktop.update_downloaded` / `desktop.update_applied`) | 判断哪些功能有用 |

### 3. 我们绝不收集

- ❌ 你的代码内容(文件、片段、提示词)
- ❌ AI 模型对话内容 / prompt
- ❌ 你的邮箱、姓名、IP 地址(IP 仅瞬时用于地理推断,不入库)
- ❌ 文件路径、项目名、仓库地址
- ❌ 浏览历史、cookie、设备指纹
- ❌ 任何可追溯到具体个人的标识符

### 4. 数据保留与销毁

- 保留期上限:**24 个月**
- 超过 24 个月的事件按月分区自动删除
- 你可以随时联系我们删除某个 `install_id` 对应的全部数据

### 5. 数据存储与跨境

- 数据存储于 **AWS Tokyo(日本)**机房,由我们自托管的 [Plausible Analytics](https://plausible.io/) 处理
- **不向第三方共享数据**,不卖数据,不接入任何广告网络
- 服务器维护团队成员可访问聚合后台

### 6. 你的权利

- **关闭统计**:任意一个生效即关闭(三选一,作用相同)
  1. 在应用「设置 → 使用统计」关闭
  2. 设置环境变量 `OPENCODE_TELEMETRY=0`
  3. 编辑 `~/.config/opencode/config.json` 加入 `"telemetry": false`
- **查看数据**:通过下方邮箱申请,我们会以 JSON 形式提供
- **删除数据**:通过下方邮箱提供你的 `install_id`,我们 30 天内删除

### 7. 升级检查的独立开关

升级检查(检查是否有新版本)默认开启,**即使你关闭了统计仍然生效**(我们认为升级提醒符合你的利益)。如不需要升级提醒,使用 `OPENCODE_UPDATE_CHECK=0`。

升级检查只发出一个 HTTP GET 请求,**不携带任何个人数据**,服务端日志只见 IP(自动 30 天清理)。

### 8. 联系方式

- 邮箱:**privacy@deskfox.ai**(待维护者确认)
- GitHub:在项目仓库提 Issue
- 修订历史:见本文件 git 提交记录

### 9. 政策变更

如重大变更(收集字段调整、保留期延长等),我们会:
1. 在应用启动时再次显示告知卡片
2. 在 GitHub Release 公告中说明
3. 更新本页"最近更新日期"

---

## English Version

### 1. Who We Are

DeskFox is the desktop client of an open-source AI-assisted development tool. This policy describes how we collect, use, retain, and protect data when you use the **DeskFox desktop application**.

### 2. What We Collect

To improve the product, anonymous usage statistics are **enabled by default**. We collect only the fields below, **not linked to any identity**:

| Field | Purpose |
|---|---|
| App version | Version distribution, upgrade prompts |
| OS / CPU architecture | Prioritization & debugging |
| Country (inferred from IP, **IP discarded immediately**) | Rough geographic distribution |
| Install ID | Random UUID per machine, **not linked to email/account/IP** |
| Launch event (`pageview`) | DAU/MAU estimation |
| 5 core action counts (`desktop.app_open` / `project_open` / `ai_request` / `update_downloaded` / `update_applied`) | Which features matter |

### 3. What We Never Collect

- ❌ Your code content (files, snippets, prompts)
- ❌ AI conversations / prompt text
- ❌ Email, name, IP address (IP is used transiently for geo lookup, never stored)
- ❌ File paths, project names, repository URLs
- ❌ Browsing history, cookies, device fingerprints
- ❌ Any identifier traceable to an individual

### 4. Retention & Deletion

- Maximum retention: **24 months**
- Events older than 24 months are automatically deleted by monthly partition
- You may request deletion of all data tied to an `install_id` at any time

### 5. Storage & Cross-Border Transfer

- Data is stored on **AWS Tokyo (Japan)**, processed by our self-hosted [Plausible Analytics](https://plausible.io/)
- **Not shared with any third party**, not sold, no ad networks
- Maintainer-team members can access the aggregated dashboard

### 6. Your Rights

- **Opt out** (any one of these works):
  1. App: Settings → Usage Statistics → Off
  2. Env var: `OPENCODE_TELEMETRY=0`
  3. Config: edit `~/.config/opencode/config.json`, set `"telemetry": false`
- **Access**: request via the email below, we provide a JSON export
- **Delete**: send your `install_id` to the email below; we delete within 30 days

### 7. Independent Update-Check Switch

The update check (checking for a newer version) is **enabled by default and survives the telemetry opt-out**, because we believe upgrade notifications serve your interest. To disable it too, set `OPENCODE_UPDATE_CHECK=0`.

The update check is a single HTTP GET, **no personal data attached**; server-side access logs are auto-purged after 30 days.

### 8. Contact

- Email: **privacy@deskfox.ai** (pending maintainer confirmation)
- GitHub: open an issue in the project repository
- Revision history: see the git commit log of this file

### 9. Policy Changes

For material changes (new fields, longer retention, etc.) we will:
1. Re-show the disclosure card on next app launch
2. Announce in the GitHub Release notes
3. Update the "Last updated" date on this page

---

## Maintainer notes (NOT to publish)

- 中英双语都需要法务审阅,尤其 §5(数据存储位置)与 §6(用户权利)涉及 GDPR 合规话术
- `privacy@deskfox.ai` 邮箱是否已申请?如未,可临时用维护者个人邮箱
- 静态页面建议放在 `https://deskfox.ai/privacy`,Markdown→HTML 即可
- 一旦发布,把 `packages/telemetry/src/notice.ts` 的 NOTICE_TEXT 中链接 `https://deskfox.ai/privacy` 验证可访问
- 政策更新时记得增加版本号(本草稿是 V0.1)
