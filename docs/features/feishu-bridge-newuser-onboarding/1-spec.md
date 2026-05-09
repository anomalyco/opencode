---
feat-id: feishu-bridge-newuser-onboarding
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-bridge-newuser-onboarding — spec

## 一句话

让全新用户拿到 .dmg → 双击装 → 点 Settings → 飞书桥接 → 扫码,这条 happy path 没坑。

## 起源

`feishu-bridge-ship-packaging` 推完之后,从全新用户视角(下载 .dmg → 双击 → 拖 Applications → 装完即用)做了一轮全链路审查,发现 5 个潜在阻塞,按严重度分:

| # | 风险 | 严重度 |
|---|---|---|
| **A1** | user 在 .dmg 挂载点双击 .app(没拖 Applications)→ inject 写 `/Volumes/...` 路径 → 卸载挂载点后路径失效 → 拖 Applications 后启动,idempotent 因子串匹配跳过保留废 entry → plugin 加载失败 | 必修(硬阻塞) |
| **A4** | user 没在 Settings → Models 配 default provider key → 绑了飞书 → 消息进来调 LLM 失败 → 静默(飞书那头看不到回复) | 必修(硬阻塞) |
| **A2** | macOS Gatekeeper 拦"未知开发者",user 不会处理就放弃 | 中(可后续) |
| **A3** | .dmg 没"拖到 Applications"背景图,user 直接挂载点双击 → 触发 A1 | 中 |
| **A5** | user 关主窗口后飞书消息进来,tray 没通知 / badge | 低(后续) |

## 范围

本笔做 **A1 + A4 + A3**。A2 / A5 留下批。

### A1:plugin inject 路径失效自愈

`feishu_plugin_install::inject_plugin` idempotent 升级:遍历 plugin 数组里含 `plugin/feishu-bridge` 子串的项,**检测路径是否仍存在**:
- 存在 → 保留(若就是当前 plugin_url,跳过 push 真 idempotent)
- 不存在 → 移除 + log

清理后,如果当前 plugin_url 还没存在于 array 中 → 注入。

### A4:default model 缺失检测 + 友好降级回复

**A4.A 前端预防**(settings-feishu.tsx):onMount 调 `feishuListProviders` 检测 `default.build` 是否存在,没配渲染显眼 warning 卡片(沿用 adapter notReady 同款样式),引导 user 去 `Settings → Providers` 加 API key。

**A4.B 后端兜底**(message-pipeline.ts):抽 `friendlyErrorReply` helper(可单测),关键字识别 opencode 已知错误(`no providers found` / `no models found` / `Invalid model` / `API key` / `401`)→ 翻译成中文可操作指引,附原始错误供 debug。其他错误保留原样不误伤。

### A3:.dmg 拖拽引导

显式配 `bundle.macOS.dmg.{background, windowSize, appPosition, applicationFolderPosition}`,加一张 660x400 引导背景图(Swift CoreGraphics 脚本生成,可复跑):
- 顶部:中文/英文双语 "将 DeskFox 拖到 Applications 即可安装"
- 中部:从 .app icon (180,170) 指向 Applications (480,170) 的箭头
- 底部:Gatekeeper 首启提示(右键 → 打开)

## 验收标准

- A1: 5 个 unit test 全过(first inject / idempotent no-op / stale 替换 / 无关 entry 保留 / path_still_valid file:// 前缀)
- A4: 7 个 unit test 全过(4 类识别 + 2 类不误伤 + 空 message)+ i18n completeness 8/8
- A3: PNG 23KB 实际生成 + tauri.conf.json 配置加载;dmg 实际效果留 ship 时 user 实测

## 不做

- A2(Gatekeeper 文档):放后续单独 feat,涉及 .dmg readme.txt / .app 内首启 dialog
- A5(系统通知):放后续,涉及 macOS notification permission + tray badge
- 美术升级:dmg-background.png 是占位级品质(无品牌色 / 无 logo),未来美术 drop in replace

## 规模

Medium — 3 笔代码 commit(A1/A4/A3)+ 1 笔 docs 落盘,~270 行净代码 + 23KB 占位 PNG + 12 个 unit test。
