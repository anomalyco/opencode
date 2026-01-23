# OpenCode 本地 Docker 测试（opencode-test）

## 目的
在本地 Docker 容器中验证：
- basePath 路由与静态资源
- 项目自动打开与会话创建
- 消息请求正常返回

## 环境要求
- Node >= 20.19（本机可用 `v20.19.4`）
- Bun（建议 >= 1.3.x）
- Docker
- 容器名：`opencode-test`

## 构建与同步

### 1) 安装依赖（仓库根）
```
cd /Users/zhaofengli/projects/goldersgreen/pyserver/jupyterhub/base-notebook-tf211py39/opencode-src
PATH=/Users/zhaofengli/.nvm/versions/node/v20.19.4/bin:$PATH bun install
```

### 2) 构建前端
```
cd /Users/zhaofengli/projects/goldersgreen/pyserver/jupyterhub/base-notebook-tf211py39/opencode-src/packages/app
PATH=/Users/zhaofengli/.nvm/versions/node/v20.19.4/bin:$PATH bun run build
```

### 3) 构建服务端（二进制）
```
cd /Users/zhaofengli/projects/goldersgreen/pyserver/jupyterhub/base-notebook-tf211py39/opencode-src/packages/opencode
PATH=/Users/zhaofengli/.nvm/versions/node/v20.19.4/bin:$PATH bun run script/build.ts
```

### 4) 同步到容器
```
docker cp packages/opencode/dist/opencode-linux-arm64/bin/opencode opencode-test:/home/jovyan/.opencode/bin/opencode
docker exec opencode-test chmod +x /home/jovyan/.opencode/bin/opencode
docker cp packages/app/dist/. opencode-test:/home/jovyan/.opencode/app/
```

## 启动服务
```
docker exec -d opencode-test sh -c 'cd /home/jovyan/work && OPENCODE_APP_DIR=/home/jovyan/.opencode/app /home/jovyan/.opencode/bin/opencode serve --port=14097 --hostname=0.0.0.0 --base-path="/hub_api/opencode/test-token"'
```

## 验证
```
curl -sS http://127.0.0.1:14097/hub_api/opencode/test-token/global/health
curl -sS http://127.0.0.1:14097/hub_api/opencode/test-token/project
```

浏览器访问：
```
http://127.0.0.1:14097/hub_api/opencode/test-token/L2hvbWUvam92eWFuL3dvcms=/session
```

## 常见问题
- **Node 版本过低**：Vite 7 需要 >= 20.19。
- **依赖缺失**：未执行 `bun install` 会报 `@solid-primitives/i18n` 等依赖缺失。
