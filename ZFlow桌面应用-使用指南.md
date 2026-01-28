# ZFlow 桌面应用 - 快速启动指南

## 🚀 快速开始

### 前置条件

ZFlow 桌面应用需要后端服务才能正常工作。

## 📋 启动步骤

### 方法1：同时启动前端和后端（推荐）

**方式 A：使用启动脚本**

双击运行：`start-all.bat`

**方式 B：手动启动**

1. **启动后端**（终端 1）：
   ```bash
   cd packages\opencode
   bun run ./src/index.ts serve --hostname 0.0.0.0 --port 9999
   ```

2. **启动桌面应用**（终端 2 或双击快捷方式）：
   ```bash
   cd packages\desktop
   bun run tauri dev
   ```

### 方法2：仅启动桌面应用（后端已在其他地方运行）

如果后端服务已经在其他机器上运行（如 `192.168.11.14:9999`）：

1. 直接双击桌面应用图标
2. 应用会自动尝试连接到后端

## 🔧 配置后端地址

### 方案A：环境变量（开发模式）

编辑 `packages/desktop/.env.local`：

```env
# 后端服务器地址
VITE_OPENCODE_SERVER_HOST=192.168.11.14
VITE_OPENCODE_SERVER_PORT=9999
```

### 方案B：应用内配置（运行时）

1. 启动桌面应用
2. 如果连接失败，会在应用内配置界面输入后端地址
3. 地址格式：`http://192.168.11.14:9999`

## ⚠️ 常见问题

### Q1: 启动应用时显示 "Failed to spawn opencode"

**原因**：应用尝试启动本地后端服务，但配置中禁用了此功能。

**解决**：确保后端服务已在其他地方运行。

### Q2: 应用启动后立即崩溃

**原因**：可能是 sidecar 配置问题。

**解决**：检查 `packages/desktop/src-tauri/tauri.conf.json` 中的 `externalBin` 是否为空数组：
```json
"externalBin": []
```

### Q3: 无法连接到后端

**检查项**：
1. 后端服务是否正在运行？
   ```bash
   curl http://192.168.11.14:9999/global/health
   ```

2. 防火墙是否允许连接？

3. 后端地址是否正确？

## 🌐 网络配置

### 局域网访问

桌面应用支持连接到局域网内的后端服务：

- **Windows**: `http://192.168.x.x:9999`
- **Linux**: `http://192.168.x.x:9999`
- **macOS**: `http://192.168.x.x:9999`

### 本地开发

本地开发时，所有服务都在同一台机器：

- 前端：`http://localhost:1420`
- 后端：`http://localhost:9999`

## 📦 构建和分发

### 开发模式

```bash
cd packages/desktop
bun run tauri dev
```

### 生产构建

```bash
build-desktop.bat
```

生成的安装包在：`packages/desktop/src-tauri/target/release/bundle/`

### CI/CD 自动构建

推送到 GitHub 后，会自动在 GitHub Actions 上构建所有平台的安装包：
- Windows (NSIS)
- macOS (DMG)
- Linux (DEB/RPM)

构建产物在 Actions 页面的 Artifacts 区域。

## 🎯 推荐部署方式

### 小型团队/个人使用

1. **后端服务**：运行在公司服务器或 NAS 上
2. **桌面应用**：分发给团队成员，配置连接到服务器后端

### 大型团队

1. **后端服务**：部署在云服务器
2. **桌面应用**：通过 GitHub Releases 下载安装

## 📞 技术支持

如遇问题，请检查：

1. **后端服务日志**：查看 `packages/opencode` 的输出
2. **桌面应用日志**：查看 Tauri 的日志输出
3. **网络连接**：使用 `ping` 和 `telnet` 测试连接

---

**版本**: 1.1.36
**更新日期**: 2025-01-28
