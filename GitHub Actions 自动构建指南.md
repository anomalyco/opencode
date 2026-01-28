# GitHub Actions 自动构建指南

## ✅ 已配置完成

已创建 `.github/workflows/build-desktop.yml`，会自动构建桌面应用。

## 🚀 如何使用

### 方式1：自动触发（推荐）

推送代码到以下分支时自动构建：
- `main` - 主分支
- `dev` - 开发分支
- `feature/*` - 功能分支
- `v*` - 版本标签（如 `v1.1.36`）

**示例：**
```bash
# 推送到 dev 分支
git add .
git commit -m "Update desktop app"
git push origin feature/zflow

# 打标签并推送（会创建 Release）
git tag v1.1.36
git push origin v1.1.36
```

### 方式2：手动触发

1. 访问 GitHub 仓库页面
2. 点击 **Actions** 标签
3. 选择 **"Build Desktop App"** 工作流
4. 点击 **"Run workflow"** 按钮
5. 选择分支，点击 **"Run workflow"**

## 📦 构建产物

### 自动构建

每次推送代码后，会在 **Actions** 页面生成构建产物：

**Windows:**
- `ZFlow_1.1.36_x64-setup.exe` - 安装程序
- `ZFlow_1.1.36_x64.zip` - 便携版

**macOS:**
- `ZFlow_1.1.36_x64.dmg` - Intel 版安装包
- `ZFlow_1.1.36_aarch64.dmg` - Apple Silicon 版安装包

**Linux:**
- `zflow_1.1.36_amd64.deb` - Debian/Ubuntu 安装包
- `ZFlow_1.1.36_amd64.AppImage` - 通用便携版

### 下载构建产物

1. 访问 GitHub 仓库
2. 点击 **Actions** 标签
3. 选择最近的工作流运行
4. 滚动到页面底部的 **Artifacts** 区域
5. 点击下载所需的平台产物

## 🏷️ 创建 Release（带版本标签）

当推送版本标签时（如 `v1.1.36`），会自动创建 GitHub Release：

1. 打标签：
   ```bash
   git tag v1.1.36
   git push origin v1.1.36
   ```

2. GitHub Actions 会：
   - 构建所有平台的应用
   - 创建草稿 Release
   - 上传所有安装包到 Release

3. 发布 Release：
   - 访问仓库的 **Releases** 页面
   - 找到对应的版本（草稿状态）
   - 编辑 Release 说明
   - 点击 **"Publish release"** 发布

## 📊 构建时间

- **Windows**: 约 10-15 分钟
- **macOS**: 约 8-12 分钟
- **Linux**: 约 5-8 分钟

总时间（并行构建）：约 15 分钟

## ⚙️ 自定义配置

### 修改触发分支

编辑 `.github/workflows/build-desktop.yml`：

```yaml
on:
  push:
    branches:
      - main      # 添加或删除分支
      - dev
      - your-branch  # 自定义分支
```

### 仅构建特定平台

如果只想构建 Windows，修改 matrix：

```yaml
strategy:
  matrix:
    settings:
      - host: windows-latest
        target: x86_64-pc-windows-msvc
```

### 修改应用名称

编辑 `packages/desktop/src-tauri/tauri.conf.json`：

```json
{
  "productName": "ZFlow",
  "identifier": "ai.zflow.desktop"
}
```

## 🔧 故障排除

### 构建失败

1. 检查 Actions 日志：GitHub → Actions → 点击失败的工作流
2. 常见问题：
   - **依赖安装失败**：检查 `package.json` 是否正确
   - **构建超时**：GitHub Actions 有时间限制，可以增加 timeout
   - **Rust 编译错误**：检查 Rust 版本兼容性

### Windows 签名警告

构建的应用没有代码签名，Windows 会显示"未知发布者"警告。

**解决方案**（需要代码签名证书）：
1. 购买代码签名证书
2. 在 GitHub Secrets 中添加证书
3. 修改工作流配置使用证书签名

### macOS 不可用警告

macOS 构建的应用也有类似的"未验证开发者"警告。

**解决方案**（需要 Apple Developer 账户）：
1. 注册 Apple Developer Program（$99/年）
2. 配置证书和 Provisioning Profile
3. 在工作流中添加签名配置

## 💡 最佳实践

1. **开发阶段**：推送到 `feature/*` 分支自动构建测试
2. **发布版本**：打标签（`v1.1.36`）自动创建 Release
3. ** Pull Request**：PR 会自动构建，验证代码质量
4. **版本管理**：使用语义化版本（Semantic Versioning）

## 📝 工作流文件位置

```
.github/
└── workflows/
    └── build-desktop.yml  # 桌面应用自动构建配置
```

## 🆚 与现有 publish.yml 的区别

| 特性 | build-desktop.yml | publish.yml |
|------|-------------------|-------------|
| **复杂度** | ✅ 简单，开箱即用 | ⚠️ 复杂，需要配置 |
| **触发方式** | 推送/手动/标签 | 仅推送和标签 |
| **代码签名** | ❌ 无 | ✅ 支持 |
| **Runner** | GitHub 标准 runner | 自定义 runner |
| **适用场景** | 开发、测试、个人使用 | 正式发布、企业部署 |
| **配置要求** | 无 | 需要 secrets 和证书 |

## 🎯 快速开始

1. **提交工作流文件**：
   ```bash
   git add .github/workflows/build-desktop.yml
   git commit -m "Add GitHub Actions for desktop build"
   git push origin feature/zflow
   ```

2. **查看构建进度**：
   - 访问 GitHub 仓库
   - 点击 **Actions** 标签
   - 查看 "Build Desktop App" 工作流运行状态

3. **下载构建产物**：
   - 等待构建完成（约15分钟）
   - 点击工作流运行记录
   - 在 **Artifacts** 部分下载所需平台的安装包

## 📞 需要帮助？

如果遇到问题：
1. 查看 **Actions** 页面的日志
2. 检查工作流配置文件语法
3. 参考 [Tauri 官方文档](https://tauri.app/v1/guides/building/)
4. 查看 [GitHub Actions 文档](https://docs.github.com/en/actions)
