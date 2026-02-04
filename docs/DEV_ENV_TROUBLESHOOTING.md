# 开发环境问题排查与修复指南

本文档记录了在 macOS 环境下启动 OpenCode 开发环境时遇到的网络连接问题及其解决方案。

## 1. 问题描述

在启动开发环境（前端 `port 3000`，后端 `port 4096`）后，Web 预览界面报错，无法连接到后端服务：

*   **报错信息**：`net::ERR_ABORTED http://localhost:4096/global/event` 或 `Connection refused`。
*   **现象**：
    *   前端页面加载不完整，文件树无法显示。
    *   浏览器控制台显示大量跨域 (CORS) 或连接中断错误。
*   **原因分析**：
    1.  **IPv6 解析优先级**：macOS 系统中 `localhost` 往往优先解析为 IPv6 地址 `::1`，而 OpenCode 后端服务默认监听在 IPv4 `127.0.0.1`，导致连接被拒绝。
    2.  **跨域资源共享 (CORS)**：前端 (`localhost:3000`) 直接请求后端 (`localhost:4096`) 会触发浏览器的同源策略限制，虽然服务端配置了 CORS，但在某些代理或预览环境下仍不稳定。

## 2. 解决方案

通过配置 Vite 开发服务器的代理（Proxy）功能，将前端 API 请求转发到后端，从而绕过 CORS 限制并强制使用 IPv4 连接。

### 2.1 修改 Vite 配置 (`packages/app/vite.config.ts`)

在 `server.proxy` 中配置相关路径转发到 `http://127.0.0.1:4096`。

```typescript
// packages/app/vite.config.ts

const proxyTarget = {
  target: "http://127.0.0.1:4096",
  changeOrigin: true,
}

export default defineConfig({
  // ... 其他配置
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    proxy: {
      "/global": proxyTarget,
      "/project": proxyTarget,
      "/pty": proxyTarget,
      "/config": proxyTarget,
      "/experimental": proxyTarget,
      "/session": proxyTarget,
      "/permission": proxyTarget,
      "/question": proxyTarget,
      "/provider": proxyTarget,
      "/mcp": proxyTarget,
      "/tui": proxyTarget,
      "/file": proxyTarget,
      "/find": proxyTarget,
      "/auth": proxyTarget,
      "/instance": proxyTarget,
      "/path": proxyTarget,
      "/vcs": proxyTarget,
      "/command": proxyTarget,
      "/log": proxyTarget,
      "/agent": proxyTarget,
      "/skill": proxyTarget,
      "/lsp": proxyTarget,
      "/formatter": proxyTarget,
      "/event": proxyTarget,
      "/doc": proxyTarget,
    },
  },
})
```

### 2.2 修改前端连接逻辑 (`packages/app/src/app.tsx`)

在开发模式下，不再直接连接 `localhost:4096`，而是使用当前页面源（`window.location.origin`），让请求走 Vite 代理。

```typescript
// packages/app/src/app.tsx

// ...
const defaultServerUrl = () => {
  if (props.defaultUrl) return props.defaultUrl
  if (stored) return stored
  if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"
  
  // 修改处：开发环境下使用当前 Origin (走 Proxy)
  if (import.meta.env.DEV)
    return window.location.origin

  return window.location.origin
}
// ...
```

### 2.3 优化 SDK 连接管理 (`packages/app/src/context/global-sdk.tsx`)

增加连接状态日志，并确保组件卸载时正确中止连接。

```typescript
// packages/app/src/context/global-sdk.tsx

// ...
    const abort = new AbortController()
    // 增加日志方便调试
    console.log("[GlobalSDK] Mounted, starting event stream")

    const eventSdk = createOpencodeClient({
      baseUrl: server.url,
      signal: abort.signal,
      fetch: platform.fetch,
    })

    // ...

    onCleanup(() => {
      // 确保卸载时清理资源
      console.log("[GlobalSDK] Unmounted, aborting event stream")
      abort.abort()
      flush()
    })
// ...
```

## 3. 验证方法

1.  启动后端：`bun dev -- serve` (监听 4096)
2.  启动前端：`bun dev` (监听 3000)
3.  使用 `curl` 验证代理是否生效：
    ```bash
    # 直接连接后端 (应成功)
    curl -v http://127.0.0.1:4096/global/health
    
    # 通过前端代理连接后端 (应成功)
    curl -v http://localhost:3000/global/health
    ```
4.  打开浏览器访问 `http://localhost:3000`，检查网络面板（Network Tab），API 请求应为 `200 OK` 且无 CORS 错误。
