/**
 * ULTRAWORK - Ultimate AI Orchestration System
 *
 * The most advanced AI orchestration ever built into OpenCode.
 * Claude Opus 4.5 as the supreme brain, coordinating an entire
 * AI federation (ChatGPT, Gemini, Grok, DeepSeek, Qwen, Local GPU)
 * to deliver finished products from plain-language ideas.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    ULTRAWORK ARCHITECTURE                       │
 * │                                                                 │
 * │  USER (plain language) ─► ATLAS (Claude Opus 4.5 Brain)        │
 * │       │                      │                                  │
 * │       │              ┌───────┼───────┐                         │
 * │       │              ▼       ▼       ▼                         │
 * │       │          [ROUTER] [MEMORY] [MODES]                     │
 * │       │              │                                          │
 * │       │    ┌─────────┼─────────┐                               │
 * │       │    ▼         ▼         ▼                               │
 * │       │ [API]     [CLI]   [BROWSER]                            │
 * │       │    │         │         │                               │
 * │       │    ▼         ▼         ▼                               │
 * │       │ Claude    Gemini   ChatGPT.com                         │
 * │       │ OpenAI    Codex    Gemini.com                          │
 * │       │ Gemini    DeepSeek Grok/X.com                          │
 * │       │ DeepSeek           Claude.ai                           │
 * │       │ Qwen               ...                                 │
 * │       │ Grok                                                   │
 * │       │ Local GPU                                              │
 * │       │              │                                          │
 * │       │              ▼                                          │
 * │       │        [SYNTHESIZER]                                    │
 * │       │              │                                          │
 * │       │              ▼                                          │
 * │       │     [AUTONOMOUS LOOP]                                   │
 * │       │     (Ralph Wiggum style)                                │
 * │       │     Keeps going until DONE                              │
 * │       │              │                                          │
 * │       │              ▼                                          │
 * │       └──── FINISHED PRODUCT ◄──────────────────               │
 * │             (fully functional, tested, deployed)                │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * KEY DESIGN PRINCIPLES:
 * 1. ZERO human intervention required after initial idea
 * 2. Autonomous loop runs until success criteria are MET
 * 3. Self-correction: if one AI fails, another takes over
 * 4. Memory: learns from every task, gets better over time
 * 5. Mode switching: auto-transitions between phases
 * 6. Multi-channel: API, CLI, and browser automation
 * 7. Cost-aware: routes to cheapest capable AI
 *
 * INSPIRED BY:
 * - ClawdBot (44K stars) - 24/7 autonomous daemon, 565+ auto-skills
 * - OpenHands (ICLR 2025) - Full software engineer, 53% SWE-Bench
 * - AgenticSeek - Local Manus AI, browser automation
 * - EvoAgentX - Self-evolving multi-agent workflows
 * - Letta/MemGPT (20.8K stars) - 4-layer persistent memory
 * - Roo Code (21.9K stars) - Mode-switching, orchestrator
 * - Ralph Wiggum - Autonomous Claude Code loops
 * - AntiGravity - Rise/Orbit/Verify for non-coders
 * - Cline - MCP integration, human-in-loop
 */

// Core orchestration
export { Atlas } from "./atlas"
export { UltraworkFederation, type FederationMember, type AICapability, type ConnectionType } from "./federation"
export { UltraworkRouter, type TaskAnalysis, type RoutingDecision } from "./router"
export { UltraworkSynthesizer, type SynthesisInput, type SynthesisResult } from "./synthesizer"

// Autonomous execution
export { UltraworkLoop } from "./loop"
export { UltraworkModes, type UltraworkMode, type ModeConfig } from "./modes"

// Learning & persistence
export { UltraworkMemory } from "./memory"
export { UltraworkSkills } from "./skills"

// Browser automation
export { UltraworkBrowser } from "./browser"

/**
 * ULTRAWORK system version
 */
export const ULTRAWORK_VERSION = "1.0.0"

/**
 * Quick reference of which AI handles what:
 *
 * Claude Opus 4.5  => Architecture, orchestration, complex reasoning, security
 * ChatGPT Codex    => Code generation, API integration, documentation
 * Gemini Pro Ultra => Research, multimodal, Google ecosystem, web browsing
 * Grok             => Real-time data, social media, current events
 * DeepSeek         => Algorithm design, math, optimization, reasoning
 * Qwen             => i18n, multilingual, Asian market features
 * Local GPU (5090) => Privacy-sensitive tasks, offline fallback, fast inference
 */
