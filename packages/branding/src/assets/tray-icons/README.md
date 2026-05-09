# Tray icons — DeskFox 系统托盘图标

四个状态变体(template 模板模式,macOS menu bar 自动适配深浅色):

| 文件 | 状态 | 触发 |
|---|---|---|
| `default.png` | 默认 | 启动 / 飞书未配置 |
| `connected.png` | 已连接 | 飞书账号绑定 + WSS 长连接活跃 |
| `offline.png` | 离线 | WSS 断开重连中 |
| `error.png` | 错误 | OAuth / 鉴权 / 长连接致命错误 |

## v2 fox silhouette(2026-05-09)

四张 PNG 当前都是 fox 头廓形(双耳 + 脸三角)的同一图 — 32x32 纯黑 + alpha,macOS template 模式自动反色适配深浅菜单栏。源 SVG 在 `source/icon-tray-template.svg`,从 `OPENCODE-PLAN/品牌设计/SVG/icon-naked.svg` 派生。

Phase 4 接飞书状态联动时再做 4 张差异化(加 dot / 边框等),代码不需要改动。

重新生成 PNG(改 SVG 后):
```sh
cd /Volumes/ExtSSD/OPENCODE-PLAN/品牌设计/_tools && node -e '
const fs = require("fs");
const { Resvg } = require("@resvg/resvg-js");
const svg = fs.readFileSync("../../../opencode-fork/packages/branding/src/assets/tray-icons/source/icon-tray-template.svg");
const dst = "../../../opencode-fork/packages/branding/src/assets/tray-icons";
const buf = new Resvg(svg, { fitTo: { mode: "width", value: 32 }, background: "rgba(0,0,0,0)" }).render().asPng();
for (const name of ["default","connected","offline","error"]) fs.writeFileSync(`${dst}/${name}.png`, buf);
'
```

要点:
- 32x32 PNG(macOS HiDPI 自动适配)
- macOS 用 template 模式(纯黑 alpha 通道 + 透明背景),系统按菜单栏深浅色反色;`tray_handle.set_icon_as_template(true)` 已启用
- Win / Linux 同图(没 template 概念,直接显示黑色 silhouette)
