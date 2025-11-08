# OpenRouter Integration - 400+ AI Models Available 🚀

OpenCode now has full integration with OpenRouter, giving you access to over 400 AI models through a single, unified API!

## 🎯 What is OpenRouter?

OpenRouter is a unified API gateway that provides access to the latest and greatest AI models from all major providers:
- **OpenAI** (GPT-5, GPT-4.1, GPT-4o)
- **Anthropic** (Claude 4.5 Sonnet, Claude 4.1 Opus, Claude 4 Haiku)
- **xAI** (Grok 4 Fast)
- **Google** (Gemini 2.5 Pro, Gemini 2.0 Flash)
- **Meta** (Llama 4, Llama 3.3)
- **DeepSeek** (DeepSeek R1, DeepSeek Chat V3)
- **Qwen**, **Mistral**, and many more!

### Key Benefits

✅ **One API Key** - Access all models with a single API key
✅ **Automatic Fallback** - If one provider is down, OpenRouter automatically switches to another
✅ **Free Models** - Many high-quality models available at zero cost
✅ **Latest Models** - Access to cutting-edge models as soon as they're released
✅ **No Rate Limits** - No strict rate limits like individual providers
✅ **Cost Optimization** - Automatically routes to the most cost-effective providers

---

## 🌟 Flagship Models (2025)

These are the latest and most powerful AI models available:

### **GPT-5** (Released August 2025)
- **Model ID**: `openai/gpt-5`
- **Context**: 400,000 tokens
- **Cost**: $1.25 input / $10 output per 1M tokens
- **Best for**: General tasks, reasoning, complex problem-solving
- **Highlights**: 94.6% on AIME 2025 math, 74.9% SWE-bench

### **Claude 4.5 Sonnet** (Released September 2025)
- **Model ID**: `anthropic/claude-4.5-sonnet-20250929`
- **Context**: 200,000 tokens
- **Cost**: $3 input / $15 output per 1M tokens
- **Best for**: **CODING** (best coding model in the world!)
- **Highlights**: 77.2% SWE-bench (82% with parallel compute)

### **Claude 4.1 Opus** (Released August 2025)
- **Model ID**: `anthropic/claude-4.1-opus`
- **Context**: 200,000 tokens
- **Cost**: $15 input / $75 output per 1M tokens
- **Best for**: Most complex tasks, autonomous workflows
- **Highlights**: Hybrid reasoning, 74.5% SWE-bench

### **Grok 4 Fast** (Released July 2025)
- **Model ID**: `x-ai/grok-4-fast`
- **Context**: 256,000 tokens
- **Cost**: $2 input / $10 output per 1M tokens
- **Best for**: Fast inference, multimodal generation
- **Highlights**: 98% HumanEval, video generation capability

### **Gemini 2.5 Pro** (Released March 2025)
- **Model ID**: `google/gemini-2.5-pro`
- **Context**: 1,000,000 tokens (largest context window!)
- **Cost**: $1.25 input / $5 output per 1M tokens
- **Best for**: Massive documents, long-form analysis
- **Highlights**: 1M token context - analyze 1,500 page documents!

---

## 🆓 Free Models

These models are completely free to use (with opt-in to data training):

### **DeepSeek R1** - Best Free Model
- **Model ID**: `deepseek/deepseek-r1:free`
- **Context**: 164,000 tokens
- **Parameters**: 671 billion (37B active)
- **Best for**: Reasoning, complex problem-solving
- **Highlights**: State-of-the-art reasoning at zero cost!

### **DeepSeek Chat V3** - Best Free Coding Model
- **Model ID**: `deepseek/deepseek-chat-v3-0324:free`
- **Context**: 64,000 tokens
- **Best for**: Coding tasks
- **Highlights**: Excellent coding performance, completely free

### **Gemini 2.0 Flash**
- **Model ID**: `google/gemini-2.0-flash:free`
- **Context**: 1,000,000 tokens
- **Best for**: Fast inference with massive context

### **Llama 3.3 70B Instruct**
- **Model ID**: `meta-llama/llama-3.3-70b-instruct:free`
- **Context**: 128,000 tokens
- **Best for**: General tasks, instruction following

