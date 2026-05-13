# CSS 样式体系全量审计报告

> **任务类型**: 规划 / 架构改进 + 全局审计
> **优先级**: P2 → P1（审计发现 5 个严重 Bug，升级优先级）
> **范围**: 全部 CSS 文件（`packages/ui/src/styles/` + `packages/app/src/index.css` + 组件层 CSS）

---

## 0. 审计总结

2026-05-04 进行了五维并行审计，涵盖：工具类映射、data-component 白名单、Aether 主题缺口、色彩系统结构、!important 使用。共发现 **5 大类、23 个具体问题**，其中 **5 个为严重 Bug**。

| 严重程度 | 数量 | 关键问题 |
|---------|------|---------|
| 🔴 严重 Bug | 5 | tailwind 别名映射错误、工具类名值不符、孤悬变量 |
| 🟠 应定义/清理 | 2 | 未定义的 `--surface-hover`/`--surface-disabled`、`--surface-panel` |
| 🟡 Aether 主题缺口 | 3 | 暗色 Dock 不匹配、无过渡动画、浮动面板浅 |
| 🩵 冗余/死代码 | 8 | 两组 gray、smoke 重复、未使用别名、缺少 tailwind 别名 |
| ✅ !important | 5 | 组件层需审查，Arc 层合理 |

---

## 1. 原始问题（Arc 主题 CSS 覆盖体系结构性问题）

Arc 主题（特别是浅色模式下的"反色 sidebar"设计）在 CSS token 覆盖层面存在 4 个结构性问题，导致每次新组件加入 sidebar 或调整主题样式时，都需要反复"踩雷→查源码→修正覆盖"。

---

## 2. 原始问题详述与真实案例

### 2.1 双重覆盖冗余（Tailwind v4 编译期捕获）

**现象**: 每个需要覆盖的 CSS token 都必须写两遍——raw token (`--text-strong`) + Tailwind 别名 (`--color-text-strong`)。

**根因**: Tailwind v4 在 `@theme` 层将 `--color-*` 变量的值静态捕获到后代元素。运行时在祖先元素上覆盖 `--text-strong` 不会传播到 `text-text-strong` 工具类，因为 Tailwind 编译时已将 `--color-text-strong` 解析为根作用域的静态值。必须同时覆盖 `--color-text-strong` 才能影响工具类。

**案例**: arc.css 第 123-135 行，每个文字/图标 token 都是成对出现：

```css
--text-strong: #FBF6FB;
--color-text-strong: var(--text-strong);  /* 必须同步覆盖 */
```

当前 arc.css 中有 **11 对** 这样的双重覆盖，共 22 行。遗漏其中任何一个都会导致"看起来覆盖了但实际没生效"的隐晦 bug。

**本次任务暴露**: 我第一次覆盖了 `--background-stronger` + `--color-background-stronger`，但遗漏了 `--background-base` 和 `--surface-raised-base`，导致卡片内的图标区域和状态标签背景仍然显示为白色。

---

### 2.2 工具类名与实际消费的 CSS 变量不一致

**现象**: Tailwind 工具类的命名暗示它消费某个 CSS 变量，但实际消费的是另一个完全不同的变量。

**根因**: 部分自定义工具类在 `utilities.css` 中手动定义，其 `var()` 引用可以指向任意变量，不受命名约定约束。

**案例**: `bg-surface-panel` 工具类：

```css
/* utilities.css 第 130 行 */
.bg-surface-panel {
  background-color: var(--surface-raised-base);  /* ← 不是 --surface-panel！ */
}
```

开发者看到 `bg-surface-panel`，直觉认为它消费 `--surface-panel`，于是覆盖 `--surface-panel`——完全无效。必须去翻 `utilities.css` 才能发现实际映射。

**本次任务暴露**: 我第一次覆盖了 `--surface-panel` / `--color-surface-panel`，结果状态标签背景仍然是白色，因为 `bg-surface-panel` 根本不消费这两个变量。

---

### 2.3 `data-component` 选择器覆盖范围缺少自动检测

**现象**: Arc 主题的文字/图标覆盖通过列举特定的 `data-component` 选择器生效。新组件如果不加 `data-component` 属性，就自动落入"不被主题覆盖"的盲区。

