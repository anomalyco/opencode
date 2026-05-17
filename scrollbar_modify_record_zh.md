# 滚动条比例滑块修复

> 修复滚动条 thumb（滑块）始终占满整个轨道高度的问题，导致用户无法判断当前在长对话中的滚动位置。

## 问题描述

TUI 会话视图中的垂直滚动条，无论内容多长，thumb 始终充满整个轨道高度。用户无法通过滚动条直观判断当前所在位置。

## 根因分析

`@opentui/core`（<=0.2.12）中 `ScrollBarRenderable.updateSliderFromScrollState()` 的 bug：

1. 该方法在给 `slider.viewPortSize` 赋值**之后**才设置 `slider.max`（总滚动范围）。
2. 然而 `Slider.set viewPortSize` 的 setter 内部会将值 clamp 到 `slider.max - slider.min` 范围内。
3. 由于赋值 `viewPortSize` 时 `slider.max` 还是初始值（≈0），viewport 大小被 clamp 到约 0-1。
4. 这导致 `getVirtualThumbSize()` 计算为：`track * (viewPortSize / max)` ≈ `track * (1/max)` ≈ 填满整个轨道（max 很小时）或极细的一条线，永远不会反映真实比例。

## 修复位置

**文件：** `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`  
**辅助函数：** `patchScrollbarProportionalThumb()`（第 178 行，紧接在 `Session` 组件上方）  
**调用点：** `<scrollbox>` 的 `ref` 回调（第 1137 行）

## 修复细节

补丁逻辑封装在独立辅助函数 `patchScrollbarProportionalThumb(scrollbox)` 中，通过 scrollbox 的 `ref` 回调调用：

```typescript
ref={(r) => {
  scroll = r
  patchScrollbarProportionalThumb(r)
}}
```

该函数施加两个 monkey-patch：

### 补丁 1：状态更新后重新同步 `viewPortSize`

```typescript
const origUpdate = bar.updateSliderFromScrollState.bind(bar)
bar.updateSliderFromScrollState = function () {
  origUpdate()
  slider.viewPortSize = Math.max(1, bar._viewportSize)
}
```

在原始 `updateSliderFromScrollState` 执行完毕后（此时 `slider.max` 已正确设置），重新从 `bar._viewportSize` 赋值给 `slider.viewPortSize`。此时 setter 中的 clamp 能正确生效，因为 `slider.max` 已经是正确的值。

### 补丁 2：强制最小 thumb 尺寸

```typescript
const origThumb = slider.getVirtualThumbSize
slider.getVirtualThumbSize = function (this: any) {
  const raw: number = origThumb.call(this)
  const track =
    this.orientation === "vertical" ? this.height * 2 : this.width * 2
  if (track <= 0) return raw
  const minSize = Math.max(6, Math.floor(track * 0.1))
  return Math.max(minSize, Math.min(raw, track))
}
```

确保滚动条 thumb 不会小于轨道的 10% 或 3 个字符格（6 个半格），防止在超长对话中 thumb 变得肉眼不可见。

### 视觉增强

将滚动条 thumb 颜色从 `theme.border` 改为 `theme.primary`（青色），提升与轨道背景（`theme.backgroundElement`）的对比度：

```typescript
verticalScrollbarOptions={{
  paddingLeft: 1,
  visible: showScrollbar(),
  trackOptions: {
    backgroundColor: theme.backgroundElement,
    foregroundColor: theme.primary,
  },
}}
```

## 效果

滚动条 thumb 现在正确反映 viewport 与内容的比例关系。例如对话有 10,000 行、viewport 显示 50 行时，thumb 约占轨道的 0.5%（受最小尺寸保护，不低于 10%），且 thumb 位置准确反映当前滚动偏移量。

## 如何验证

1. 用 `bun dev` 启动 TUI，打开或创建一个长对话（滚动内容显著超过 viewport 高度）。
2. 按 `s` 键切换显示滚动条。
3. 观察青色 thumb 的大小与 viewport/内容比例成正比（长对话时小，短对话时大）。
4. 上下滚动，确认 thumb 位置沿轨道成比例移动。
5. 确认 thumb 不会变得过小不可见（最小为轨道的 10% 或 3 格）。
