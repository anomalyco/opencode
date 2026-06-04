# pnpm + Electron 项目配置指南

> **Purpose**: 使用 pnpm 管理 Electron 项目的完整配置指南，包括 monorepo 设置、native modules 处理和打包配置。

---

## 为什么 Electron 项目使用 pnpm 需要特殊配置？

pnpm 默认使用 **符号链接 + 内容寻址存储**，创建非扁平的 `node_modules` 结构：

```
node_modules/
├── .pnpm/                    # 实际包存储
│   ├── better-sqlite3@9.0.0/
│   │   └── node_modules/
│   │       └── better-sqlite3/
│   └── bindings@1.5.0/
└── your-package -> .pnpm/... # 符号链接
```

**问题**：

1. **Native modules 路径解析失败** - Electron 打包时无法正确处理符号链接
2. **electron-rebuild 找不到模块** - 需要扁平结构才能正确重建
3. **asar 打包问题** - 符号链接不能被打包进 asar

**解决方案**：使用 `shamefully-hoist` 创建类似 npm 的扁平结构。

---

## 基础配置

### 1. .npmrc 配置（必需）

```ini
# .npmrc

# 使用 hoisted 的 node_modules 结构（类似 npm）
node-linker=hoisted

# 将所有依赖提升到根 node_modules（Electron 必需）
shamefully-hoist=true

# 可选：如果遇到 peer dependency 警告
strict-peer-dependencies=false

# 可选：加速安装
prefer-offline=true
```

**配置说明**：

| 配置                             | 作用                      | 为什么需要                |
| -------------------------------- | ------------------------- | ------------------------- |
| `node-linker=hoisted`            | 使用扁平化的 node_modules | Electron 打包需要         |
| `shamefully-hoist=true`          | 提升所有依赖到根目录      | Native modules 路径解析   |
| `strict-peer-dependencies=false` | 忽略 peer 依赖警告        | Electron 生态包版本常冲突 |

### 2. pnpm-workspace.yaml（Monorepo）

```yaml
# pnpm-workspace.yaml

packages:
  - 'apps/*' # Electron 应用
  - 'packages/*' # 共享包
  - '!**/dist' # 排除构建产物
  - '!**/out' # 排除 Electron 打包产物
```

**典型 Monorepo 结构**：

```
my-electron-project/
├── .npmrc
├── pnpm-workspace.yaml
├── package.json              # 根 package.json
├── apps/
│   └── desktop/              # Electron 应用
│       ├── package.json
│       ├── forge.config.ts
│       ├── src/
│       │   ├── main/         # Main process
│       │   ├── renderer/     # Renderer process
│       │   └── preload/      # Preload scripts
│       └── ...
└── packages/
    ├── shared/               # 共享代码
    │   └── package.json
    └── ui/                   # 共享 UI 组件
        └── package.json
```

### 3. 根 package.json

```json
{
  "name": "my-electron-monorepo",
  "private": true,
  "scripts": {
    "dev": "pnpm --filter @my-app/desktop dev",
    "build": "pnpm --filter @my-app/desktop build",
    "package": "pnpm --filter @my-app/desktop package",
    "make": "pnpm --filter @my-app/desktop make",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "postinstall": "electron-builder install-app-deps"
  },
  "devDependencies": {
    "electron": "^28.0.0"
  },
  "engines": {
    "node": ">=18.0.0",
    "pnpm": ">=8.0.0"
  },
  "packageManager": "pnpm@8.15.0"
}
```

---

## Native Modules 配置

### 问题：Native Modules 需要为 Electron 重新编译

Native modules（如 `better-sqlite3`）包含 C++ 代码，必须针对 Electron 的 Node.js 版本编译。

### 解决方案 1：electron-rebuild（推荐）

```json
// apps/desktop/package.json
{
  "scripts": {
    "postinstall": "electron-rebuild",
    "rebuild": "electron-rebuild -f"
  },
  "devDependencies": {
    "@electron/rebuild": "^3.6.0"
  }
}
```

### 解决方案 2：electron-builder install-app-deps

```json
// 根 package.json
{
  "scripts": {
    "postinstall": "electron-builder install-app-deps"
  },
  "devDependencies": {
    "electron-builder": "^24.0.0"
  }
}
```

### 解决方案 3：Electron Forge 自动处理

如果使用 Electron Forge，配置 `rebuildConfig`：

```typescript
// forge.config.ts
import type { ForgeConfig } from '@electron-forge/shared-types';

const config: ForgeConfig = {
  rebuildConfig: {
    force: true, // 强制重建所有 native modules
  },
  // ...
};

export default config;
```

---

## Electron Forge + pnpm 配置

### forge.config.ts 完整配置