**根因**: 覆盖选择器是白名单式的（`[data-component="sidebar-rail"], [data-component="sidebar-panel"], ...`），而非基于 DOM 层级的自动继承。

**案例**: arc.css 第 118-122 行：

```css
html[data-theme="arc"] [data-component="sidebar-rail"],
html[data-theme="arc"] [data-component="sidebar-nav-desktop"],
html[data-theme="arc"] [data-component="sidebar-nav-mobile"],
html[data-theme="arc"] [data-component="sidebar-panel"],
html[data-theme="arc"] [data-component="titlebar"] {
  --text-strong: #FBF6FB;
  ...
}
```

**审计结论（2026-05-04 更新）**: 当前无高风险缺口。TrellisTasksPanel 已有 `data-component="sidebar-panel"`（trellis-tasks-panel.tsx:103）。所有侧边栏子组件通过 CSS 自定义属性级联从 5 个白名单容器继承覆写 token。4 个组件有 data-component 但不在 arc.css 中（`sidebar-session-loading`、`workspace-item`、`getting-started`、`getting-started-actions`），但作为白名单容器的后代，通过级联工作正常。建议作为防御性措施将 `getting-started` 和 `workspace-item` 加入 arc.css 多选择器。

---

### 2.4 浅色主题下 sidebar "反色特区"的高维护成本

**现象**: Arc 浅色主题的 sidebar 使用 mid-tone mauve (`#756B7E`) 背景而非浅色背景，导致 sidebar 内所有 token（文字、图标、背景、边框、surface）都需要"反向"覆盖——与全局浅色主题的 token 方向相反。

**根因**: Arc Browser 的设计语言强调深色 sidebar + 浅色 main pane 的对比，这在浅色主题下意味着 sidebar 里的所有视觉 token 都不能沿用全局默认值。

**影响**: 每个 sidebar 内的新组件或新 token 使用，都必须逐一确认"是否需要覆盖"和"覆盖值应该是什么"。没有自动化检测机制，全靠人肉排查。

---

## 3. 审计新增问题

### 3.1 🔴 严重 Bug：`--color-surface-raised-base-hover` 映射错误

**文件**: `tailwind/colors.css:24`
```css
--color-surface-raised-base-hover: var(--surface-interactive-base);
/* 应该是: var(--surface-raised-base-hover) */
```

`--surface-raised-base-hover` 在 theme.css 中是 `rgba(3, 76, 255, 0.12)`，而 `--surface-interactive-base` 是 `#ecf3ff`。任何使用 `hover:bg-surface-raised-base-hover` 的组件会显示淡蓝色而非高亮蓝。**此文件由 script/tailwind.ts 自动生成，但此行被手动修改引入了 Bug。**

### 3.2 🔴 严重 Bug：`--color-surface-raised-base-active` 硬编码错误值

**文件**: `tailwind/colors.css:25`
```css
--color-surface-raised-base-active: light-dark(#d4ee77, #2f371a);
/* 应该是: var(--surface-raised-base-active) */
```

正确值应为 `rgba(3, 76, 255, 0.18)` / `rgba(3, 76, 255, 0.25)`。硬编码的黄绿色/深绿色与主题完全不符。

### 3.3 🔴 严重 Bug：`.w-[200px]` 实际宽度 150px

**文件**: `utilities.css:126-128`
```css
.w-\[200px\] {
  width: 150px;  /* ← 类名说 200px */
}
```
`dialog-switch-project.tsx:115` 使用 `w-[200px]` 得到 150px。

### 3.4 🔴 严重 Bug：`.pl-2` 覆盖 Tailwind 内置类且值不符

**文件**: `utilities.css:122-124`
```css
.pl-2 {
  padding-left: calc(var(--spacing) * 4);  /* = 1rem，等于 Tailwind 的 pl-4 */
}
```
Tailwind v4 内置 `pl-2` = 0.5rem。此自定义类将所有 `pl-2` 变为 1rem。

### 3.5 🟠 孤悬变量：`--surface-hover` 和 `--surface-disabled` 未定义

被 `switch.css`、`checkbox.css`、`button.css` 引用，但 theme.css 中无定义。回退为 `initial`（透明），相关状态可能无可见效果。

### 3.6 🟠 孤悬变量：`--surface-panel` 被引用但从未定义

