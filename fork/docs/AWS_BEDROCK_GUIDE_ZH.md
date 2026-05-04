# AWS Bedrock 配置与使用指南 (OpenCode)

本指南详细介绍了如何在 OpenCode 中配置和使用 Amazon Bedrock 提供的 AI 模型。

## 1. 认证配置

OpenCode 支持多种 AWS 认证方式，最推荐的是使用标准的环境变量。

### 方式 A：临时凭证 (包含 Session Token) - 推荐
如果你使用的是临时安全凭证（例如通过 `aws sts get-session-token` 获取的），请在终端中设置以下环境变量：

```bash
export AWS_ACCESS_KEY_ID="你的访问密钥"
export AWS_SECRET_ACCESS_KEY="你的私有密钥"
export AWS_SESSION_TOKEN="你的会话令牌"
export AWS_REGION="us-east-1" # 或者你模型所在的区域
```

### 方式 B：使用 AWS Profile
如果你已经在本地通过 `aws configure` 配置了 profile，可以直接指定使用哪个 profile：

```bash
export AWS_PROFILE="你的Profile名称"
export AWS_REGION="us-east-1"
```

### 方式 C：Bearer Token (OpenCode 特有)
你也可以直接为 Bedrock 提供者设置专属 Token：
```bash
export AWS_BEARER_TOKEN_BEDROCK="你的Token"
```

---

## 2. 模型指定与切换

在 OpenCode 中，模型的完整标识符格式为：`amazon-bedrock/模型ID`。

### 启动时指定
```bash
opencode --model amazon-bedrock/anthropic.claude-3-5-sonnet-20240620-v1:0
```

### 在 REPL (极简模式) 中切换
进入 OpenCode 后，你可以使用 `/model` 命令：

- **查看当前模型**：仅输入 `/model`
- **切换模型**：`/model amazon-bedrock/模型ID`
- **使用 ARN**：如果需要使用特定的 ARN（如预置吞吐量模型），直接跟在斜杠后面：
  ```text
  /model amazon-bedrock/arn:aws:bedrock:us-east-1:123456789012:provisioned-model/my-model
  ```

---

## 3. 常用 Bedrock 模型 ID 列表

| 模型名称 | 模型 ID (用于配置) |
| :--- | :--- |
| **Claude 3.5 Sonnet** | `anthropic.claude-3-5-sonnet-20240620-v1:0` |
| **Claude 3.5 Haiku** | `anthropic.claude-3-5-haiku-20241022-v1:0` |
| **Claude 3 Opus** | `anthropic.claude-3-opus-20240229-v1:0` |
| **Amazon Nova Pro** | `amazon.nova-pro-v1:0` |
| **Amazon Nova Lite** | `amazon.nova-lite-v1:0` |
| **Amazon Nova Micro** | `amazon.nova-micro-v1:0` |
| **Llama 3.1 70B** | `meta.llama3-1-70b-instruct-v1:0` |

---

## 4. 常见问题排查 (Troubleshooting)

1.  **区域 (Region) 问题**：
    确保 `AWS_REGION` 设置正确。如果未设置，OpenCode 默认尝试 `us-east-1`。
2.  **权限不足**：
    确保你的 IAM 角色/用户拥有 `bedrock:InvokeModel` 和 `bedrock:InvokeModelWithResponseStream` 的权限。
3.  **模型访问未开启**：
    在使用之前，你必须在 AWS 控制台的 **Bedrock -> Model access** 页面手动申请并开启对应模型的访问权限。
4.  **Tab 补全**：
    在我们的 `feat/minimal-tui-style` 分支下，输入 `/model amazon-bedrock/` 后按下 **Tab** 键，系统会自动尝试拉取并补全可用的模型 ID。

---

## 5. 快速检查命令
配置完成后，可以运行以下命令验证认证是否生效：
```bash
opencode providers auth amazon-bedrock
```
如果输出显示已认证或显示了凭证优先级，则说明配置成功。