```typescript
// apps/desktop/forge.config.ts
import type { ForgeConfig } from '@electron-forge/shared-types';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'path';
import { cp, mkdir } from 'fs/promises';

// Native modules 及其依赖
const nativeModules = ['better-sqlite3', 'bindings', 'file-uri-to-path'];

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      // 从 asar 中提取 native 二进制文件
      unpack: '*.{node,dll}',
    },
    // 只包含必要的 node_modules
    ignore: [
      // 排除所有 node_modules，除了 native modules
      new RegExp(`node_modules/(?!(${nativeModules.join('|')})/)`),
      // 排除开发文件
      /\.git/,
      /\.vscode/,
      /\.idea/,
      /src\//,
      /\.ts$/,
      /\.map$/,
    ],
  },

  rebuildConfig: {
    force: true,
  },

  hooks: {
    // 打包后复制 native modules
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const sourceNodeModules = path.resolve(__dirname, 'node_modules');
      const destNodeModules = path.resolve(buildPath, 'node_modules');

      for (const packageName of nativeModules) {
        const sourcePath = path.join(sourceNodeModules, packageName);
        const destPath = path.join(destNodeModules, packageName);

        try {
          await mkdir(path.dirname(destPath), { recursive: true });
          await cp(sourcePath, destPath, {
            recursive: true,
            preserveTimestamps: true,
          });
        } catch (error) {
          console.warn(`Failed to copy ${packageName}:`, error);
        }
      }
    },
  },

  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main/index.ts', config: 'vite.main.config.ts' },
        { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),

    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: false, // 允许加载 unpacked 文件
    }),
  ],
};

export default config;
```

### Vite 配置：外部化 Native Modules

```typescript
// vite.main.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'electron',
        'better-sqlite3',
        // 其他 native modules
      ],
    },
  },
  resolve: {
    // 确保 Node.js 内置模块正确解析
    conditions: ['node'],
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
});
```

---

## 常见问题排查

### 问题 1：`Cannot find module 'better-sqlite3'`

**原因**：Native module 未被正确打包。

**检查步骤**：

```bash
# 1. 确认 .npmrc 配置正确
cat .npmrc
# 应该包含：
# node-linker=hoisted
# shamefully-hoist=true

# 2. 重新安装依赖
rm -rf node_modules pnpm-lock.yaml
pnpm install

# 3. 检查 node_modules 结构
ls -la node_modules/better-sqlite3
# 应该是实际目录，不是符号链接

# 4. 重建 native modules
pnpm rebuild better-sqlite3
```

### 问题 2：`NODE_MODULE_VERSION mismatch`

**错误信息**：

```
Error: The module was compiled against a different Node.js version
```

**原因**：Native module 是为 Node.js 编译的，不是 Electron。

**解决**：

```bash
# 强制重建所有 native modules
npx electron-rebuild -f

# 或在 forge.config.ts 中设置
rebuildConfig: {
  force: true,
}
```

### 问题 3：Monorepo 中找不到共享包

**原因**：Workspace 协议配置问题。

**解决**：

```json
// apps/desktop/package.json
{
  "dependencies": {
    "@my-app/shared": "workspace:*"
  }
}
```

确保 `pnpm-workspace.yaml` 包含了共享包路径。

### 问题 4：打包后应用启动失败

**调试步骤**：

```bash
# 1. 查看打包产物
ls -la out/*/resources/

# 2. 检查 asar 内容
npx asar list out/*/resources/app.asar

# 3. 检查 unpacked 文件
ls -la out/*/resources/app.asar.unpacked/

# 4. 运行打包后的应用并查看日志
# macOS
./out/MyApp-darwin-x64/MyApp.app/Contents/MacOS/MyApp

# Windows
./out/MyApp-win32-x64/MyApp.exe
```

### 问题 5：pnpm install 后 electron-rebuild 失败

**原因**：可能是 Python 或 C++ 构建工具缺失。

**解决**：

```bash
# macOS
xcode-select --install

# Windows（管理员 PowerShell）
npm install --global windows-build-tools

# 或者安装 Visual Studio Build Tools
```

---

## 最佳实践

### 1. 锁定 Electron 版本

```json
// package.json
{
  "devDependencies": {
    "electron": "28.0.0" // 使用精确版本，不用 ^
  }
}
```

### 2. 使用 packageManager 字段

```json
// package.json
{
  "packageManager": "pnpm@8.15.0",
  "engines": {
    "node": ">=18.0.0",
    "pnpm": ">=8.0.0"
  }
}
```

### 3. CI/CD 配置

```yaml
# .github/workflows/build.yml
jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v2
        with:
          version: 8

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm build

      - name: Package
        run: pnpm package
```

### 4. 开发脚本

```json
// apps/desktop/package.json
{
  "scripts": {
    "dev": "electron-forge start",
    "build": "tsc && vite build",
    "package": "electron-forge package",
    "make": "electron-forge make",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit",
    "postinstall": "electron-rebuild"
  }
}
```

---

## 配置检查清单

新建 Electron + pnpm 项目时：

- [ ] 创建 `.npmrc`，包含 `shamefully-hoist=true` 和 `node-linker=hoisted`
- [ ] 创建 `pnpm-workspace.yaml`（如果是 monorepo）
- [ ] 添加 `postinstall` 脚本运行 `electron-rebuild`
- [ ] 在 `forge.config.ts` 中配置 `rebuildConfig.force = true`
- [ ] 在 Vite 配置中将 native modules 设为 external
- [ ] 在 `packagerConfig.ignore` 中正确处理 node_modules
- [ ] 测试打包：`pnpm package` 后运行打包产物

---

## 参考资源

- [pnpm Documentation](https://pnpm.io/)
- [Electron Forge](https://www.electronforge.io/)
- [electron-rebuild](https://github.com/electron/rebuild)
- [Native Module Packaging Guide](../big-question/native-module-packaging.md)