`app/src/index.css:144` 有 `color-mix(in srgb, var(--surface-panel) 55%, transparent)`，但 `--surface-panel` 未定义，`color-mix()` 可能无法正确计算。

### 3.7 🟡 Aether 主题：暗色模式 Dock 完全不匹配

`aether.css` 的 Dock 覆盖（第 68-99 行）全部在 `@media (prefers-color-scheme: light)` 中。浅色模式是温暖纸白色卡，暗色模式回退到基础主题的半透明玻璃效果。切换明暗模式时 Dock 风格突变。

### 3.8 🟡 Aether 主题：完全缺少过渡动画

Arc 为按钮、卡片、图标按钮、菜单项等定义了平滑过渡（全部包裹在 `@media (prefers-reduced-motion: no-preference)` 中）。Aether 零过渡定义，所有交互状态变化都是瞬时跳变。

### 3.9 🟡 Aether 主题：浮动面板深度不足

Arc 的下拉菜单、弹窗有多层阴影 + 背景模糊。Aether 使用基础主题默认阴影，浮动面板显得平坦。

### 3.10 🩵 冗余：colors.css 中两组 `--gray-*` 定义，第一组完全无效

- 第 2-49 行：纯灰阶（`#161616`、`#fcfcfc`）
- 第 50-97 行：暖棕色（`#131010`、`#fdfcfc`）
- CSS 后定义覆盖前定义，第一组 48 行完全浪费

### 3.11 🩵 冗余：`--smoke-*` 是第二组 `--gray-*` 的完全复制 + 未使用别名

- smoke 定义（第 98-145 行）和第二组 gray 逐值一致
- Legacy 别名（第 689-740 行）将 smoke → gray 映射，但整个代码库中 `--smoke-*` **零引用**
- 共 96 行死代码

### 3.12 🩵 冗余：`amber-lightalpha-*`/`amber-darkalpha-*` 24 个别名仅 1 处使用

仅 `message-part.css:1516` 使用 `--amber-darkalpha-10`。其余 23 个是死代码。命名也不一致（`lightalpha` vs `light-alpha`）。

### 3.13 🩵 冗余：`--purple-*`/`--cyan-*` 跨色别名完全未使用

4 个别名（第 768-771 行）零引用。

### 3.14 🩵 缺失：theme.css 约 20+ 个 color tokens 缺少 tailwind 别名

缺失项包括：`--button-primary-base`、`--avatar-*`（12 个）、`--text-invert-*`（4 个）、`--text-stronger`、`--border-critical-weak`、`--icon-diff-modified-base` 等。无法通过 Tailwind 工具类直接使用。

### 3.15 !important 审计

全项目共 21 处 `!important`（不含注释）。Arc 主题 14 处全部合理（覆盖 Tailwind 工具类/inline style），base.css 2 处合理，组件层 5 处需审查：

| 文件 | 行号 | 属性 | 审查结论 |
|------|------|------|---------|
| `tailwind/utilities.css` | 127 | `font-weight: 600 !important` | 强制粗体，可接受 |
| `message-part.css` | 564-565 | `bg/border: transparent/none` | 工具输出透明处理，可接受 |
| `message-part.css` | 773 | `padding-bottom: 0` | 消息间距清除，可接受 |
| `message-part.css` | 1675 | `background-color: var(...)` | Arc 变通，方案 C 后可消除 |
| `markdown.css` | 104 | `color: var(--text-weak)` | 注释色强制，可接受 |

---

## 4. 改进思想

### 4.1 核心原则

1. **类名即变量名**: 工具类名应该明确暗示它消费的 CSS 变量，消除"查源码才能知道"的认知负担
2. **覆盖自动化**: 减少需要手写双重覆盖的场景，或用工具生成
3. **范围继承**: sidebar 区域的覆盖应通过 DOM 层级自动传播，而非通过白名单选择器
4. **token 命名空间**: sidebar 区域的 token 可以有独立的命名空间，与全局 token 分离
5. **审计新增**: Tailwind 别名必须与底层 token 语义一致；自定义工具类不能覆盖 Tailwind 内置类且值不符

### 4.2 约束

- 不改变 Arc 主题的视觉设计（mauve sidebar 保持不变）
- 不破坏已有组件的样式
- 不引入运行时 JS 依赖（纯 CSS 方案优先）
- 兼容 Tailwind v4 的编译期捕获机制
- 自动生成文件（tailwind/colors.css）不应手动修改

