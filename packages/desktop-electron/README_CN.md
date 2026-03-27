# OpenCode 桌面应用 (Electron)

基于 Electron 构建的 OpenCode 原生桌面应用。

## 环境要求

- [Bun](https://bun.sh/) v1.3.11+
- Node.js v22+（可选，推荐使用 Bun）

## 开发调试

在项目根目录运行：

```bash
bun install
bun run --cwd packages/desktop-electron dev
```

这将启动 Electron 应用并开启热重载。

## 构建打包

### 第一步：编译 CLI

桌面应用需要 OpenCode CLI 作为后端服务。首先编译 CLI：

```bash
cd packages/opencode
bun run build --single
```

> 注意：`--single` 参数表示只编译当前平台的版本，加快编译速度。

### 第二步：复制 CLI 到资源目录

将编译好的 CLI 复制到 Electron 的资源目录：

**macOS (Apple Silicon):**
```bash
mkdir -p ../desktop-electron/resources
cp dist/opencode-darwin-arm64/bin/opencode ../desktop-electron/resources/opencode-cli
```

**macOS (Intel):**
```bash
mkdir -p ../desktop-electron/resources
cp dist/opencode-darwin-x64/bin/opencode ../desktop-electron/resources/opencode-cli
```

**Windows:**
```bash
mkdir ..\desktop-electron\resources
copy dist\opencode-windows-x64\bin\opencode.exe ..\desktop-electron\resources\opencode-cli.exe
```

**Linux:**
```bash
mkdir -p ../desktop-electron/resources
cp dist/opencode-linux-x64/bin/opencode ../desktop-electron/resources/opencode-cli
```

### 第三步：打包应用

以下以 macOS 为例，其他平台请参考[各平台打包命令](#各平台打包命令)。

```bash
cd ../desktop-electron
bun run build && bun run prebuild && bun run package:mac
```

打包完成后，安装包位于 `packages/desktop-electron/dist/` 目录。

## 各平台打包命令

- `bun run package:mac` - 打包 macOS 应用（.dmg）
- `bun run package:win` - 打包 Windows 应用（.exe）
- `bun run package:linux` - 打包 Linux 应用（.AppImage, .deb）

**## 应用架构

桌面应用由以下部分组成：

1. **Electron 主进程** - 负责应用生命周期、窗口管理和 CLI 后端服务
2. **渲染进程** - 基于 SolidJS 的 UI 界面（与 Web 应用共用）
3. **CLI 后端服务** - OpenCode CLI 作为本地服务器运行，UI 通过 HTTP 连接
