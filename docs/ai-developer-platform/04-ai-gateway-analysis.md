# AI Gateway Analysis: Open Source Options

## Overview

An AI Gateway (LLM Proxy) sits between your applications and LLM providers, providing:

- Unified API interface
- Authentication & authorization
- Rate limiting & quotas
- Cost tracking
- Audit logging
- Load balancing & failover
- Caching

## Comparison Matrix

| Feature               | LiteLLM     | Portkey          | Kong AI Gateway | OpenRouter |
| --------------------- | ----------- | ---------------- | --------------- | ---------- |
| **Self-hosted**       | Yes         | Yes (Enterprise) | Yes             | No         |
| **Open Source**       | MIT License | Partial          | Apache 2.0      | No         |
| **Setup Complexity**  | Low         | Medium           | High            | N/A        |
| **Provider Support**  | 100+        | 50+              | 20+             | 100+       |
| **OpenAI Compatible** | Yes         | Yes              | Yes             | Yes        |
| **SSO Support**       | Enterprise  | Yes              | Yes             | No         |
| **Cost Tracking**     | Yes         | Yes              | Yes             | Yes        |
| **Caching**           | Yes         | Yes              | Yes             | Yes        |
| **Rate Limiting**     | Yes         | Yes              | Yes             | Yes        |
| **Streaming**         | Yes         | Yes              | Yes             | Yes        |

## Detailed Analysis

### 1. LiteLLM (Recommended for PoC)

**GitHub**: https://github.com/BerriAI/litellm  
**Stars**: 33k+  
**License**: MIT (core) + Enterprise features

#### Pros

- **Easiest setup** - Single Docker container
- **100+ providers** - Comprehensive coverage
- **OpenAI-compatible** - Drop-in replacement
- **Active development** - ~1000+ contributors
- **Python SDK** - Easy customization
- **Built-in UI** - Admin dashboard included
- **Cost tracking** - Per-user/team/project

#### Cons

- Enterprise features (SSO, advanced auth) require license
- Python-based (may need tuning for high scale)
- UI is basic compared to Portkey

#### Best For

- Quick PoC and evaluation
- Small to medium teams
- Organizations comfortable with Python

#### Pricing

- **Open Source**: Free (MIT)
- **Enterprise**: Contact for pricing

### 2. Portkey

**Website**: https://portkey.ai  
**License**: Proprietary (self-hosted available for enterprise)

#### Pros

- **Polished UI** - Best admin interface
- **Advanced observability** - Detailed analytics
- **Guardrails** - PII detection, content filtering
- **Semantic caching** - Intelligent deduplication
- **Prompt management** - Version control for prompts

#### Cons

- Self-hosted requires enterprise license
- Cloud-first approach
- More complex setup

#### Best For

- Teams needing advanced observability
- Organizations with compliance requirements
- Those willing to pay for polish

#### Pricing

- **Cloud**: Free tier + usage-based
- **Enterprise**: Custom pricing for self-hosted

### 3. Kong AI Gateway

**Website**: https://konghq.com  
**GitHub**: https://github.com/Kong/kong  
**License**: Apache 2.0

#### Pros

- **Enterprise-grade** - Battle-tested at scale
- **Plugin ecosystem** - Extensive customization
- **Multi-protocol** - REST, GraphQL, gRPC
- **Existing Kong users** - Natural extension

#### Cons

- **Complex setup** - Steeper learning curve
- **Overkill for just AI** - Full API gateway
- **AI features newer** - Less mature than core

#### Best For

- Organizations already using Kong
- High-scale deployments (10k+ RPS)
- Multi-protocol requirements

#### Pricing

- **Open Source**: Free (Apache 2.0)
- **Enterprise**: Custom pricing

### 4. Custom Implementation

Build your own using OpenAI SDK + middleware.

#### Pros

- **Full control** - Exactly what you need
- **No vendor lock-in** - Own the code

#### Cons

- **Development time** - 2-4 weeks minimum
- **Maintenance burden** - Ongoing updates
- **Feature parity** - Hard to match existing solutions

#### Best For

- Unique requirements not met by existing solutions
- Organizations with strong engineering capacity

## Recommendation

### For PoC: LiteLLM

**Reasons**:

1. **5-minute setup** with Docker
2. **MIT licensed** - no vendor lock-in
3. **OpenAI-compatible** - works with OpenCode immediately
4. **Database included** - PostgreSQL for persistence
5. **UI dashboard** - visual management

### For Production

| Scenario         | Recommendation                        |
| ---------------- | ------------------------------------- |
| < 100 users      | LiteLLM Open Source                   |
| 100-1000 users   | LiteLLM Enterprise or Portkey         |
| > 1000 users     | Kong AI Gateway or LiteLLM Enterprise |
| Existing Kong    | Kong AI Gateway                       |
| Compliance-heavy | Portkey Enterprise                    |

## Feature Deep Dive

### Provider Support

LiteLLM supports these providers (partial list):

```
OpenAI          Azure OpenAI     Anthropic       Google (Gemini/Vertex)
AWS Bedrock     Cohere          Mistral         Groq
Together AI     Replicate       HuggingFace     Ollama (local)
DeepInfra       Fireworks       Perplexity      xAI (Grok)
```

### Authentication Options

| Method     | LiteLLM    | Portkey | Kong |
| ---------- | ---------- | ------- | ---- |
| API Keys   | Yes        | Yes     | Yes  |
| JWT/Bearer | Yes        | Yes     | Yes  |
| OIDC/SSO   | Enterprise | Yes     | Yes  |
| mTLS       | Manual     | Yes     | Yes  |

### Caching Strategies

| Type        | Description                   | Best For          |
| ----------- | ----------------------------- | ----------------- |
| Exact Match | Same prompt = cached response | Repeated queries  |
| Semantic    | Similar prompts use cache     | Cost optimization |
| TTL-based   | Time-limited cache            | Fresh data needs  |

LiteLLM supports exact match caching. Portkey offers semantic caching.

### Rate Limiting

LiteLLM rate limiting options:

- Per API key
- Per user
- Per team
- Per model
- Global

Example config:

```yaml
litellm_settings:
  max_parallel_requests: 100

general_settings:
  user_api_key_cache_ttl: 300

router_settings:
  routing_strategy: "simple-shuffle" # or "least-busy", "latency-based"
```

## Migration Path

### Starting with LiteLLM

1. **Week 1**: Deploy LiteLLM, test with single model
2. **Week 2-3**: Add more models, test failover
3. **Week 4**: Integrate with OpenCode
4. **Week 5-6**: Add monitoring, tune performance

### Scaling Up

If LiteLLM hits limits:

1. Add Redis for distributed caching
2. Deploy multiple proxy instances behind load balancer
3. Consider LiteLLM Enterprise for SSO
4. Evaluate Kong if need > 10k RPS

## Cost Comparison

| Solution           | Setup Cost | Monthly Cost (100 users) |
| ------------------ | ---------- | ------------------------ |
| LiteLLM OSS        | $0         | ~$50 (hosting)           |
| LiteLLM Enterprise | Contact    | Contact + hosting        |
| Portkey Cloud      | $0         | ~$99 + usage             |
| Kong AI Gateway    | $0         | ~$100 (hosting)          |

_Costs exclude LLM API costs which are passed through_

## Security Considerations

### LiteLLM Security

```yaml
# Recommended security settings
general_settings:
  master_key: ${LITELLM_MASTER_KEY} # Required

litellm_settings:
  drop_params: true # Don't log sensitive params

# Enable key hashing
environment_variables:
  LITELLM_SALT_KEY: ${SALT_KEY} # For API key encryption
```

### Network Security

1. **Internal only**: Gateway should not be public
2. **TLS termination**: At load balancer or gateway
3. **Network policies**: Restrict egress to LLM providers only

## Observability

### Metrics to Track

| Metric                        | Purpose         |
| ----------------------------- | --------------- |
| Request latency (P50/P95/P99) | Performance     |
| Token usage per user          | Cost allocation |
| Error rate by model           | Reliability     |
| Cache hit rate                | Efficiency      |
| Active users                  | Adoption        |

### Logging Integrations

LiteLLM supports:

- Langfuse (recommended for LLM-specific)
- Datadog
- Prometheus + Grafana
- Custom webhooks

## Conclusion

**Start with LiteLLM** for your PoC:

- Fastest path to working gateway
- Full OpenCode compatibility
- Easy to migrate if needed later

See [PoC Guide: LiteLLM](./05-poc-litellm.md) for step-by-step setup instructions.