---

## 5. 改进方案

### 方案 A: 修复工具类映射 + 修正 Bug（投入低，收益高）

**改动**: 修正 `utilities.css` 和 `tailwind/colors.css` 中的错误。

**具体步骤**:
1. `bg-surface-panel` → 在 theme.css 中定义 `--surface-panel`，修改 utilities.css 引用
2. 删除 `.w-[200px]`（让 Tailwind 内置处理）或将值改为 200px
3. 删除 `.pl-2`（让 Tailwind 内置处理）
4. 修复 `tailwind/colors.css:24`：`--color-surface-raised-base-hover: var(--surface-raised-base-hover)`
5. 修复 `tailwind/colors.css:25`：`--color-surface-raised-base-active: var(--surface-raised-base-active)`
6. 在 theme.css 中定义 `--surface-hover`、`--surface-disabled`
7. 运行 `script/tailwind.ts` 重新生成 colors.css，确保无手动修改

**风险**: 低到中。`--surface-panel` 当前未定义，添加后需确认非 Arc 主题下视觉效果不变。

---

### 方案 B: 生成双重覆盖的工具（投入中，收益中）

**改动**: 写一个 PostCSS 插件或简单的 shell 脚本，自动为每个 `--token: value` 生成对应的 `--color-token: var(--token)` 覆盖行。

**具体步骤**:
1. 定义规则：在 CSS 块中遇到 `--xxx: yyy;` 且 `xxx` 属于 Tailwind `--color-*` 映射表（从 `colors.css` 提取），自动追加 `--color-xxx: var(--xxx);`
2. 集成到构建流程或作为 lint 规则
3. 清理 arc.css 中已有的手写双重覆盖

**风险**: 中。需要维护映射表，且可能过度生成（有些 token 不需要双重覆盖）。

---

### 方案 C: sidebar 作用域 class 替代 data-component 白名单（投入中，收益高）

**改动**: 在 sidebar 容器层添加统一的 class（如 `arc-sidebar-scope`），替代当前逐个列举 `data-component` 的选择器策略。

**具体步骤**:
1. 在 `sidebar-shell.tsx` 的 sidebar-rail 和 panel 容器上添加 `class="arc-sidebar-scope"`（仅 Arc 主题下生效）
2. 将 arc.css 中的选择器改为 `html[data-theme="arc"] .arc-sidebar-scope { ... }`
3. 防御性添加 `getting-started`、`workspace-item` 到覆盖组（如保留 data-component 方案）
4. 移除各组件上多余的 `data-component` 标记（如果该标记仅用于主题覆盖）

**风险**: 中。需要确保 `.arc-sidebar-scope` 的作用域精确覆盖 sidebar 区域，不会泄漏到 main pane 或 dock。

**优势**: 新组件只要在 sidebar 容器内，就自动继承覆盖，无需手动加 `data-component`。可消除 arc.css 中约一半的 `!important`。

---

### 方案 D: sidebar token 命名空间（投入高，收益高）

**改动**: 定义一组 sidebar 专用的 token 前缀（如 `--sidebar-text-strong`、`--sidebar-surface-panel`），在 sidebar 容器上设值，sidebar 内组件直接消费这些 token。

**风险**: 高。需要修改大量组件的类名引用，且 Tailwind 工具类生成需要适配。

---

### 方案 E: Aether 主题补全（投入中，收益中）

**改动**: 修复 Aether 主题的重大缺口。

**具体步骤**:
1. 为 `[data-dock-surface="shell"]` 和 `[data-dock-surface="tray"]` 添加 `@media (prefers-color-scheme: dark)` 覆盖，使用深暖色背景替代透明玻璃
2. 添加基础过渡动画块（至少覆盖 button、icon-button、sidebar-session 的 background-color 和 box-shadow）
3. 浮动面板可选：添加 backdrop-filter + 增强阴影

**风险**: 低。Aether 的暖色阴影系统已通过 Tailwind 工具类正确传播，只需补充缺失部分。

---

### 方案 F: 清理 colors.css 死代码（投入低，收益低但整洁）

