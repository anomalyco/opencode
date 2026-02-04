# OpenCode UI 定制化改造记录

本文档记录了对 OpenCode 前端界面进行的“三分式布局”定制化改造。本次改造的核心目标是移除传统 IDE 的最左侧活动栏 (Activity Bar)，将所有导航与管理功能整合到统一的侧边栏中，形成更简洁的 **[项目/会话列表] - [编辑器] - [文件树]** 结构。

## 1. 改造概览

| 区域 | 改造前 | 改造后 |
| :--- | :--- | :--- |
| **最左侧** | Activity Bar (图标导航栏) | **已移除** |
| **侧边栏** | 仅显示当前选中的视图 (如文件或搜索) | **集成化面板 (SidebarPanel)** |
| **项目切换** | 点击图标或弹窗 | **侧边栏顶部下拉菜单** |
| **底部功能** | 散落在各处 | **侧边栏底部固定工具栏** (设置/帮助) |

## 2. 核心代码修改

主要修改文件：`packages/app/src/pages/layout.tsx`

### 2.1 新增 `SidebarPanel` 组件

我们将侧边栏重构为一个独立的 `SidebarPanel` 组件，包含三个主要部分：

#### A. 顶部：项目切换 (Project Switcher)
使用 `DropdownMenu` 替代了原有的图标切换方式。

```tsx
// packages/app/src/pages/layout.tsx (SidebarPanel)

<div class="shrink-0 p-2 border-b border-border-weak-base">
  <DropdownMenu modal={!layout.sidebar.opened()}>
    <DropdownMenu.Trigger as={Button} variant="ghost" class="w-full justify-between px-2 font-medium">
      {/* 显示当前项目名称 */}
      <span class="truncate">{projectName() || language.t("command.project.open")}</span>
      <Icon name="chevron-down" size="small" class="text-icon-weak" />
    </DropdownMenu.Trigger>
    {/* 下拉内容：项目列表 + 打开新项目 */}
    <DropdownMenu.Content class="w-64 max-h-96 overflow-y-auto">
      <For each={layout.projects.list()}>
        {(p) => (
          <DropdownMenu.Item onSelect={() => openProject(p.worktree)}>
             {/* ... 项目项 ... */}
          </DropdownMenu.Item>
        )}
      </For>
      {/* ... */}
    </DropdownMenu.Content>
  </DropdownMenu>
</div>
```

#### B. 中间：会话与工作区 (Sessions & Workspaces)
显示当前项目下的会话列表 (Session List) 和工作区 (Workspaces)。

*   **组件**：`LocalWorkspace` 或 `SortableWorkspace` (支持拖拽)。
*   **功能**：
    *   列出所有历史会话。
    *   提供 "New Session" (`+`) 快捷按钮。
    *   支持 Workspace 的展开/折叠与管理。

```tsx
<div class="flex-1 min-h-0 flex flex-col">
  {/* 新建会话按钮 */}
  <div class="shrink-0 py-2 px-3">
    <Button onClick={() => navigate(`/${base64Encode(p().worktree)}/session`)}>
      {language.t("command.session.new")}
    </Button>
  </div>
  {/* 会话列表区域 */}
  <div class="relative flex-1 min-h-0">
    <DragDropProvider ...>
      {/* ... SortableWorkspace 列表 ... */}
    </DragDropProvider>
  </div>
</div>
```

#### C. 底部：工具栏 (Footer Toolbar)
固定在侧边栏底部的常用功能入口。

```tsx
<div class="shrink-0 p-2 border-t border-border-weak-base flex items-center gap-1">
  {/* 设置按钮 */}
  <IconButton icon="settings-gear" onClick={openSettings} ... />
  {/* 帮助按钮 */}
  <IconButton icon="help" onClick={() => platform.openLink(...)} ... />
  {/* 连接 Provider 按钮 (如果未连接) */}
  <Show when={...}>
    <Button onClick={connectProvider}>Connect</Button>
  </Show>
</div>
```

### 2.2 主布局调整

在 `Layout` 主组件中，我们移除了原有的 Activity Bar 容器，直接渲染 `SidebarPanel`。

```tsx
// packages/app/src/pages/layout.tsx (Layout return)

return (
  <div class="relative bg-background-base flex-1 min-h-0 flex flex-col ...">
    <Titlebar />
    <div class="flex-1 min-h-0 flex">
      {/* 侧边栏区域 */}
      <Show when={layout.sidebar.opened()}>
        <nav style={{ width: `${layout.sidebar.width()}px` }} ...>
          {/* 直接渲染新的集成面板 */}
          <SidebarPanel project={currentProject()} />
          {/* 调整大小手柄 */}
          <ResizeHandle ... />
        </nav>
      </Show>
      
      {/* 主内容区域 (编辑器/文件树) */}
      <main class="...">
        {props.children}
      </main>
    </div>
    {/* ... */}
  </div>
)
```

## 3. 样式适配

*   **移动端适配**：`SidebarPanel` 接受 `mobile` prop，在移动端视图下自适应宽度并移除部分桌面端特有的交互（如 ResizeHandle）。
*   **主题变量**：使用了 OpenCode UI 库的标准颜色变量（如 `bg-background-base`, `border-border-weak-base`）以确保在 Light/Dark 模式下表现一致。

## 4. 后续维护建议

*   **添加新功能入口**：如果需要添加新的全局功能入口，建议放入 **侧边栏底部工具栏** 或 **顶部项目下拉菜单** 中，避免破坏中间列表区的纯净性。
*   **性能优化**：`SidebarPanel` 中包含了 Session 列表的实时渲染，如果会话数量极多，需注意 `For` 循环的渲染性能，必要时引入虚拟滚动。
