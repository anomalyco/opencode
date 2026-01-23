# Opencode Base Path 改动说明

## 目标
让 OpenCode 在反向代理的子路径下可用（例如 `/hub_api/opencode/{token}/`），并确保：
- 路由命中 `/:dir/session`
- API 访问不重复前缀
- 本地静态资源可直接加载

## 背景与关键经验
- 旧 UI 版本（例如 1.1.30）**不会使用** `window.__OPENCODE_BASE_URL__` 拼 API，会导致请求打到根路径（如 `/global/health`），在反向代理下直接 404。
- 因此仅更新二进制不够，必须同步最新 `packages/app/dist`，并设置 `OPENCODE_APP_DIR` 指向本地 UI 目录。

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
