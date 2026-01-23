# Opencode Base Path 改动说明

## 目标
让 OpenCode 在反向代理的子路径下可用（例如 `/hub_api/opencode/{token}/`），并确保：
- 路由命中 `/:dir/session`
- API 访问不重复前缀
- 本地静态资源可直接加载

## 背景与关键经验
- 旧 UI 版本（例如 1.1.30）**不会使用** `window.__OPENCODE_BASE_URL__` 拼 API，会导致请求打到根路径（如 `/global/health`），在反向代理下直接 404。
- 因此仅更新二进制不够，必须同步最新 `packages/app/dist`，并设置 `OPENCODE_APP_DIR` 指向本地 UI 目录。
## 补丁必要性与后续收敛
### 当前必要性
在官方 `release: v1.1.34`（`c130dd425`）中：
- 前端 `AppInterface` 未读取 `window.__OPENCODE_BASE_URL__`，默认 `baseUrl` 仍是 `window.location.origin`；
- 服务端无 `basePath` 注入/重写逻辑。
因此 **没有本补丁时**，basePath 环境会继续打到根路径并 404。

### 何时可以移除补丁
当官方版本同时满足以下条件时，本补丁可移除：
1. 前端在 `AppInterface` 中使用 `window.__OPENCODE_BASE_URL__` 设置 Router `base` 与 SDK `baseUrl`；  
2. 服务端支持 `basePath` 参数，并在 HTML/JS/CSS 中注入 `<base>` 与 `window.__OPENCODE_BASE_URL__`。

### 快速验收
- 打开页面后 `window.__OPENCODE_BASE_URL__` 有值；
- Network 中 API 路径带 `/hub_api/opencode/<token>/` 前缀；
- 不需要额外前端补丁即可正常打开项目与会话。

## 版本基线（本次固定）
- 官方基线：`release: v1.1.34`（commit `c130dd425`）
- 分支：`mo-release/v1.1.34`
- 本地补丁：
  - `24c58d373`：basePath 逻辑 + 前端 base url 注入
  - `d99db6f8e`：`server.basePath` 配置字段（修复 typecheck）

## 核心改动点

### 1) Server 支持 basePath
- CLI 参数：`--base-path="/hub_api/opencode/<token>"`
- 配置项：`server.basePath`（见 `packages/opencode/src/config/config.ts`）
- 启动入口：`Server.listen(..., basePath)`（见 `packages/opencode/src/server/server.ts`）
- 路由处理：统一 **剥离 basePath** 再路由，避免双前缀

### 2) 静态资源与路径重写
- 当 `OPENCODE_APP_DIR` 存在：优先用本地 `app/dist`
- HTML 注入：
  - `<base href="{basePath}/">`
  - `window.__OPENCODE_BASE_URL__ = "{basePath}"`
- JS/CSS/HTML 中的绝对路径会被重写为带 basePath 前缀

### 3) 前端 Router/SDK 适配
前端读取 `window.__OPENCODE_BASE_URL__`：
- Router `base` 由该值派生
- SDK 默认 `baseUrl = origin + basePath`

### 4) 自动打开项目（目录级路由）
在 `DirectoryLayout` 中自动调用 `layout.projects.open(dir)`，避免手动点击“+”：
```
createEffect(() => {
  if (!server.ready()) return
  const dir = directory()
  if (dir) {
    layout.projects.open(dir)
  }
})
```

### 5) JupyterLab 扩展 URL
JupyterLab 侧使用 base64 编码目录路径，确保 URL 合规：
```
const workDir = btoa('/home/jovyan/work')
this.iframe.url = `${OPENCODE_URL_PREFIX}${res.data.hub_name}/${workDir}/session`
```

## 典型 URL 示例
```
/hub_api/opencode/<token>/L2hvbWUvam92eWFuL3dvcms=/session
/hub_api/opencode/<token>/global/health
/hub_api/opencode/<token>/project
```

## 验证清单
- `global/health` 返回 `healthy: true`
- `project` 返回 worktree 列表
- `/session` 页面路由正确，能自动打开项目
- 发送消息成功（`POST /session/:id/message`）

## 注意事项
- **避免双前缀**：若代理层已加前缀，客户端不要再手动拼接。
- **Token 路由中避免 `=`**：部分 CHP/代理对 `=` 解析不稳，建议使用安全路由（不含 `=`）。
- 当前消息接口是 **长请求**（非 SSE 流式），长任务仍受代理超时影响。