**具体步骤**:
1. 删除第一组 gray 定义（第 2-49 行）——被第二组完全覆盖
2. 删除 smoke 直接定义（第 98-145 行）——与第二组 gray 完全重复
3. 删除或保留 Legacy smoke→gray 别名（第 689-740 行）——零引用但防止外部兼容问题
4. 删除未使用的 amber-*alpha-* 别名（保留 `--amber-darkalpha-10`）
5. 删除未使用的 `--purple-*`/`--cyan-*` 别名
6. 统一命名：`lightalpha` → `light-alpha`

**风险**: 低。需确认无外部依赖（如 storybook 或其他包）。

---

## 6. 推荐执行顺序

| 优先级 | 方案 | 预估工作量 | 收益 |
|---|---|---|---|
| **1** | A: 修复工具类映射 + Bug 修正 | 2-3 小时 | 消除 5 个严重 Bug |
| **2** | C: sidebar 作用域 class | 2-4 小时 | 消除 data-component 白名单遗漏 + 减少 !important |
| **3** | E: Aether 主题补全 | 2-3 小时 | 修复暗色 Dock 不一致 + 添加过渡 |
| **4** | B: 双重覆盖生成工具 | 4-6 小时 | 减少 arc.css 冗余 |
| **5** | F: 清理 colors.css 死代码 | 1-2 小时 | 代码整洁 |
| **6** | D: sidebar token 命名空间 | 1-2 天 | 根本性解决但代价高 |

方案 A 和 C 可以独立执行，互不依赖。方案 B 依赖 A 先完成。方案 E 独立于 A-D。方案 F 可随时执行。

---

## 7. 相关文件

| 文件 | 关联 |
|---|---|
| `packages/ui/src/styles/arc.css` | Arc 主题主覆盖文件 |
| `packages/ui/src/styles/aether.css` | Aether 主题文件（100 行，有缺口） |
| `packages/ui/src/styles/utilities.css` | 自定义工具类定义（5 个不匹配） |
| `packages/ui/src/styles/tailwind/colors.css` | Tailwind v4 `--color-*` 别名映射（2 个 Bug） |
| `packages/ui/src/styles/tailwind/index.css` | Tailwind 主题定义 |
| `packages/ui/src/styles/tailwind/utilities.css` | Tailwind @utility 定义 |
| `packages/ui/src/styles/colors.css` | 色彩调色板（772 行，约 30% 死代码） |
| `packages/ui/src/styles/theme.css` | 主题 token 定义（缺少 `--surface-hover` 等） |
| `packages/ui/src/styles/base.css` | 基础重置 |
| `packages/ui/src/styles/index.css` | 样式入口，CSS 层定义 |
| `packages/ui/script/tailwind.ts` | colors.css 生成脚本 |
| `packages/ui/script/colors.txt` | 颜色 token 源文件 |
| `packages/app/src/pages/layout/sidebar-shell.tsx` | sidebar 容器组件 |
| `packages/app/src/pages/layout/trellis-tasks-panel.tsx` | TrellisTasksPanel（已有 data-component="sidebar-panel"） |
| `packages/app/src/index.css` | app 层样式覆盖 |

---

## 8. 历史修复记录

1. **第一版覆盖**（不生效）: 覆盖了 `--surface-panel` / `--color-surface-panel`，但 `bg-surface-panel` 实际消费 `--surface-raised-base`
2. **第二版覆盖**（生效）: 改为覆盖 `--surface-raised-base` / `--color-surface-raised-base`，并追加了 `--background-base` / `--color-background-base`
3. **`data-component` 修复**: 给 `TrellisTasksPanel` 加 `data-component="sidebar-panel"` 使文字/图标覆盖生效

---

## 9. 审计方法论

2026-05-04 使用 5 个并行探索智能体进行审计：

| 审计维度 | 智能体 | 关键发现 |
|---------|--------|---------|
| 工具类名 vs CSS 变量映射 | explore | 5 个不匹配（bg-surface-panel、w-[200px]、pl-2、2 个 tailwind 别名） |
| data-component 白名单覆盖 | explore | 无高风险缺口，4 个组件通过级联继承 |
| Aether vs Arc 覆盖差异 | explore | 3 个重大缺口（暗色 Dock、无动画、浮动面板浅） |
| colors.css 冗余与 theme.css 结构 | explore | 2 个严重 Bug（tailwind 别名错误）、100+ 行死代码 |
| !important 使用与特异性 | explore | 21 处使用，Arc 层合理，组件层 5 处需审查 |
