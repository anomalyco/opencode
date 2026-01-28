# ZFlow 桌面应用

## 开发模式

### 启动开发环境

1. **启动后端服务**（终端1）：
   ```bash
   cd packages/opencode
   bun run ./src/index.ts serve --hostname 0.0.0.0 --port 9999
   ```

2. **启动桌面应用**（终端2）：
   ```bash
   cd packages/desktop
   bun run tauri dev
   ```
   或者直接运行：`run-desktop-dev.bat`

这将打开 Tauri 桌面窗口，包含你所有的二次开发功能（BrowserPanel、HTMLPreview 等）。

### 访问地址
- 桌面应用：Tauri 窗口
- 后端API：`http://localhost:9999` 或 `http://192.168.11.14:9999`

## 构建独立客户端

### 方式1：使用脚本（推荐）

双击运行：
```
build-desktop.bat
```

### 方式2：手动构建

1. **构建前端**：
   ```bash
   cd packages/desktop
   bun run build
   ```

2. **构建桌面应用**：
   ```bash
   bun run tauri build
   ```

### 输出文件

构建完成后，安装程序位于：
- **Windows**: `packages/desktop/src-tauri/target/release/ZFlow_1.1.36_x64-setup.nsis`
- **Linux**: `packages/desktop/src-tauri/target/release/bundle/deb/zflow_1.1.36_amd64.deb`
- **macOS**: `packages/desktop/src-tauri/target/release/bundle/dmg/ZFlow_1.1.36_x64.dmg`

## 包含的功能

所有你的二次开发功能：
- BrowserPanel - 浏览器面板
- HTMLPreview - HTML预览
- McpDashboard - MCP仪表板
- settings-skills - 技能设置
- TaskView - 任务视图

## 注意事项

1. **后端依赖**：桌面应用需要后端服务运行在 9999 端口
2. **网络连接**：确保可以访问 `http://192.168.11.14:9999`
3. **环境变量**：`.env.local` 文件配置了后端地址，如需修改请编辑此文件

## 自定义后端地址

如果需要修改后端地址，编辑：
```
packages/desktop/.env.local
```

修改为你的实际后端地址：
```
VITE_OPENCODE_SERVER_HOST=你的IP或localhost
VITE_OPENCODE_SERVER_PORT=9999
```
