# AI Developer Platform for GeoComply

## Purpose

This document proposes upgrading geo-code to an AI Developer Platform. The platform adds multi-agent support, multi-provider flexibility, shared tooling, security controls, and detailed usage insights. The goal is to maximize developer productivity while maintaining data security and optimizing costs.

## Background

GeoComply provides AI coding tools through geo-code. geo-code offers Claude Code with Anthropic models hosted on Vertex AI. Data stays within GCP for security. 181 engineers use geo-code today. This represents 100% of engineering.

December 2025 spend was $12,216. November 2025 spend was $8,002. Month-over-month growth was 53%. This growth reflects adoption, not waste. Higher adoption is desirable. The focus should be on impact delivered, not cost incurred.

## Current State

geo-code provides Claude Code and Anthropic models only. It lacks four capabilities:

**No model flexibility.** Engineers use Anthropic models exclusively. Google offers Gemini models at 12% discount through our GCP contract. This discount is unused. Different models suit different tasks. Gemini Flash costs $0.075 per million input tokens. Claude Sonnet costs $3 per million input tokens. Simple tasks do not require expensive models.

**No shared tooling.** Engineers build prompts, skills, and workflows independently. Best practices spread through tribal knowledge. There is no central library of tools. Engineers duplicate effort across teams.

**Limited visibility.** We know who spends how much. We do not know what they build. We cannot identify which workflows drive productivity. We cannot determine which use cases justify investment.

**Basic security controls.** Data stays in GCP through Vertex AI. However, we lack request-level audit logging, PII detection, and model-level access controls. We cannot enforce which providers engineers use. We cannot detect sensitive data in prompts.

## Opportunity

Five users account for 36% of total spend.

| User               | Monthly Cost | Tokens (Millions) |
| ------------------ | ------------ | ----------------- |
| roman@             | $1,045       | 5,052             |
| artaud.irutingabo@ | $988         | 7,400             |
| steven@            | $950         | 5,308             |
| ben.alfordcaplan@  | $868         | 4,923             |
| dan@               | $495         | 2,889             |

These five users spend $4,346 monthly. Claude Premium costs $150 per seat per month. Claude Premium includes unlimited Claude Code access, 225 messages per 5-hour session, 50-95 hours of Sonnet 4 weekly, and 3-7 hours of Opus 4 weekly.

Moving five users to Claude Premium would cost $750 monthly. This saves $3,596 monthly or $43,152 annually. This assumes their usage fits within Premium limits. Validation is required.

Additional savings come from model choice. If engineers choose cheaper models for simple tasks, costs drop. GCP's 12% discount on Gemini adds savings when engineers choose Vertex AI models.

Total optimization opportunity exceeds $50,000 annually.

## Proposal

Build an AI Developer Platform with five components.

**Multiple AI agents.** Support Claude Code, OpenCode, and Cursor. Engineers choose the tool that fits their workflow. OpenCode is open source and extensible. Cursor integrates with VS Code. Choice increases adoption and satisfaction.

**Multiple providers.** Provide access to Anthropic, Google, and OpenAI models. Engineers choose the model that fits their task. Gemini Flash for simple lookups. Claude Sonnet for complex reasoning. The platform provides choice. Engineers make decisions.

**Shared tooling.** Create a central library of skills, MCP servers, and prompt templates. Document best practices from top performers. Distribute proven workflows across teams. Reduce duplicate effort.

**AI Gateway.** Deploy LiteLLM as an observability and security layer. Track usage by user, team, and project. Log all requests for audit. The gateway provides visibility and control, not routing decisions.

**Security layer.** Enforce data residency, audit all requests, detect PII, and control provider access. Engineers authenticate via SSO. No API keys on developer machines. The gateway becomes the single path to AI models.

## Security & Data Control

The gateway provides six security capabilities.

**Data residency.** All requests route through GCP infrastructure. The gateway runs on Cloud Run or GKE. No data leaves approved infrastructure. Vertex AI models process data within GCP boundaries.

**Provider allowlist.** The gateway controls which AI providers engineers can access. Block unauthorized providers. Restrict access to approved models only. Prevent shadow AI usage through unapproved channels.