### **Llama 4 Maverick**
- **Model ID**: `meta-llama/llama-4-maverick:free`
- **Context**: 128,000 tokens
- **Best for**: Latest from Meta

### **Qwen QwQ 32B**
- **Model ID**: `qwen/qwq-32b:free`
- **Context**: 32,768 tokens
- **Best for**: Reasoning tasks

---

## 🚀 Quick Start

### 1. Get Your API Key

Visit [https://openrouter.ai/keys](https://openrouter.ai/keys) and create a free account to get your API key.

### 2. Configure OpenCode

```bash
# Interactive setup
opencode openrouter login

# Or set environment variable
export OPENROUTER_API_KEY="sk-or-v1-..."
```

### 3. Start Using Models

```bash
# Use GPT-5
opencode run --model openrouter/gpt-5 "explain quantum computing"

# Use Claude 4.5 Sonnet (best for coding)
opencode run --model openrouter/claude-4.5-sonnet "fix bugs in app.ts"

# Use a free model
opencode run --model openrouter/deepseek-r1 "solve this math problem"

# Use with file attachments
opencode run --model openrouter/claude-4.1-opus --file code.ts "review this code"
```

---

## 📚 Browsing Models

### List All Models

```bash
# Browse all 400+ models interactively
opencode openrouter models

# Show only flagship models
opencode openrouter flagship

# Show only free models
opencode openrouter free
```

### Get Model Information

```bash
# Get detailed info about a specific model
opencode openrouter info gpt-5
opencode openrouter info claude-4.5-sonnet
opencode openrouter info deepseek-r1
```

### View in CLI

```bash
# See quick overview with flagship models
opencode openrouter
```

---

## 💡 Use Cases & Recommendations

### For Coding (Best → Good)
1. **Claude 4.5 Sonnet** - Best coding model (77.2% SWE-bench)
2. **GPT-5** - Excellent general coding (74.9% SWE-bench)
3. **Claude 4.1 Opus** - Complex refactoring
4. **DeepSeek Chat V3** - Best free coding model

### For Reasoning & Math
1. **GPT-5** - 94.6% AIME 2025
2. **DeepSeek R1** - Best free reasoning model
3. **Claude 4.1 Opus** - Hybrid reasoning
4. **Grok 4 Fast** - Fast reasoning

### For Long Documents
1. **Gemini 2.5 Pro** - 1M token context
2. **Gemini 2.0 Flash** - 1M token context (free!)
3. **Grok 4 Fast** - 256k context

### For Cost Optimization
1. **DeepSeek R1** - Free, state-of-the-art reasoning
2. **DeepSeek Chat V3** - Free, great for coding
3. **Gemini 2.0 Flash** - Free with massive context
4. **GPT-5 Mini** - $0.15/$0.60 per 1M tokens

---

## 🎨 Model Comparison

| Model | Context | Input $ | Output $ | SWE-bench | Best For |
|-------|---------|---------|----------|-----------|----------|
| **GPT-5** | 400k | $1.25 | $10 | 74.9% | General, Reasoning |
| **Claude 4.5 Sonnet** | 200k | $3 | $15 | 77.2% | **CODING** |
| **Claude 4.1 Opus** | 200k | $15 | $75 | 74.5% | Complex Tasks |
| **Grok 4 Fast** | 256k | $2 | $10 | - | Fast, Multimodal |
| **Gemini 2.5 Pro** | 1M | $1.25 | $5 | 59.6% | Long Documents |
| **DeepSeek R1** | 164k | FREE | FREE | - | Reasoning (Free) |
| **DeepSeek Chat V3** | 64k | FREE | FREE | - | Coding (Free) |

---

## 🔧 Advanced Features

### Caching (Anthropic Models)

Claude models support prompt caching to reduce costs:

```bash
# Cache read: $0.3 per 1M tokens (10x cheaper!)
# Cache write: $3.75 per 1M tokens
opencode run --model openrouter/claude-4.5-sonnet \
  --file large-codebase.ts \
  "explain this code"
```

### Multimodal Input

Many models support images, PDFs, audio, and video:

```bash
# Image analysis
opencode run --model openrouter/gpt-5 \
  --file screenshot.png \
  "what's in this image?"

# PDF analysis
opencode run --model openrouter/claude-4.5-sonnet \
  --file document.pdf \
  "summarize this document"
```

### Tool Calling

All flagship models support function/tool calling for agent workflows.

---

## 💰 Pricing Tips

1. **Use Free Models First**: DeepSeek R1 and Chat V3 are surprisingly good
2. **Enable Caching**: For repeated queries on the same content
3. **Right-Size Your Model**: Don't use Opus when Sonnet will do
4. **Watch Context Windows**: Larger contexts = higher costs
5. **Consider GPT-5 Mini**: Often 8x cheaper than GPT-5

---

## 📊 Model Categories

### By Capability
- **Reasoning**: GPT-5, DeepSeek R1, Qwen QwQ 32B
- **Coding**: Claude 4.5 Sonnet, GPT-5, Claude 4.1 Opus
- **Vision**: GPT-5, Grok 4, Gemini 2.5 Pro
- **Long Context**: Gemini 2.5 Pro (1M), Grok 4 (256k)
- **Fast**: Grok 4 Fast, Claude 4.5 Haiku, GPT-5 Mini

### By Provider
- **OpenAI**: GPT-5, GPT-5 Mini, GPT-4.1 Mini, GPT-4o
- **Anthropic**: Claude 4.5 Sonnet, Claude 4.1 Opus, Claude 4.5 Haiku
- **xAI**: Grok 4 Fast
- **Google**: Gemini 2.5 Pro, Gemini 2.0 Flash
- **Meta**: Llama 4 Maverick, Llama 3.3 70B
- **DeepSeek**: DeepSeek R1, DeepSeek Chat V3, DeepSeek R1 Distill
- **Qwen**: Qwen QwQ 32B

---

## 🆘 Troubleshooting

### API Key Issues
```bash
# Check if API key is set
echo $OPENROUTER_API_KEY

# Re-configure
opencode openrouter login
```

### Model Not Found
```bash
# List all available models
opencode openrouter models

# Check model info
opencode openrouter info <model-name>
```

### Rate Limits
OpenRouter automatically handles rate limits by failing over to alternative providers.

---

## 🔗 Useful Links

- **OpenRouter Dashboard**: https://openrouter.ai
- **Get API Keys**: https://openrouter.ai/keys
- **Model Rankings**: https://openrouter.ai/rankings
- **Documentation**: https://openrouter.ai/docs
- **Pricing**: https://openrouter.ai/models

---

## 📝 Examples

### Example 1: Code Review with Claude 4.5 Sonnet

```bash
opencode run --model openrouter/claude-4.5-sonnet \
  --file src/**/*.ts \
  "review this codebase and suggest improvements"
```

### Example 2: Math Problem with Free Model

```bash
opencode run --model openrouter/deepseek-r1 \
  "solve: what is the integral of x^2 * sin(x) dx?"
```

### Example 3: Long Document Analysis

```bash
opencode run --model openrouter/gemini-2.5-pro \
  --file report.pdf \
  "extract key insights and create a summary"
```

### Example 4: Image Description

```bash
opencode run --model openrouter/gpt-5 \
  --file diagram.png \
  "explain what's happening in this diagram"
```

### Example 5: Use Alias for Quick Access

```bash
# Create an alias
opencode alias add gpt5 "run --model openrouter/gpt-5"

# Use it
opencode gpt5 "your prompt here"
```

---

## 🎉 Summary

OpenRouter integration brings **400+ AI models** to OpenCode, including:

✅ Latest flagship models (GPT-5, Claude 4.5, Grok 4, Gemini 2.5 Pro)
✅ Multiple high-quality free models
✅ Automatic fallback and load balancing
✅ Cost optimization
✅ Single API key for everything

**Get started now:**
```bash
opencode openrouter login
opencode openrouter models
opencode run --model openrouter/claude-4.5-sonnet "hello world"
```

🚀 **Enjoy the best AI models in the world through OpenCode!**
