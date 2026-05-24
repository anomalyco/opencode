# @opencode-ai/branding — DeskFox 品牌层

> **[fork-only]** 本包不与 anomalyco/opencode 上游同步,rebase 时永远保留。
>
> 见 [`docs/governance/DeskFox-品牌替换.md`](../../docs/governance/DeskFox-品牌替换.md)。

## 目录结构

```
packages/branding/
├── package.json                          # @opencode-ai/branding workspace dep
├── tsconfig.json
├── README.md                             # 本文件
├── src/
│   ├── logo.tsx                          # 3 export(Mark / Splash / Logo),DeskFox SVG,fill 走 css var
│   ├── theme.css                         # 主题色覆盖 + logo 专用 var(light + dark 各 12 个)
│   └── assets/
│       └── icons/
│           ├── prod/                     # icon-primary 样式(完整美观,正式发布)
│           │   ├── 32x32.png  128x128.png  128x128@2x.png
│           │   └── ico-source/{16,32,48}.png  → 现场生成 icon.ico
│           ├── beta/                     # icon-mono     样式(单色,测试阶段)
│           │   └── (同上结构)
│           └── dev/                      # icon-favicon  样式(极简,开发调试)
│               └── (同上结构)
├── tauri-overrides/
│   ├── dev.json                          # { productName: "DeskFox Dev", ... }
│   ├── prod.json
│   └── beta.json
└── scripts/
    ├── apply-icons.ps1                   # build 前拷 icon 到 src-tauri/icons/{dev,beta,prod}/
    ├── restore-icons.ps1                 # build 后从 git 恢复 icons/(保持工作树干净)
    └── build-deskfox.ps1                 # 一键 wrapper:apply → tauri build --config → restore
```

## 用法

```powershell
# release 构建(--no-bundle 跳过 NSIS)
cd D:\project\opencode-fork
.\packages\branding\scripts\build-deskfox.ps1 -Env dev
.\packages\branding\scripts\build-deskfox.ps1 -Env prod
```

## 设计原则(对齐 [governance/fork-跟随升级与协作规范.md](../../docs/governance/fork-跟随升级与协作规范.md))

- **R1 隔离**:所有 fork 自有文件集中本包,不动上游同名文件
- **R3 hardcode 三禁令**:productName 走 tauri-overrides + `--config`,icon 走 build hook 临时拷贝 + git 恢复,主题色走 CSS overlay
- **R5 上游 contract 假设**:依赖上游不删 `Mark`/`Splash`/`Logo` 三 export 名 + 4 个 css var 名(`--surface-brand-base` / `--text-interactive-base` / `--icon-interactive-base` / `--border-selected`),rebase 后 grep 验证
