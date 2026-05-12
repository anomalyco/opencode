# P3 需求分析报告: 品牌闭环 + 残留清洗

> 迭代: `2026-05-13-gap-remediation`
> 制定日期: `2026-05-13`
> 分析师: orchestrator (汇总) + feature-dev + core-dev + platform
> 状态: 📋 待 P4 LLM Panel 评审

---

## Issue #39: Marketing Assets 更新 [XS]

**范围**: `packages/ui/src/assets/images/social-share*.png` (3) + `console/mail/emails/templates/static/logo*.png` (2) + `extensions/zed/icons/octopus.svg` (1)

**关键约束**: Social share 图片需与 #36 章鱼母版同步生成，确保 OG 卡片 1280×720 含 Octopus 字标。

**验收标准（BDD）**:
```
Scenario: OG 分享图更新
  Given social-share.png 重新生成
  When  部署到生产环境
  Then  社交媒体卡片显示 octopus 品牌标识
  And   包含 Octopus 字标

Scenario: 邮件 logo 更新
  Given 注册/邀请邮件发送
  Then  邮件 header 显示 octopus 章鱼 logo
  And   非旧 opencode 品牌

Scenario: Zed 图标验证
  Given Zed 插件安装完成
  Then  扩展面板图标为 octopus 章鱼 mark
```

---

## Issue #40: CLI ASCII Octopus 重写 [XS]

**范围**: `packages/octopus/src/cli/logo.ts` + `.../component/logo.tsx`

**关键约束**: 保留现有 TUI shimmer 动画、鼠标交互（点击涟漪/音效）的兼容性。

**验收标准（BDD）**:
```
Scenario: TUI 启动屏不显示旧品牌
  Given TUI 启动渲染完成
  When  用户进入 CLI 界面
  Then  启动屏不包含 "OPCODE" 文字

Scenario: 交互功能不受影响
  Given TUI 显示新 logo
  When  用户点击 logo 区域
  Then  涟漪动画在 300ms 内开始，帧率 ≥30fps
  And   音效触发时 Web Audio API 无错误抛出

Scenario: 动画适配
  Given 新 ASCII 布局就位
  When  Idle shimmer 动画触发
  Then  动画在新布局范围内正确循环
```

---

## Issue #41: CSS Brand Palette Refresh [XS]

**范围**: `packages/ui/src/styles/theme.css`

**关键约束**: 从 octopus.svg 提取配色，light/dark 双主题 WCAG AA 对比度达标。

**验收标准（BDD）**:
```
Scenario: 品牌色与 octopus artwork 协调
  Given 品牌色 token 已更新
  When  提取自 octopus SVG 的主色 (蓝紫) 和辅色
  Then  `--surface-brand-*` / `--text-on-brand-*` / `--icon-brand-*` 色值与 octopus SVG 主色（#6C63FF, #4A42DB 等）的 ΔE ≤ 5

Scenario: 主题对比度达标
  Given Light 模式下品牌色
  When  测量前景/背景对比度
  Then  符合 WCAG AA 标准 (≥4.5:1)
  And   Dark 模式下同样符合 WCAG AA
```

---

## Issue #44: CI/CD workflow 残留清洗 [XS — Fast-track]

**范围**: 8 个 workflow 文件

**关键约束**: 模型 ID (`opencode/claude-opus-4-5` 等) 不可替换；bot 用户名需确认后改；nix-eval 和 docs-locale-sync 阻塞项不在此 Issue 范围。

**验收标准（BDD）**:
```
Scenario: 品牌引用替换
  Given docs-update.yml
  When  检查步骤名称
  Then  "Run opencode" 改为 "Run octopus"
  And   步骤功能不受影响

Scenario: 模型 ID 保留
  Given 所有 workflow 文件
  When  搜索 "opencode/<model>"
  Then  所有模型路由 ID 保持不变

Scenario: workflow 语法正确
  Given 品牌替换完成
  When  执行 `gh workflow lint`
  Then  无 YAML 语法错误

Scenario: bot 用户名确认
  Given GitHub App 当前注册名已验证
  When  确认 `opencode-agent[bot]` 是否已更名为 `octopus-agent[bot]`
  Then  4 处 bot 引用统一更新为当前用户名
  And   如未更名则保留原引用不变

Scenario: 向后兼容
  Given octopus.yml trigger 条件
  When  用户评论 "/opencode"
  Then  workflow 仍被触发（向后兼容别名）
```

---

## Issue #46: 删除旧 OpenCode mark.svg [XS]

**范围**: `packages/identity/mark.svg`

**关键约束**: 删除前执行 `grep` 确认无代码引用；等 #36 新资产上线确认后执行（Wave 2）。

