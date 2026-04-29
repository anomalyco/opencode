# OpenCode UI Widget Extension System - PR Documentation

## 概述

本提案为 OpenCode 添加 **UI Widget 扩展系统**，允许用户在侧边栏、主页等位置注入自定义组件（Pet、Clock、Stats 等）。

## 改动思路

### 1. 现有架构分析

OpenCode 已有完整的 **TUI Slot 扩展系统**，但仅支持 TUI (Terminal)。Web UI 没有暴露扩展 API。

**核心文件：**
- `packages/plugin/src/tui.ts` - 定义了所有 TUI 扩展类型
- `packages/opencode/src/cli/cmd/tui/plugin/` - 插件运行时
- `packages/opencode/src/cli/cmd/tui/routes/` - 渲染 slot 的 UI 组件

### 2. 当前可用 Slot (TUI)

| Slot 名称 | 位置 | 说明 |
|-----------|------|------|
| `sidebar_content` | Session 侧边栏主体 | 可添加多个 widget |
| `sidebar_footer` | Session 侧边栏底部 | 版权信息等 |
| `home_bottom` | Home 页面 prompt 下方 | 提示、欢迎语 |
| `home_footer` | Home 页面底部 | 目录信息 |
| `home_logo` | Home 页面 Logo | 替换默认 Logo |
| `session_prompt` | Prompt 输入框区域 | 完全替换 prompt |
| `home_prompt_right` | Home prompt 右侧 | 附加按钮等 |

### 3. Web UI 限制

目前 Web UI (`packages/app`) 不支持插件扩展。如果需要，需要：
1. 在 `packages/app` 中实现类似的 Slot Provider
2. 暴露 REST API 给插件注册
3. 添加对应的 React 组件渲染

## 实现方案

### 示例插件：Widgets Demo

已创建完整可用的示例插件：
- 路径：`~/.config/opencode/plugins/opencode-widgets-demo/`

**包含组件：**
1. **Pet Widget** - 虚拟宠物，会自动变换表情
2. **Clock Widget** - 实时时钟
3. **Stats Widget** - 会话统计
4. **Welcome Banner** - 主页欢迎信息

### 安装方式

```bash
# 1. 确保插件目录存在
mkdir -p ~/.config/opencode/plugins/opencode-widgets-demo

# 2. 添加到 opencode.json
{
  "plugin": [
    "file://~/.config/opencode/plugins/opencode-widgets-demo/index.ts"
  ]
}

# 3. 重启 opencode
```

### 编译自定义版本

```bash
# 安装 bun 1.3.13+
curl -fsSL https://bun.sh/install | bash

# 克隆源码
git clone https://github.com/anomalyco/opencode.git
cd opencode

# 安装依赖
bun install

# 编译
cd packages/opencode
bun run build

# 可执行文件位置
ls dist/opencode-linux-x64/bin/opencode
```

## 编译产物

已编译的 Linux x64 可执行文件：
```
~/CodeSpace/opencode-bin
```

大小：141MB

## 未来扩展方向

### 1. Web UI 扩展支持
```tsx
// packages/app 端需要添加类似 TUI 的 Slot 系统
export function registerSlot(name: string, component: Component) { ... }
```

### 2. 内置 Widget 市场
- Pet Store / Widget Gallery
- 一键安装社区 widget

### 3. 交互式 Widget
```tsx
// 当前只读 widget
<text>Static content</text>

// 未来可交互
<input onChange={...} />
<button onClick={...}>Click me</button>
```

## 代码示例

### 创建自定义 Widget

```tsx
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal, onCleanup } from "solid-js"

function MyWidget(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const [count, setCount] = createSignal(0)

  // 定时更新
  const interval = setInterval(() => setCount(c => c + 1), 1000)
  onCleanup(() => clearInterval(interval))

  return (
    <box>
      <text fg={theme().text}>计数器: {count()}</text>
    </box>
  )
}

const plugin: TuiPlugin = async (api) => {
  api.slots.register({
    order: 50,
    slots: {
      sidebar_content(_ctx, props) {
        return <MyWidget api={api} session_id={props.session_id} />
      },
    },
  })
}

export default { id: "my-widget", tui: plugin }
```

### 注册命令

```tsx
api.command.register(() => [
  {
    title: "My Command",
    value: "my.command",
    keybind: "ctrl+k",
    onSelect() {
      api.ui.toast({ message: "Hello!" })
    },
  },
])
```

## 已知限制

1. **TUI only** - 目前只支持 Terminal UI，Web/Desktop 暂无扩展支持
2. **TypeScript** - 插件必须使用 TypeScript
3. **Bun runtime** - OpenCode 使用 Bun 作为运行时

## 相关文件

- 插件类型定义：`packages/plugin/src/tui.ts`
- Slot 运行时：`packages/opencode/src/cli/cmd/tui/plugin/runtime.ts`
- 内部插件示例：`packages/opencode/src/cli/cmd/tui/feature-plugins/`
- Slot 注册器：`packages/opencode/src/cli/cmd/tui/plugin/slots.tsx`

## 参考资料

- [OpenCode Plugins 文档](https://opencode.ai/docs/plugins/)
- [Plugin SDK 文档](https://opencode.ai/docs/sdk/)
- [Slot 系统源码](packages/opencode/src/cli/cmd/tui/plugin/slots.tsx)
