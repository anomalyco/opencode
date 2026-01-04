```markdown
# Titan Code

![Titan Code Logo](https://via.placeholder.com/800x200.png?text=Titan+Code+-+Your+AI+Workforce+Agent)
*(Replace this placeholder with your actual logo once generated – something epic with a titan + terminal vibe)*

**Titan Code** is an open-source terminal-based AI agent that goes beyond coding. Switch between **50+ job roles** (Software Engineer, Product Manager, UX Designer, Data Analyst, Marketer, and more) to build your virtual startup team.

Forked from the awesome [OpenCode](https://github.com/anomalyco/opencode) and enhanced with role-switching superpowers. Perfect for solo founders, bootstrapped teams, or anyone who needs an AI that can wear multiple hats.

---

## Why Titan Code?

- **Role Switching**: Use `/role software_engineer` for full coding power, `/role product_manager` for planning and research (with safe tools only), and so on.
- **Strict Boundaries**: Ask something outside the current role? It rejects and tells you to switch – keeps things professional and focused.
- **BYOK Everything**: Bring your own keys for any model (Claude, Gemini, Grok, OpenAI, local Ollama) + tools like web search.
- **Startup-Friendly**: Non-coding roles get useful tools (web search, planning outputs) without risky file edits.
- **100% Open Source**: No lock-in, runs locally, privacy-first.

*Early stage project – actively building more roles, smarter tool permissions, and weak-model optimizations.*

---

## Installation (Same as OpenCode for now – builds to `titancode` binary soon)

```bash
# YOLO install
curl -fsSL https://opencode.ai/install | bash
```

After install, rename or alias the binary to `titancode` if you want, or build from source:

```bash
git clone https://github.com/Restorationmichael4/titancode.git
cd titancode
# (Go build instructions coming – for now use the official binary)
```

---

## Quick Start

Launch it:
```bash
opencode  # or titancode once built
```

Inside the TUI:
- `/role list` → See available roles (adding more daily)
- `/role software_engineer` → Full dev mode
- `/role product_manager` → Research + planning mode

---

## Built-in Roles (More coming!)

- **Software Engineer** (full tools: edit, shell, git)
- **Product Manager** (web search, planning – no code edits)
- **UX Designer** (research, wireframe ideas)
- **Data Analyst**
- **Marketing Specialist**
- And 40+ more on the way...

---

## Planned Features

- 50+ detailed job roles with custom prompts & tool permissions
- Web search tool (Tavily BYOK + free DuckDuckGo fallback)
- Custom role creation
- Multi-role sessions (PM + Engineer collaborating in tabs)
- Better support for local/weak models

---

## Community

Follow progress on X: [@titan_griid](https://x.com/titan_griid)
*(Community Discord coming soon – suggestions welcome!)*

Contributions super welcome – issues, PRs, role ideas, anything!

---

## License

*This project is open source. Please refer to the LICENSE file in the repository for more details.*

Built with passion because startups deserve an AI team they can afford. Let's ship 🚀
```