**Audit logging.** Every request logs user identity, model used, token count, and timestamp. Store logs in BigQuery for analysis. Meet compliance requirements for AI usage tracking. Enable incident investigation.

**PII detection.** Gateway can scan prompts for sensitive data patterns. Warn or block requests containing customer data, credentials, or internal secrets. Reduce data leakage risk. This requires LiteLLM Enterprise or custom implementation.

**Centralized authentication.** Engineers authenticate via Okta or Google Workspace. The gateway exchanges SSO tokens for API access. No API keys stored on developer machines. Revoke access instantly when engineers leave.

**Shadow AI prevention.** The gateway is the only path to AI models. Direct API access is blocked at the network level. All AI usage flows through approved infrastructure. Full visibility into AI consumption.

| Security Capability | Current (geo-code) | Platform                     |
| ------------------- | ------------------ | ---------------------------- |
| Data residency      | Vertex AI only     | Gateway enforces GCP routing |
| Provider control    | Anthropic only     | Allowlist approved providers |
| Audit trail         | Basic GCP logs     | Request-level logging        |
| PII detection       | None               | Gateway guardrails           |
| Key management      | Per-user API keys  | Centralized via SSO          |
| Shadow AI           | Cannot prevent     | Gateway is only path         |

## Framework: Agents and Models

The platform provides a framework of pre-configured agents. Each agent has a default model optimized for its purpose. Engineers choose which agent to use. Engineers can override the model if needed. No automatic routing. Full engineer control.

**How it works:**

```
# Engineer needs deep debugging - chooses debug agent
@debug why is this race condition happening

# Engineer needs fast search - chooses explore agent
@explore where is the authentication middleware

# Engineer needs architecture guidance - chooses oracle agent
@oracle should we use event sourcing here
```

**Pre-configured agents:**

| Agent           | Default Model   | Purpose                | When to Use                        |
| --------------- | --------------- | ---------------------- | ---------------------------------- |
| build           | Claude Sonnet 4 | Code generation        | Writing new code, implementation   |
| debug           | Claude Opus     | Complex debugging      | Hard bugs, root cause analysis     |
| explore         | Gemini Flash    | Fast codebase search   | Finding code, simple lookups       |
| oracle          | GPT-5           | Architecture decisions | Design reviews, system design      |
| reviewer        | Claude Sonnet 4 | Code review            | PR reviews, best practices         |
| fraud-explainer | Claude Sonnet 4 | Fraud rule analysis    | Rule explanation, pattern analysis |
| spec-writer     | Gemini Pro      | Requirements writing   | User stories, specifications       |
| document-writer | Gemini Flash    | Documentation          | README, API docs, release notes    |

**Why this approach:**

Automatic routing is complex and error-prone. Classifying task types is hard. Engineers know their tasks better than any classifier. Black box routing frustrates users.

The framework approach is simple. Engineers learn which agent fits which task. They build muscle memory. They stay in control. The platform provides good defaults. Engineers can override when needed.

**Cost optimization through choice:**

Engineers naturally choose cheaper models for simple tasks when given visibility. The platform shows cost per model. Engineers see their usage. Informed engineers make efficient choices.

| Model           | Cost per 1M Input Tokens | Best For                         |
| --------------- | ------------------------ | -------------------------------- |
| Gemini Flash    | $0.075                   | Search, lookups, simple tasks    |
| Claude Haiku    | $0.25                    | Fast responses, low complexity   |
| Claude Sonnet 4 | $3.00                    | Code generation, reasoning       |
| Gemini Pro      | $1.25                    | Documentation, creative tasks    |
| Claude Opus     | $15.00                   | Complex debugging, architecture  |
| GPT-5           | $10.00                   | Deep reasoning, design decisions |

Top 5 users spend $4,346 monthly. If they choose Gemini Flash for 30% of tasks (searches, lookups), they save approximately $1,200 monthly. This requires no automatic routing. Just visibility and choice.

## Shared Tooling

The platform provides centralized skills and integrations. Engineers stop reinventing common workflows.

**Skills (reusable prompts and workflows):**

