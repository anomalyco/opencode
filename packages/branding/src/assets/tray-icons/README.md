# Tray icons — DeskFox 系统托盘图标

四个状态变体(template 模板模式,macOS menu bar 自动适配深浅色):

| 文件 | 状态 | 触发 |
|---|---|---|
| `default.png` | 默认 | 启动 / 飞书未配置 |
| `connected.png` | 已连接 | 飞书账号绑定 + WSS 长连接活跃 |
| `offline.png` | 离线 | WSS 断开重连中 |
| `error.png` | 错误 | OAuth / 鉴权 / 长连接致命错误 |

## v1 占位说明(2026-05-08)

四张 PNG 当前都是 dev/32x32.png 的复制品(占位)。功能侧 tray 切换 API 已通,等设计补 4 张差异化图标后替换即可,代码无需改动。

后续替换要点:
- 32x32 PNG(macOS HiDPI 自动适配)
- macOS 用 template 模式(纯黑 alpha 通道 + 透明背景),系统按菜单栏深浅色反色;Tauri 调 `tray_handle.set_icon_as_template(true)` 启用
- Win / Linux 直接用彩色 PNG
