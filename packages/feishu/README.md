# Feishu Chat Gateway

本包在当前 Windows 电脑上通过飞书官方 Node SDK 的 WebSocket 长连接接收消息，并在同一进程中使用内嵌 OpenCode 与 DeepSeek 生成最终纯文本回复，不需要公网回调地址，也不会启动额外的 OpenCode HTTP 监听端口。

## 飞书应用设置

在飞书开放平台启用机器人和长连接事件订阅，订阅 `im.message.receive_v1`。应用需要具备接收单聊消息、接收群聊中明确 `@机器人` 的消息以及发送消息的权限，并发布一个测试可用版本。未提及机器人的群聊消息会被静默忽略。

## 本机配置

复制 `.env.example` 为被 Git 忽略的 `.env.local`，填写字段，不要把值写进仓库、日志、截图或问题报告：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_MODEL`，使用 `providerID/modelID`；本机当前验证可用的引用为 `opencode/deepseek-v4-flash-free`
- `FEISHU_DATA_DIRECTORY`，存放网关 SQLite 与降级日志
- `FEISHU_WORKSPACE_DIRECTORY`，OpenCode Session 使用的项目目录
- `FEISHU_MYSQL_HOST`、`FEISHU_MYSQL_PORT`、`FEISHU_MYSQL_DATABASE`、`FEISHU_MYSQL_USER`
- `FEISHU_MYSQL_PASSWORD_FILE`，指向仅保存在本机、内容只有密码的文件
- 可选的 `FEISHU_MYSQL_CONNECT_TIMEOUT_MS`、`FEISHU_MYSQL_QUERY_TIMEOUT_MS`、`FEISHU_MYSQL_MAX_RESULTS`

DeepSeek API Key 继续由 OpenCode 本机认证状态管理，不复制到飞书包。启动预检会确认模型确实解析到 DeepSeek 且认证可用；失败时只报告字段名或净化后的原因，不打印凭据。

库存和货架位置查询只使用经过 schema 预检的 MySQL 固定只读模板，不接受模型生成的 SQL、写操作或任意数据库工具，也不使用 SQL Server 回退。密码只从 `FEISHU_MYSQL_PASSWORD_FILE` 读取。

## 回复格式

明确的库存或位置查询会在调用模型之前进入可信库存服务。回复不包含内部商品编码、表格、标题、开场或总结；多个商品每个占一行。例如：

```text
6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx
```

供应商只使用标准表中的“产地”，并与标准商品名称、规格、型号、备注和货架号一起从当前活动标准视图读取；“产地”为空时省略供应商。展示备注按 `盘点日期；备注` 合并，空白部分自动省略，两个字段都为空时不显示备注。机器人不查询库存来源投影或采购历史来补供应商，也不使用上面的示例名称代填。库存由标准视图对已映射商品读取当前 `Storage` 总量，未映射商品使用标准表数量。

没有结果时回复 `未找到相关商品。`，查询失败时回复 `库存查询失败，请稍后再试。`。

## 启动

在 `packages/feishu` 目录运行：

```powershell
bun run start
```

进程以前台方式保持运行。首版只使用 WebSocket Channel，不配置公网回调。

只运行 DeepSeek 与 MySQL 启动预检、但不连接飞书 Channel：

```powershell
$env:FEISHU_PREFLIGHT_ONLY="true"
bun run start
Remove-Item Env:FEISHU_PREFLIGHT_ONLY
```

显式运行本机 MySQL 契约测试：

```powershell
bun run test:mysql-contract
```

## 标准商品表同步

`商品信息8.3_结构化清洗.xlsx` 是商品名称、供应商（原表“产地”）、规格、型号、盘点日期、备注和货架号的最新标准答案，共 10,572 行。同步工具分别保留盘点日期和源备注，并以 `盘点日期；备注` 生成展示备注；它不会解析或改写日期文本。同步工具不会写 `Storage`，库存始终受保护；它只对确定匹配的老商品备份后更新 `Product.u_Name`、`Product.ProdArea`、`Product.ProdType`、`Product.ProdSpec`、`Product.u_Remark`，并按标准表替换货架关系。缺失或无法唯一匹配的商品只进入标准数据视图，不猜测老商品 ID。

先只读预览，记录输出中的 SHA-256、行数和差异统计；Preview 的 `databaseWrites` 必须为 `0`：

```powershell
bun run standard-product:preview --workbook "D:\opencode\商品信息8.3_结构化清洗.xlsx"
```

仅在预览核对无误后，使用完全相同的文件哈希、行数、三类映射数量和活动版本执行事务同步；首次没有活动版本时传 `NONE`。任一字段、货架、影响行数或 Storage 指纹校验失败都会整笔回滚：

```powershell
bun run standard-product:apply --workbook "D:\opencode\商品信息8.3_结构化清洗.xlsx" --expected-sha256 "预览输出的SHA-256" --expected-row-count 10572 --expected-matched "Preview的MATCHED" --expected-missing "Preview的MISSING" --expected-ambiguous "Preview的AMBIGUOUS" --expected-active-run "Preview的activeRunID或NONE"
bun run standard-product:validate --run-id "Apply输出的runID"
```

需要恢复时必须明确指定该次 `runID`；Rollback 从本次备份恢复商品字段和货架，并重新激活上一版本：

```powershell
bun run standard-product:rollback --run-id "要回滚的runID"
```

## 数据与审计

主任务库位于 `FEISHU_DATA_DIRECTORY` 下。用户消息、最终回答、逐句事件、模型执行和投递状态以追加式事件记录；认证秘密和模型隐藏思考过程不得写入 SQLite、降级日志或控制台。

Agent 始终保持零工具和默认拒绝权限；库存查询由网关在模型之前调用可信服务，不向 Agent 暴露数据库。

只读检查某个 trace 的事件链：

```powershell
$database = Join-Path $env:FEISHU_DATA_DIRECTORY "gateway.sqlite"
bun -e "import { Database } from 'bun:sqlite'; const db = new Database(process.argv[1], { readonly: true }); console.log(JSON.stringify(db.query('SELECT sequence, event_type, actor, status, message_id, sentence_id, sentence_index, parent_event_id, related_event_id FROM gateway_event WHERE trace_id = ? ORDER BY sequence').all(process.argv[2]), null, 2)); db.close()" -- $database "要检查的 trace ID"
```

该命令只以 `readonly: true` 打开 SQLite，用于核对完整消息与逐句事件、状态推进、父子/纠正关联和最终投递证据，不修改历史。
