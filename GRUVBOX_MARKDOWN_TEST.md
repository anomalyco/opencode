# Gruvbox Markdown 配色测试指南

## 🎯 测试目标

验证 Desktop 应用中 Gruvbox 主题下的 markdown 元素配色是否正确显示。

## 📋 测试步骤

### 1. 启动应用

```bash
cd /Users/lelouch/apps/opencode

# 确保依赖已安装
bun install

# 启动 Desktop 应用
cd packages/desktop
bun run tauri dev
```

### 2. 配置主题

1. 打开应用设置（Settings）
2. 找到主题选项（Theme）
3. 选择 **Gruvbox** 主题
4. 确保系统处于 **Dark Mode**

### 3. 测试消息

与助手对话，发送以下测试消息：

```
请帮我展示各种 markdown 元素：

# 一级标题
## 二级标题
### 三级标题

这是**强调文本**和*斜体文本*的示例。

- 列表项 A
- 列表项 B
- 列表项 C

1. 有序列表 1
2. 有序列表 2
3. 有序列表 3

这是 `行内代码` 的示例。

> 这是引用文本
> 可以有多行

[这是一个链接](https://example.com)

```python
# 这是代码块
def hello():
    print("Hello World")
```
```

### 4. 验证配色

检查助手回复中的各个元素颜色：

| 元素 | 预期颜色 | Hex 值 | 视觉效果 |
|------|---------|--------|---------|
| 标题 (h1-h6) | 红色 | #fb4934 | 🔴 醒目突出 |
| 列表标记 (•, 1.) | 橙色 | #fe8019 | 🟠 清晰层次 |
| 行内代码 (`code`) | 黄色 | #fabd2f | 🟡 易于识别 |
| 链接 | 青色 | #8ec07c | 🔵 可点击感 |
| 引用 (>) | 灰色 | #928374 | ⚪ 柔和对比 |
| 强调 (**text**) | 橙色 | #fe8019 | 🟠 重点突出 |
| 斜体 (*text*) | 紫色 | #d3869b | 🟣 优雅区分 |
| 主文本 | 浅米色 | #ebdbb2 | 📝 舒适阅读 |

## 🔍 对比测试

### 查看原始效果

```bash
git checkout dev
# 重启应用
cd packages/desktop
bun run tauri dev
```

### 查看新效果

```bash
git checkout feature/gruvbox-markdown-colors
# 重启应用
cd packages/desktop
bun run tauri dev
```

## ✅ 验证清单

- [ ] 标题显示为红色
- [ ] 列表标记显示为橙色
- [ ] 行内代码显示为黄色
- [ ] 链接显示为青色
- [ ] 引用显示为灰色
- [ ] 强调文本显示为橙色
- [ ] 斜体文本显示为紫色
- [ ] 主文本保持浅米色
- [ ] 切换到其他主题（如 Nord）仍正常显示
- [ ] 切换回 Gruvbox 主题配色正确

## 🐛 已知问题

无

## 📝 技术细节

### 修改的文件

- `packages/ui/src/components/markdown.css`

### 更改内容

将硬编码的颜色值替换为主题特定的 CSS 变量：

- `--markdown-heading` - 标题颜色
- `--markdown-strong` - 强调文本颜色
- `--markdown-emph` - 斜体文本颜色（新增）
- `--markdown-link` - 链接颜色
- `--markdown-list-item` - 列表标记颜色
- `--markdown-block-quote` - 引用颜色
- `--markdown-code` - 行内代码颜色

### Gruvbox 主题配色定义

位于 `packages/ui/src/theme/themes/gruvbox.json`：

```json
{
  "dark": {
    "overrides": {
      "markdown-heading": "#fb4934",
      "markdown-list-item": "#fe8019",
      "markdown-code": "#fabd2f",
      "markdown-link": "#8ec07c",
      "markdown-block-quote": "#928374",
      "markdown-strong": "#fe8019",
      "markdown-emph": "#d3869b"
    }
  }
}
```

## 🎨 设计理念

- **视觉层次**：不同元素使用不同颜色，提升可读性
- **温暖色调**：保持 Gruvbox 主题的温暖、舒适感
- **对比度**：确保所有颜色在深色背景下有足够对比度
- **一致性**：遵循 Gruvbox 配色规范

## 📸 截图对比

（测试后可以在这里添加截图）

### 修改前


### 修改后


---

**测试完成后，请反馈：**
- ✅ 配色是否符合预期
- ✅ 是否有任何视觉问题
- ✅ 其他主题是否受影响
