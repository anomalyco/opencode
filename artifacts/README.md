# LINGXI CODE CLI — 多平台离线版本打包指南

> 本文档介绍如何为 **LINGXI CODE CLI** 企业内网离线版本进行多平台打包。

---

## 目录

- [通用前置条件](#通用前置条件)
- [一、Windows 10 x64 系统](#一windows-10-x64-系统)
- [二、麒麟 ARM64 系统](#二麒麟-arm64-系统)
- [三、Windows 7 x64 系统](#三windows-7-x64-系统)
- [四、麒麟 x64 系统](#四麒麟-x64-系统)

---

## 通用前置条件

在开始打包之前，请确保已完成以下准备：

1. **下载完整的 GitHub 工程文件**，其中包含已编译好的企业内网离线版 LINGXI CODE CLI 主程序。
2. 根据目标平台，可修改 `<project-root>/artifacts/<platform>/attached/*` 目录下的配置文件和插件。

---

## 一、Windows 10 x64 系统

| 项目 | 说明 |
| :--- | :--- |
| **可定制文件** | `<project-root>/artifacts/win10-x64/attached/*` |
| **打包脚本** | `./script/build-win10-x64-release-package.ps1` |
| **输出版本** | `<project-root>/artifacts/win10-x64/release/*` |

### 操作步骤

1. 下载完整的 GitHub 工程文件。
2. 按需修改 `artifacts/win10-x64/attached/` 目录下的配置文件与插件。
3. 使用 **Windows PowerShell** 进入 `<project-root>` 目录，运行以下命令：

   ```powershell
   ./script/build-win10-x64-release-package.ps1
   ```

---

## 二、麒麟 ARM64 系统

| 项目 | 说明 |
| :--- | :--- |
| **可定制文件** | `<project-root>/artifacts/kylin-arm64/attached/*` |
| **打包脚本** | `./script/build-kylin-arm64-release-package.ps1` |
| **输出版本** | `<project-root>/artifacts/kylin-arm64/release/*` |

### 操作步骤

1. 下载完整的 GitHub 工程文件。
2. 按需修改 `artifacts/kylin-arm64/attached/` 目录下的配置文件与插件。
3. 使用 **Windows PowerShell** 进入 `<project-root>` 目录，运行以下命令：

   ```powershell
   ./script/build-kylin-arm64-release-package.ps1
   ```

---

## 三、Windows 7 x64 系统

| 项目 | 说明 |
| :--- | :--- |
| **可定制文件** | `<project-root>/artifacts/win7-x64/attached/*` |
| **打包脚本** | `./script/build-win7-x64-release-package.ps1` |
| **输出版本** | `<project-root>/artifacts/win7-x64/release/*` |

### 操作步骤

1. 下载完整的 GitHub 工程文件。
2. 按需修改 `artifacts/win7-x64/attached/` 目录下的配置文件与插件。
3. 使用 **Windows PowerShell** 进入 `<project-root>` 目录，运行以下命令：

   ```powershell
   ./script/build-win7-x64-release-package.ps1
   ```

---

## 四、麒麟 x64 系统

| 项目 | 说明 |
| :--- | :--- |
| **可定制文件** | `<project-root>/artifacts/kylin-x64/attached/*` |
| **打包脚本** | `./script/build-kylin-x64-release-package.ps1` |
| **输出版本** | `<project-root>/artifacts/kylin-x64/release/*` |

### 操作步骤

1. 下载完整的 GitHub 工程文件。
2. 按需修改 `artifacts/kylin-x64/attached/` 目录下的配置文件与插件。
3. 使用 **Windows PowerShell** 进入 `<project-root>` 目录，运行以下命令：

   ```powershell
   ./script/build-kylin-x64-release-package.ps1
   ```

---

## 平台速查表

| 平台 | 架构 | 可定制文件路径 | 打包脚本 |
| :--- | :--- | :--- | :--- |
| Windows 10 | x64 | `artifacts/win10-x64/attached/` | `build-win10-x64-release-package.ps1` |
| 麒麟 | ARM64 | `artifacts/kylin-arm64/attached/` | `build-kylin-arm64-release-package.ps1` |
| Windows 7 | x64 | `artifacts/win7-x64/attached/` | `build-win7-x64-release-package.ps1` |
| 麒麟 | x64 | `artifacts/kylin-x64/attached/` | `build-kylin-x64-release-package.ps1` |