**验收标准（BDD）**:
```
Scenario: 删除无引用文件
  Given packages/identity/ 目录
  When  执行 `rg mark.svg packages/`（排除 changelog）
  Then  零匹配
  And   删除 mark.svg 后 bun typecheck 通过

Scenario: 目录清理
  Given delete 操作完成
  When  检查 packages/identity/ 内容
  Then  仅含 octopus-* 品牌文件
  And   无 opencode 残留
```

---

## Issue #36: Web, UI & Favicon 章鱼集成 [S]

**Agent 分析 (feature-dev)**: logo.tsx 的 Mark(16×16)/Splash(80×100)/Logo(160×32) 需适配章鱼 SVG。Favicon 新旧双版本共存，旧版删除。

**验收标准（BDD）**:
```
Scenario: UI logo 组件渲染 octopus
  Given logo.tsx 中 Mark/Splash/Logo 组件已更新
  When  组件渲染
  Then  显示 octopus 章鱼 mark（非 O-ring 方块）
  And   fill 属性使用 `var(--icon-*)` CSS 变量

Scenario: 浏览器 tab 图标
  Given favicon 更新完成
  When  用户打开浏览器
  Then  tab 图标显示 octopus mark
  And   apple-touch-icon 同样显示 octopus

Scenario: Web 落地页 logo
  Given web/assets/ 及 docs/ 静态 SVG 已替换
  When  用户访问 Web 落地页或 Docs 站
  Then  header 展示 octopus logo 变体

Scenario: Console header
  Given console/app/src/asset/ 已更新
  When  用户访问控制台
  Then  header 显示 octopus logo

Scenario: favicon 清理
  Given 旧 favicon 文件存在
  When  执行删除
  Then  仅保留新版（不含 -v3 后缀）
  And   site.webmanifest 引用正确路径
```

---

## Issue #37: Console Brand Kit 迁移 [S]

**Agent 分析 (feature-dev)**: brand/ 目录 SVG 文件名已为 `octopus-*`，但内容仍是旧方块。header.tsx 仍引用 `opencode-*.svg` lander 文件。

**验收标准（BDD）**:
```
Scenario: Brand 页面渲染
  Given brand 目录 SVG 内容已替换
  When  用户打开 /brand 路由
  Then  展示 octopus 品牌变体（logo/wordmark/square 各 light/dark）
  And   页面不出现 "OpenCode" 文字

Scenario: 品牌资产包
  Given 品牌资产重新打包
  When  用户下载 octopus-brand-assets.zip
  Then  解压后所有 SVG/PNG 显示 octopus mark
  And   不包含旧 opencode 文件

Scenario: header 组件清理
  Given header.tsx 已更新
  When  搜索 "opencode-*.svg" 引用
  Then  零匹配
  And   lander 目录中 opencode 旧文件已删除

Scenario: 文件命名规范
  Given brand 目录文件列表
  When  检查命名模式
  Then  遵循 `octopus-{variant}-{theme}[-{shape}].svg` 规范
```

---

## Issue #42: README 多语言删除 & 清洗 [S]

**范围**: 删除 20 个翻译 README；README.md/README.zh.md 清洗

**关键约束**: replacement mapping（产品名/域名/包名/仓库路径）需 P5 确认。

**验收标准（BDD）**:
```
Scenario: 翻译 README 删除
  Given 根目录 README 文件列表
  When  执行删除
  Then  仅剩 README.md 和 README.zh.md
  And   其余 20 个翻译文件已移除

Scenario: 英文 README 清洗
  Given README.md
  When  全文搜索 "opencode"
  Then  零匹配（排除外部模型 ID 和第三方包引用）
  And   所有产品名已改为 "octopus"

Scenario: 中文 README 清洗
  Given README.zh.md
  When  全文搜索 "opencode"
  Then  零匹配
  And   与英文版替换规则一致
```

---

## Issue #43: i18n JSON opencode 清洗 [S]

**范围**: 18 web JSON + 15 app TS + 16 desktop TS，~330 处替换

**关键约束**: app TS 是 flat 格式，key 和 value 都含 opencode；模型名称文本保留。

**验收标准（BDD）**:
```
Scenario: Web i18n 清洗
  Given 18 个 web locale JSON 文件
  When  全文搜索 "opencode"（排除外部引用）
  Then  零匹配
  And   翻译值已替换为 "octopus"

Scenario: App i18n 清洗
  Given 15 个 app locale TS 文件
  When  搜索键名和值中的 "opencode"
  Then  零匹配
  And   键名如 `provider.opencode.note` 已改为 `provider.octopus.note`

Scenario: Desktop i18n 清洗
  Given 16 个 desktop locale TS 文件
  When  全文搜索 "opencode"
  Then  零匹配
  And   CLI 命令名引用已替换

Scenario: 类型检查
  Given i18n key 修改完成
  When  运行 `bun typecheck`
  Then  无类型错误
  And   前端能正确读取所有 key
```

