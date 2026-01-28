# ZFlow 打包指南

## 打包前准备

### 环境要求

**必需工具：**
1. **Bun** - JavaScript 运行时
2. **Rust** - 系统编程语言（Tauri 依赖）
3. **Node.js** - 前端构建工具
4. **WebView2** (Windows) - Windows 10/11 通常已预装
5. **WebKit** (macOS) - 系统自带
6. **WebKitGTK** (Linux) - 需要安装

### 检查环境

```bash
# 检查 Bun 版本
bun --version

# 检查 Rust 版本
rustc --version

# 检查 Cargo 版本
cargo --version
```

## 方案1：仅打包桌面应用（推荐）

这种方式打包的客户端需要连接到独立运行的后端服务。

### 打包步骤

1. **确保后端已运行在其他机器上**
   - 后端服务运行在 `http://192.168.11.14:9999`
   - 或者修改 `.env.local` 配置文件中的后端地址

2. **运行打包脚本**
   ```bash
   # Windows
   build-desktop.bat

   # 或手动执行
   cd packages/desktop
   bun run build          # 构建前端
   bun run tauri build    # 构建 Tauri 应用
   ```

3. **输出文件位置**
   - Windows: `packages/desktop/src-tauri/target/release/bundle/nsis/ZFlow_1.1.36_x64-setup.exe`
   - Linux: `packages/desktop/src-tauri/target/release/bundle/deb/zflow_1.1.36_amd64.deb`
   - macOS: `packages/desktop/src-tauri/target/release/bundle/dmg/ZFlow_1.1.36_x64.dmg`

### 分发给用户

**方式1：提供完整安装包**
- 安装 `ZFlow_1.1.36_x64-setup.exe`
- 启动后端服务（见下方说明）
- 桌面应用自动连接到后端

**方式2：分别提供**
- `ZFlow-Desktop.exe` - 桌面应用
- `ZFlow-Server.exe` - 后端服务启动脚本

## 方案2：打包集成后端的客户端（高级）

这种方式打包的客户端会自动启动后端服务，但需要额外配置。

### 当前限制

⚠️ **开发模式**：已实现，可以正常工作
⚠️ **生产构建**：需要解决以下问题：

1. **后端源文件打包**
   - 需要将 `packages/opencode` 目录复制到桌面应用中
   - 或使用 Bun 的打包功能创建独立可执行文件

2. **依赖项问题**
   - Playwright 浏览器驱动
   - Node.js/Bun 运行时
   - 其他系统依赖

3. **资源管理**
   - 后端进程生命周期
   - 端口占用检测
   - 日志和错误处理

### 实现方案2的步骤（仅供参考）

#### 步骤1：打包后端为独立可执行文件

```bash
# 使用 Bun 创建独立可执行文件
cd packages/opencode
bun build ./src/index.ts --compile --outfile opencode-server.exe
```

#### 步骤2：修改 Tauri 配置

在 `packages/desktop/src-tauri/tauri.conf.json` 中：

```json
{
  "bundle": {
    "externalBin": ["sidecars/opencode-server"],
    "resources": ["../opencode-server.exe"]
  }
}
```

#### 步骤3：构建打包脚本

创建 `build-desktop-integrated.bat`：

```batch
@echo off
echo Building integrated desktop app...

REM 1. Build backend
cd packages/opencode
bun build ./src/index.ts --compile --outfile ../desktop/src-tauri/sidecars/opencode-server.exe

REM 2. Build desktop app
cd ../desktop
bun run build
bun run tauri build
```

#### 步骤4：处理 Playwright 依赖

```bash
# 在打包机器上安装 Playwright 浏览器
cd packages/opencode
bun run playwright install chromium
```

### 当前推荐方案

由于方案2的复杂性，**当前推荐使用方案1**：

1. 桌面应用和后端服务分开部署
2. 后端服务运行在服务器上（如 `192.168.11.14:9999`）
3. 多个客户端可以连接到同一个后端
4. 便于维护和更新

## 修改后端地址

如果需要修改桌面应用连接的后端地址，编辑：

```
packages/desktop/.env.local
```

修改为：

```
VITE_OPENCODE_SERVER_HOST=你的服务器IP
VITE_OPENCODE_SERVER_PORT=9999
```

## 常见问题

### Q1: 打包失败，提示缺少 WebView2

**Windows:** 下载并安装 [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

### Q2: 打包后应用无法启动后端

**问题：** Sidecar 路径不正确或后端文件未打包

**解决：** 检查 `src-tauri/sidecars/` 目录中的文件是否存在

### Q3: 如何签名应用程序？

**Windows:** 使用代码签名证书
```bash
signtool sign /f certificate.pfx /p password ZFlow_1.1.36_x64-setup.exe
```

### Q4: 如何减小安装包大小？

1. 移除不必要的依赖
2. 使用 `tauri build` 的压缩选项
3. 考虑使用增量更新机制

## 开发与生产的区别

| 特性 | 开发模式 (`tauri dev`) | 生产模式 (`tauri build`) |
|------|----------------------|------------------------|
| 热重载 | ✅ 支持 | ❌ 不支持 |
| 调试工具 | ✅ 完整 | ⚠️ 有限 |
| 性能 | ⚠️ 较慢 | ✅ 最优 |
| 体积 | ⚠️ 较大 | ✅ 较小 |
| Sidecar 支持 | ✅ 相对路径 | ❌ 需要绝对路径 |

## 快速开始打包

```bash
# 1. 确保在项目根目录
cd F:\pythonproject\opencode

# 2. 运行打包脚本
build-desktop.bat

# 3. 等待完成（可能需要5-10分钟）
# 构建输出在 packages/desktop/src-tauri/target/release/

# 4. 测试安装包
# 双击运行 ZFlow_1.1.36_x64-setup.exe
```

## 需要帮助？

如果遇到问题，检查：
1. Rust 和 Cargo 是否正确安装
2. WebView2 是否已安装（Windows）
3. 防火墙是否阻止构建过程
4. 磁盘空间是否充足（至少 2GB）