| Skill               | Purpose                             | Audience       |
| ------------------- | ----------------------------------- | -------------- |
| doc-writing         | Executive documents, proposals      | All            |
| code-review         | PR review with GeoComply standards  | Engineers      |
| fraud-rule-analysis | Explain and analyze fraud rules     | Fraud Analysts |
| incident-response   | On-call playbook assistance         | Engineers      |
| test-generator      | Generate unit and integration tests | Engineers      |
| api-documenter      | Generate API documentation          | Engineers      |

**MCP Servers (tool integrations):**

| MCP             | Purpose                        | Audience       |
| --------------- | ------------------------------ | -------------- |
| jira            | Create and query Jira tickets  | All            |
| github          | PR management, code search     | Engineers      |
| geocomply-kb    | Internal knowledge base search | All            |
| fraud-detection | Query fraud detection systems  | Fraud Analysts |
| grafana         | Query metrics and logs         | Engineers      |

**Best Practices Library:**

- Document workflows from top performers
- Create templates for common tasks
- Share effective prompts across teams
- Reduce onboarding time for new engineers

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    AI Developer Platform                          │
├──────────────────────────────────────────────────────────────────┤
│  Agents       │ Claude Code │ OpenCode │ Cursor │ Custom         │
├──────────────────────────────────────────────────────────────────┤
│  Framework    │ @build │ @debug │ @explore │ @oracle │ @reviewer │
├──────────────────────────────────────────────────────────────────┤
│  Shared Layer │ Skills • MCPs • Prompts • Best Practices         │
├──────────────────────────────────────────────────────────────────┤
│  Gateway      │ Auth • Audit • PII Detection • Cost Tracking     │
├──────────────────────────────────────────────────────────────────┤
│  Providers    │ Vertex AI (12% off) │ Anthropic │ OpenAI         │
├──────────────────────────────────────────────────────────────────┤
│  Security     │ SSO (Okta/Google) • GCP Data Residency • Audit   │
└──────────────────────────────────────────────────────────────────┘
```

All traffic routes through the gateway. The gateway authenticates users via SSO. Engineers choose which agent and model to use. The gateway logs all requests for audit. Data remains within GCP infrastructure. Engineers have full control over their AI tools.

## Open Questions

**What are top users building?** We know spend distribution. We do not know value creation. Two approaches will reveal high-impact use cases:

1. **Automated project discovery:** Read project metadata from user machines. Parse git repositories, session files, and project directories. Infer project types, technologies, and relevance to GeoComply business. This scales to all users automatically.

2. **Direct interviews:** Talk to top 10 users. Understand their workflows, pain points, and productivity gains. Validate automated findings with qualitative insights.

The automated approach provides breadth. Interviews provide depth. Both are needed.

**Which workflows should we productize?** Some engineers are more efficient than others. Artaud uses $0.13 per million tokens. Tin uses $0.23 per million tokens. Understanding this variance helps identify best practices to share.

**Does Claude Premium fit heavy users?** Premium offers unlimited access within session limits. Heavy users may exceed these limits. Comparing actual usage to Premium limits determines fit.

**What PII patterns need detection?** Fraud analysts work with sensitive data. Define patterns for customer data, credentials, and internal secrets. Determine block vs warn policy.

**Which agents do teams need?** The proposed agents cover common use cases. Teams may need domain-specific agents. Gather requirements during interviews.

## Next Steps

1. Implement automated project discovery to analyze what all users build.
2. Interview top 10 users to understand workflows and productivity impact.
3. Run LiteLLM proof of concept on GCP to validate gateway approach.
4. Compare heavy user patterns against Claude Premium limits.
5. Define PII detection patterns with security team.
6. Present findings and recommendation to leadership.

## Appendix: Data Sources

All data comes from `gen-ai-poc-450621.billing_export` in BigQuery. Tables used:

- `v_user_costs_history`: Monthly costs by user
- `v_daily_costs_history`: Daily spend trends

December 2025 totals: $12,216 across 181 users. Top 10 users account for $5,500 (45% of spend). Remaining 171 users account for $6,716 (55% of spend).