---

## Issue #45: 测试文件 opencode 残留清洗 [S]

**Agent 分析 (core-dev)**: ~59 文件，~645 处引用。`opencode.json/c` (~256) 替换、`.opencode/` (~142) 替换、外部 URL 保留 (~189)、Provider ID 暂留 (~47)。

**验收标准（BDD）**:
```
Scenario: Config 文件默认命名
  Given fixture.ts 创建临时项目目录
  When  写入默认 config
  Then  配置文件名 "octopus.json"（非 "opencode.json"）
  And   $schema 字段保持 "https://opencode.ai/config.json"

Scenario: Config 目录默认命名
  Given 项目创建 project-local 配置
  When  创建 config 子目录
  Then  目录名为 ".octopus"
  And   agent/command/skill/tool 子目录存在且 config loader 可枚举

Scenario: 外部引用保留
  Given 测试中有外部 URL 引用
  When  执行清洗
  Then  `opencode.ai/config.json` 等外部 URL 保持不变
  And   模型 ID `opencode/<model>` 保持不变

Scenario: 全部测试通过
  Given 清洗完成
  When  运行 `bun test --preload ./test/preload.ts`
  Then  0 failure, 0 error
  And   `bun typecheck` 通过

Scenario: 向后兼容保留
  Given legacy opencode 命名兼容性
  When  测试显式使用 "opencode.json" 或 ".opencode/" 路径
  Then  测试名含 "legacy" 或 "backward" 指明意图

Scenario: Provider ID 不变
  Given ProviderID.opencode 在 source 中定义
  When  清洗测试文件
  Then  ProviderID 相关引用不变
  And   仅 source 同步后才变更

> ⚠️ ProviderID.opencode 变更需另建追踪 Issue，待 P5 设计方案明确 source 端迁移策略后统一执行。
```

---

## Issue #38: Desktop App Icons 重新生成 [L — Wave 2]

**Agent 分析 (feature-dev)**: seed 是 O 形占位符，需基于章鱼母版重建。三 tier 策略：full (≥256px)、medium (32-255px)、silhouette (<32px)。

**协作**: feature-dev 提供 seed SVG，platform 更新生成脚本。

**验收标准（BDD）**:
```
Scenario: 平台图标通用验证
  Given icon 生成脚本执行
  When  检查 {prod,dev,beta} 三通道
  Then  每通道均生成完整图标集
  And   manifest 完整性检查通过

Scenario: macOS 图标
  Given icon.icns 文件
  When  检查分辨率
  Then  包含 16×16, 32×32, 128×128, 256×256, 512×512, 1024×1024
  And   dock.png (256×256) 带 10% 内边距/阴影
  And   Finder 中显示 octopus mark

Scenario: Windows 图标
  Given icon.ico 文件
  When  提取分辨率
  Then  包含 16×16, 32×32, 48×48, 256×256
  And   16×16 图标与 octopus-mark 参考图 pixelmatch RMSE ≤ 0.08

Scenario: iOS 图标
  Given iOS AppIcon 目录
  When  验证文件列表
  Then  18 个尺寸全套生成 (20×20~1024×1024)
  And   文件名匹配 Apple HIG 规范

Scenario: Android 图标
  Given Android mipmap 目录
  When  检查密度级别
  Then  5 个密度各含 launcher/foreground/round 三变体
  And   adaptive icon XML 内容正确

Scenario: Linux 图标
  Given hicolor 主题目录
  When  检查尺寸
  Then  16×16~512×512 共 9 尺寸
  And   .desktop 文件引用正确图标名

Scenario: 极小尺寸可辨识
  Given silhouette 变体 (16×16)
  When  将生成图与 octopus-mark-silhouette 参考图进行 pixelmatch 对比
  Then  差异像素 ≤ 5%（256 像素中 ≤13 像素偏差）
  And   O 形方块已完全替换
```

---

## 汇总

| Issue | 级别 | Wave | Agent | 预估文件 |
|:-----:|:----:|:----:|-------|:-------:|
| #36 | S | 1 | feature-dev | ~35 |
| #37 | S | 1 | feature-dev | ~40 |
| #39 | XS | 1 | orchestrator | ~6 |
| #40 | XS | 1 | orchestrator | ~2 |
| #41 | XS | 1 | orchestrator | ~3 |
| #42 | S | 1 | feature-dev | ~22 |
| #43 | S | 1 | feature-dev | ~49 |
| #44 | XS | 1 | platform (Fast-track) | ~8 |
| #45 | S | 1 | core-dev | ~59 |
| #38 | L | 2 | feature-dev + platform | ~142 |
| #46 | XS | 2 | orchestrator | ~2 |
