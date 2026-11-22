# OpenCode Model Providers — API Key Dashboard Directory

This directory maps all **88 model providers** supported in OpenCode (including all major frontier models, cloud AI suites, fast-inference engines, local runtimes, and the "See 70+ more providers" catalog) directly to their official developer console where API keys can be generated or managed.

## Provider Mapping Table

| # | Provider ID | Name | Category | Official API Key / Console URL | Verified | Default Env Var |
|---|-------------|------|----------|---------------------------------|:--------:|------------------|
| 1 | `opencode-go` | **OpenCode Go** | first-party | [https://opencode.ai/console](https://opencode.ai/console) | Yes | `OPENCODE_API_KEY` |
| 2 | `opencode` | **OpenCode Console** | first-party | [https://opencode.ai/console](https://opencode.ai/console) | Yes | `OPENCODE_API_KEY` |
| 3 | `openai` | **OpenAI** | frontier | [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys) | Yes | `OPENAI_API_KEY` |
| 4 | `anthropic` | **Anthropic** | frontier | [https://console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) | Yes | `ANTHROPIC_API_KEY` |
| 5 | `google` | **Google AI Studio (Gemini)** | frontier | [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) | Yes | `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` |
| 6 | `google-vertex` | **Google Cloud Vertex AI** | cloud | [https://console.cloud.google.com/vertex-ai](https://console.cloud.google.com/vertex-ai) | Yes | `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_LOCATION` |
| 7 | `github-copilot` | **GitHub Copilot** | developer | [https://github.com/settings/copilot](https://github.com/settings/copilot) | Yes | `GITHUB_TOKEN`, `GH_TOKEN` |
| 8 | `xai` | **xAI (Grok)** | frontier | [https://console.x.ai](https://console.x.ai) | Yes | `XAI_API_KEY` |
| 9 | `deepseek` | **DeepSeek** | frontier | [https://platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) | Yes | `DEEPSEEK_API_KEY` |
| 10 | `moonshotai` | **Moonshot AI (Kimi)** | frontier | [https://platform.moonshot.cn/console/api-keys](https://platform.moonshot.cn/console/api-keys) | Yes | `MOONSHOT_API_KEY` |
| 11 | `alibaba` | **Alibaba Cloud (Model Studio / DashScope)** | cloud | [https://dashscope.console.aliyun.com/apiKey](https://dashscope.console.aliyun.com/apiKey) | Yes | `DASHSCOPE_API_KEY`, `ALIBABA_API_KEY` |
| 12 | `zai` | **Zhipu AI (GLM / BigModel)** | frontier | [https://bigmodel.cn/usercenter/apikeys](https://bigmodel.cn/usercenter/apikeys) | Yes | `ZAI_API_KEY`, `ZHIPU_API_KEY` |
| 13 | `mistral` | **Mistral AI** | frontier | [https://console.mistral.ai/api-keys](https://console.mistral.ai/api-keys) | Yes | `MISTRAL_API_KEY` |
| 14 | `groq` | **Groq** | fast-inference | [https://console.groq.com/keys](https://console.groq.com/keys) | Yes | `GROQ_API_KEY` |
| 15 | `openrouter` | **OpenRouter** | aggregator | [https://openrouter.ai/keys](https://openrouter.ai/keys) | Yes | `OPENROUTER_API_KEY` |
| 16 | `amazon-bedrock` | **Amazon Bedrock** | cloud | [https://console.aws.amazon.com/bedrock/](https://console.aws.amazon.com/bedrock/) | Yes | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK` |
| 17 | `azure` | **Azure OpenAI Service** | cloud | [https://portal.azure.com/#blade/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/OpenAI](https://portal.azure.com/#blade/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/OpenAI) | Yes | `AZURE_API_KEY`, `AZURE_RESOURCE_NAME` |
| 18 | `minimax` | **MiniMax** | frontier | [https://platform.minimaxi.com/user-center/basic-information/interface-key](https://platform.minimaxi.com/user-center/basic-information/interface-key) | Yes | `MINIMAX_API_KEY` |
| 19 | `xiaomi` | **Xiaomi AI** | cloud | [https://ai.xiaomi.com](https://ai.xiaomi.com) | Yes | `XIAOMI_API_KEY` |
| 20 | `stepfun` | **StepFun (Jieyue Xingchen)** | frontier | [https://platform.stepfun.com/interface-key](https://platform.stepfun.com/interface-key) | Yes | `STEPFUN_API_KEY` |
| 21 | `meta` | **Meta (Llama)** | frontier | [https://llama.meta.com](https://llama.meta.com) | Yes | `META_API_KEY` |
| 22 | `nvidia` | **NVIDIA NIM** | enterprise | [https://build.nvidia.com](https://build.nvidia.com) | Yes | `NVIDIA_API_KEY` |
| 23 | `cerebras` | **Cerebras** | fast-inference | [https://cloud.cerebras.ai](https://cloud.cerebras.ai) | Yes | `CEREBRAS_API_KEY` |
| 24 | `fireworks-ai` | **Fireworks AI** | fast-inference | [https://fireworks.ai/api-keys](https://fireworks.ai/api-keys) | Yes | `FIREWORKS_API_KEY` |
| 25 | `togetherai` | **Together AI** | inference | [https://api.together.ai/settings/api-keys](https://api.together.ai/settings/api-keys) | Yes | `TOGETHER_API_KEY` |
| 26 | `deepinfra` | **Deep Infra** | inference | [https://deepinfra.com/dash/api_keys](https://deepinfra.com/dash/api_keys) | Yes | `DEEPINFRA_API_KEY` |
| 27 | `huggingface` | **Hugging Face** | community | [https://huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) | Yes | `HF_TOKEN`, `HUGGINGFACE_API_KEY` |
| 28 | `perplexity` | **Perplexity AI** | search-augmented | [https://www.perplexity.ai/settings/api](https://www.perplexity.ai/settings/api) | Yes | `PERPLEXITY_API_KEY` |
| 29 | `cohere` | **Cohere** | enterprise | [https://dashboard.cohere.com/api-keys](https://dashboard.cohere.com/api-keys) | Yes | `COHERE_API_KEY` |
| 30 | `vercel` | **Vercel AI Gateway** | gateway | [https://vercel.com/account/tokens](https://vercel.com/account/tokens) | Yes | `VERCEL_API_KEY`, `VERCEL_BEARER_TOKEN` |
| 31 | `cloudflare-workers-ai` | **Cloudflare Workers AI** | edge | [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) | Yes | `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID` |
| 32 | `cloudflare-ai-gateway` | **Cloudflare AI Gateway** | gateway | [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) | Yes | `CLOUDFLARE_API_KEY`, `CLOUDFLARE_GATEWAY_ID` |
| 33 | `gitlab` | **GitLab Duo** | developer | [https://gitlab.com/-/user_settings/personal_access_tokens](https://gitlab.com/-/user_settings/personal_access_tokens) | Yes | `GITLAB_TOKEN` |
| 34 | `baseten` | **Baseten** | inference | [https://app.baseten.co/settings/api_keys](https://app.baseten.co/settings/api_keys) | Yes | `BASETEN_API_KEY` |
| 35 | `nebius` | **Nebius AI Studio** | cloud | [https://console.nebius.ai](https://console.nebius.ai) | Yes | `NEBIUS_API_KEY` |
| 36 | `scaleway` | **Scaleway** | cloud | [https://console.scaleway.com/iam/api-keys](https://console.scaleway.com/iam/api-keys) | Yes | `SCALEWAY_API_KEY` |
| 37 | `venice` | **Venice AI** | privacy | [https://venice.ai/settings/api](https://venice.ai/settings/api) | Yes | `VENICE_API_KEY` |
| 38 | `inception` | **Inception Labs** | inference | [https://inceptionlabs.ai](https://inceptionlabs.ai) | Yes | `INCEPTION_API_KEY` |
| 39 | `morph` | **Morph** | developer | [https://morph.so](https://morph.so) | Yes | `MORPH_API_KEY` |
| 40 | `ollama` | **Ollama (Local)** | local | *(Local / Custom: Local endpoint at http://localhost:11434. No API key needed by default.)* | Yes | `OLLAMA_API_KEY` |
| 41 | `lmstudio` | **LM Studio (Local)** | local | *(Local / Custom: Local endpoint at http://localhost:1234. No API key needed by default.)* | Yes | `LMSTUDIO_API_KEY` |
| 42 | `vllm` | **vLLM (Local / Self-Hosted)** | local | *(Local / Custom: Custom self-hosted OpenAI-compatible endpoint (e.g., http://localhost:8000/v1).)* | Yes | `VLLM_API_KEY` |
| 43 | `databricks` | **Databricks Model Serving** | enterprise | [https://docs.databricks.com/en/dev-tools/auth/pat.html](https://docs.databricks.com/en/dev-tools/auth/pat.html) | Yes | `DATABRICKS_TOKEN`, `DATABRICKS_HOST` |
| 44 | `digitalocean` | **DigitalOcean GenAI** | cloud | [https://cloud.digitalocean.com/account/api/tokens](https://cloud.digitalocean.com/account/api/tokens) | Yes | `DIGITALOCEAN_API_KEY` |
| 45 | `kilo` | **Kilo Gateway** | gateway | [https://kilo.ai](https://kilo.ai) | Yes | `KILO_API_KEY` |
| 46 | `llmgateway` | **LLM Gateway (DevPass)** | gateway | [https://llmgateway.io](https://llmgateway.io) | Yes | `LLMGATEWAY_API_KEY` |
| 47 | `poe` | **Poe** | aggregator | [https://poe.com/api_key](https://poe.com/api_key) | Yes | `POE_API_KEY` |
| 48 | `sap-ai-core` | **SAP AI Core** | enterprise | [https://me.sap.com](https://me.sap.com) | Yes | `SAP_AI_CORE_CLIENT_ID`, `SAP_AI_CORE_CLIENT_SECRET` |
| 49 | `snowflake-cortex` | **Snowflake Cortex** | enterprise | [https://docs.snowflake.com/en/user-guide/snowflake-cortex/llm-functions](https://docs.snowflake.com/en/user-guide/snowflake-cortex/llm-functions) | Yes | `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_PASSWORD` |
| 50 | `zenmux` | **ZenMux** | gateway | [https://zenmux.ai](https://zenmux.ai) | Yes | `ZENMUX_API_KEY` |
| 51 | `modal` | **Modal** | cloud | [https://modal.com/settings](https://modal.com/settings) | Yes | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` |
| 52 | `neon` | **Neon** | cloud | [https://console.neon.tech/app/settings/api-keys](https://console.neon.tech/app/settings/api-keys) | Yes | `NEON_API_KEY` |
| 53 | `replicate` | **Replicate** | inference | [https://replicate.com/account/api-tokens](https://replicate.com/account/api-tokens) | Yes | `REPLICATE_API_TOKEN` |
| 54 | `anyscale` | **Anyscale Endpoints** | inference | [https://console.anyscale.com/credentials](https://console.anyscale.com/credentials) | Yes | `ANYSCALE_API_KEY` |
| 55 | `ai21` | **AI21 Labs** | frontier | [https://studio.ai21.com/account/api-key](https://studio.ai21.com/account/api-key) | Yes | `AI21_API_KEY` |
| 56 | `voyage` | **Voyage AI** | specialized-embeddings | [https://dash.voyageai.com/api-keys](https://dash.voyageai.com/api-keys) | Yes | `VOYAGE_API_KEY` |
| 57 | `hyperbolic` | **Hyperbolic** | fast-inference | [https://app.hyperbolic.xyz/settings](https://app.hyperbolic.xyz/settings) | Yes | `HYPERBOLIC_API_KEY` |
| 58 | `novita` | **Novita AI** | inference | [https://novita.ai/dashboard/key-management](https://novita.ai/dashboard/key-management) | Yes | `NOVITA_API_KEY` |
| 59 | `lambda` | **Lambda Labs** | inference | [https://cloud.lambdalabs.com/api-keys](https://cloud.lambdalabs.com/api-keys) | Yes | `LAMBDA_API_KEY` |
| 60 | `lepton` | **Lepton AI** | inference | [https://dashboard.lepton.ai/credentials](https://dashboard.lepton.ai/credentials) | Yes | `LEPTON_API_KEY` |
| 61 | `chutes` | **Chutes AI** | inference | [https://chutes.ai/app/keys](https://chutes.ai/app/keys) | Yes | `CHUTES_API_KEY` |
| 62 | `siliconflow` | **SiliconFlow (SiliconCloud)** | inference | [https://cloud.siliconflow.cn/account/ak](https://cloud.siliconflow.cn/account/ak) | Yes | `SILICONFLOW_API_KEY` |
| 63 | `upstage` | **Upstage (Solar)** | frontier | [https://console.upstage.ai/api-keys](https://console.upstage.ai/api-keys) | Yes | `UPSTAGE_API_KEY` |
| 64 | `writer` | **Writer** | enterprise | [https://app.writer.com/aistudio/developer](https://app.writer.com/aistudio/developer) | Yes | `WRITER_API_KEY` |
| 65 | `friendli` | **Friendli AI** | fast-inference | [https://suite.friendli.ai/settings/tokens](https://suite.friendli.ai/settings/tokens) | Yes | `FRIENDLI_TOKEN` |
| 66 | `predibase` | **Predibase** | inference | [https://app.predibase.com](https://app.predibase.com) | Yes | `PREDIBASE_API_TOKEN` |
| 67 | `sambanova` | **SambaNova Cloud** | fast-inference | [https://cloud.sambanova.ai/apis](https://cloud.sambanova.ai/apis) | Yes | `SAMBANOVA_API_KEY` |
| 68 | `octoai` | **OctoAI** | inference | [https://octoai.cloud/settings/api-keys](https://octoai.cloud/settings/api-keys) | Yes | `OCTOAI_TOKEN` |
| 69 | `monsterapi` | **MonsterAPI** | inference | [https://monsterapi.ai/user/dashboard](https://monsterapi.ai/user/dashboard) | Yes | `MONSTER_API_KEY` |
| 70 | `aimlapi` | **AI/ML API** | aggregator | [https://aimlapi.com/app/keys](https://aimlapi.com/app/keys) | Yes | `AIMLAPI_API_KEY` |
| 71 | `runpod` | **RunPod** | cloud | [https://www.runpod.io/console/user/settings](https://www.runpod.io/console/user/settings) | Yes | `RUNPOD_API_KEY` |
| 72 | `edenai` | **Eden AI** | aggregator | [https://app.edenai.run/admin/account/settings](https://app.edenai.run/admin/account/settings) | Yes | `EDENAI_API_KEY` |
| 73 | `clarifai` | **Clarifai** | specialized | [https://clarifai.com/settings/security](https://clarifai.com/settings/security) | Yes | `CLARIFAI_PAT` |
| 74 | `assemblyai` | **AssemblyAI** | audio-speech | [https://www.assemblyai.com/app/account](https://www.assemblyai.com/app/account) | Yes | `ASSEMBLYAI_API_KEY` |
| 75 | `cartesia` | **Cartesia** | audio-speech | [https://play.cartesia.ai/keys](https://play.cartesia.ai/keys) | Yes | `CARTESIA_API_KEY` |
| 76 | `deepgram` | **Deepgram** | audio-speech | [https://console.deepgram.com](https://console.deepgram.com) | Yes | `DEEPGRAM_API_KEY` |
| 77 | `elevenlabs` | **ElevenLabs** | audio-speech | [https://elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys) | Yes | `ELEVENLABS_API_KEY` |
| 78 | `volcengine` | **Volcengine (ByteDance Doubao)** | cloud | [https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) | Yes | `VOLCENGINE_API_KEY` |
| 79 | `byteplus` | **BytePlus** | cloud | [https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey) | Yes | `BYTEPLUS_API_KEY` |
| 80 | `nanogpt` | **NanoGPT** | pay-per-request | [https://nano-gpt.com/api](https://nano-gpt.com/api) | Yes | `NANOGPT_API_KEY` |
| 81 | `requesty` | **Requesty** | gateway | [https://app.requesty.ai](https://app.requesty.ai) | Yes | `REQUESTY_API_KEY` |
| 82 | `aihubmix` | **AIHubMix** | aggregator | [https://aihubmix.com/token](https://aihubmix.com/token) | Yes | `AIHUBMIX_API_KEY` |
| 83 | `302ai` | **302.AI** | aggregator | [https://dash.302.ai/gpt/api-key](https://dash.302.ai/gpt/api-key) | Yes | `302AI_API_KEY` |
| 84 | `orcarouter` | **OrcaRouter** | gateway | [https://orcarouter.ai](https://orcarouter.ai) | Yes | `ORCAROUTER_API_KEY` |
| 85 | `cortecs` | **Cortecs** | inference | [https://cortecs.ai](https://cortecs.ai) | Yes | `CORTECS_API_KEY` |
| 86 | `abacus` | **Abacus.AI** | enterprise | [https://abacus.ai/app/api-keys](https://abacus.ai/app/api-keys) | Yes | `ABACUS_API_KEY` |
| 87 | `helicone` | **Helicone** | observability-gateway | [https://us.helicone.ai/developer](https://us.helicone.ai/developer) | Yes | `HELICONE_API_KEY` |
| 88 | `custom` | **Custom OpenAI-Compatible Provider** | custom | *(Local / Custom: Configured in opencode.jsonc with custom baseURL, env, package, and headers.)* | Yes | `CUSTOM_API_KEY` |

## Fallback Strategy for Local and Custom Providers

### 1. Local Model Runtimes (Ollama, LM Studio, vLLM)
- **Ollama**: Default endpoint is `http://localhost:11434`. Runs completely locally; requires no API key or external cloud dashboard.
- **LM Studio**: Default endpoint is `http://localhost:1234/v1`. Enable the local server in LM Studio Developer tab; no API key needed.
- **vLLM / Local Self-Hosted**: Default endpoint typically `http://localhost:8000/v1`. Users specify their custom `baseURL` in `opencode.jsonc`.

### 2. Custom OpenAI & Anthropic Compatible Endpoints
OpenCode supports any custom endpoint via `opencode.jsonc`:
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "my-custom-llm": {
      "name": "My Custom LLM",
      "env": ["MY_CUSTOM_API_KEY"],
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "https://llm.internal.company.com/v1"
      },
      "models": {
        "custom-model": {
          "name": "Custom Model"
        }
      }
    }
  }
}
```
