# OpenCode Demo Script
## 5-Minute Live Demonstration

**Audience**: Christian Schaub, Michael Halbherr, ETH validators
**Duration**: 5 minutes (can expand to 10 with Q&A)
**Format**: Live terminal + narration

---

## **Setup (Before Demo Starts)**

### Terminal Setup
- Full screen terminal (maximize for screen share)
- Clean prompt (no clutter)
- Font size: 16-18pt for readability
- OpenCode CLI already installed and configured

### Key Demo Files
- `demo_code.py` - Sample Python file with intentional bugs
- `large_document.txt` - Sample document for analysis
- Swiss flag ASCII art ready to show

---

## **SCRIPT: 5-Minute Version**

### **[0:00 - 0:30] Opening Hook**

**Narrator**:
> "I'm going to show you Switzerland's answer to US AI dominance. Watch as I access the world's most powerful AI models while keeping every byte of data in Switzerland. And it costs 20 times less than the competition."

**Terminal Action**:
```bash
# Show OpenCode banner
opencode --version

# Show available models
opencode openrouter
```

**Key Visual**:
- Beautiful CLI with Swiss-styled output
- List of flagship models (GPT-5, Claude 4.5, Grok 4, Gemini 2.5)
- Free models highlighted in green

---

### **[0:30 - 1:30] Demonstration 1: Code Analysis (Swiss Sovereignty)**

**Narrator**:
> "Let's start with a real coding task. I have a Python file with bugs. Watch how OpenCode uses Claude 4.5 Sonnet - the world's best coding model - to fix it."

**Terminal Action**:
```bash
# Show the buggy code
cat demo_code.py

# Fix it with Claude 4.5 Sonnet
opencode run --model openrouter/claude-4.5-sonnet --file demo_code.py \
  "Fix all bugs and add error handling"
```

**Key Visual**:
- Watch the progress indicators (our beautiful spinners!)
- See the AI analyze and fix the code in real-time
- Show the final corrected code

**Narrator**:
> "Notice the speed. Notice the quality. And notice that if I wanted, I could route this through Swiss servers exclusively. No US data jurisdiction. No CLOUD Act risks. Pure Swiss sovereignty."

---

### **[1:30 - 2:30] Demonstration 2: Multi-Model Strategy**

**Narrator**:
> "But here's what makes OpenCode different. I'm not locked into one model. Watch me switch to a FREE model for the same task."

**Terminal Action**:
```bash
# Show free models
opencode openrouter free

# Use FREE DeepSeek R1 for the same task
opencode run --model openrouter/deepseek-r1 \
  "Explain the security implications of this code" --file demo_code.py
```

**Key Visual**:
- List of free models in a beautiful table
- Watch DeepSeek R1 analyze the code (at zero cost!)

**Narrator**:
> "That analysis? Completely free. DeepSeek R1 has 671 billion parameters and costs zero. Compare that to Claude Code at $200 per month."

---

### **[2:30 - 3:30] Demonstration 3: Enterprise Scale (Long Context)**

**Narrator**:
> "Now let's do something enterprise-grade. Analyzing a 100-page document with Gemini 2.5 Pro's 1 million token context window."

**Terminal Action**:
```bash
# Show document size
wc -w large_document.txt

# Analyze with Gemini 2.5 Pro
opencode run --model openrouter/gemini-2.5-pro --file large_document.txt \
  "Summarize the key risks and create an action plan"
```

**Key Visual**:
- Watch it process a massive document
- See the structured output with our rich UI (boxes, formatting)

**Narrator**:
> "1 million tokens. That's 1,500 pages of text. And it costs $1.25 per million input tokens. Try doing that with GitHub Copilot."

---

### **[3:30 - 4:00] Demonstration 4: Developer Experience**

**Narrator**:
> "Let me show you the developer experience. Shell completions, aliases, interactive setup."

**Terminal Action**:
```bash
# Show shell completion (type and press tab)
opencode [TAB]  # Shows all commands

# Show alias system
opencode alias list

# Show beautiful help
opencode openrouter flagship
```

**Key Visual**:
- Tab completion in action
- Beautiful formatted tables and boxes
- Professional, polished UI

**Narrator**:
> "This isn't a prototype. This is production-ready. I built this in 3 days."

---

### **[4:00 - 5:00] Closing: The Strategic Play**

**Terminal Action**:
```bash
# Show the Swiss sovereignty configuration
cat ~/.opencode/config.json

# Display system info
opencode setup
```

**Narrator**:
> "Here's what makes this strategic:
>
> **First**: 400+ models. You choose. You're never locked in.
>
> **Second**: Swiss sovereignty. Every byte can stay in Switzerland.
>
> **Third**: Cost. We're talking $0 to $50 per month vs $100-200 for competitors.
>
> **Fourth**: Speed. I built this in 3 days. That's our execution advantage.
>
> The big tech companies will eventually build this. But we have a 12-18 month window. And we have something they don't: Swiss data protection built-in from day one.
>
> **This is Switzerland's moment to claim AI sovereignty.**"

---

## **SCRIPT: 10-Minute Extended Version**

Add these sections if time permits:

### **[5:00 - 6:00] Interactive Setup Wizard**

```bash
opencode setup
```

**Show**:
- Beautiful onboarding experience
- Provider selection (with Swiss hosting option)
- Feature configuration
- Plugin marketplace

### **[6:00 - 7:00] Plugin Marketplace**

```bash
opencode plugins discover
```

**Show**:
- Curated plugin catalog
- Interactive browsing
- One-command installation

### **[7:00 - 8:00] Performance Benchmarking**

```bash
# Show benchmark comparison
opencode openrouter info claude-4.5-sonnet
opencode openrouter info gpt-5
```

**Show**:
- Detailed model specifications
- Cost comparisons
- Context windows
- Performance metrics (SWE-bench scores)

### **[8:00 - 9:00] Enterprise Features**

```bash
# Show session management
opencode stats

# Show export capabilities
opencode export

# Show auth management
opencode auth list
```

**Show**:
- Session persistence
- Cost tracking
- Multi-provider authentication
- Audit capabilities

---

## **DEMO VARIATIONS BY AUDIENCE**

### **For Christian Schaub (Biotech Entrepreneur)**

**Customize Demo**:
1. Replace code demo with pharma protocol automation
2. Emphasize Swiss data sovereignty for clinical trials
3. Show cost savings: "10 developers × $200/month = $24k/year saved"
4. Discuss ETH connections and hiring pipeline

**Example Demo Task**:
```bash
opencode run --model openrouter/claude-4.5-sonnet \
  "Convert this clinical trial protocol to automated workflow" \
  --file protocol.pdf
```

### **For Michael Halbherr (Enterprise Strategist)**

**Customize Demo**:
1. Focus on enterprise security features
2. Show multi-provider fallback (reliability)
3. Emphasize board-level thinking: "Strategic independence from US tech"
4. Discuss Zurich Insurance specific opportunities

**Example Demo Task**:
```bash
opencode run --model openrouter/gemini-2.5-pro \
  "Analyze this insurance policy for compliance gaps" \
  --file policy.pdf
```

### **For ETH Technical Validation**

**Customize Demo**:
1. Deep dive into architecture
2. Show Model Context Protocol integration
3. Discuss research opportunities
4. Emphasize open-source contribution potential

**Example Demo Task**:
```bash
opencode run --model openrouter/claude-4.5-sonnet \
  "Optimize this research code for parallel execution" \
  --file research.py
```

---

## **DEMO CHECKLIST**

### Before Demo
- [ ] Terminal configured (font size, colors)
- [ ] OpenCode installed and tested
- [ ] API keys configured
- [ ] Demo files prepared
- [ ] Internet connection stable
- [ ] Screen recording software ready (if recording)

### During Demo
- [ ] Speak clearly and confidently
- [ ] Pause for questions at natural breaks
- [ ] Show, don't just tell
- [ ] Watch the clock (stay under 5 minutes)
- [ ] End with clear call-to-action

### After Demo
- [ ] Q&A prepared
- [ ] Follow-up materials ready
- [ ] Next steps defined
- [ ] Contact information shared

---

## **BACKUP PLANS**

### If Internet Fails
- Have pre-recorded video ready
- Switch to architecture slides
- Show local model capabilities

### If API Keys Don't Work
- Use cached demo output
- Show free models only
- Pivot to architecture discussion

### If Audience Loses Interest
- Jump to most impressive feature
- Show cost comparison immediately
- Ask what they care most about

---

## **FOLLOW-UP MATERIALS**

After the demo, send:

1. **Demo Video**: Screen recording of the 5-minute demo
2. **Technical Validation Report**: TECHNICAL_VALIDATION.md
3. **Pitch Deck**: 3-slide PDF
4. **GitHub Access**: Link to repository
5. **Next Steps**: Calendar invite for follow-up

---

## **KEY TALKING POINTS TO MEMORIZE**

1. **"Built in 3 days"** - Demonstrates execution speed
2. **"400+ models"** - Shows breadth of capability
3. **"10-20x cheaper"** - Emphasizes cost advantage
4. **"Swiss data sovereignty"** - Strategic differentiator
5. **"12-18 month window"** - Creates urgency
6. **"World's best coding model"** - Technical credibility (Claude 4.5 Sonnet)

---

## **CALL-TO-ACTION OPTIONS**

### For Christian
> "I'd love to schedule a longer conversation about the business model and your advice on scaling. When's good for you in January?"

### For Michael
> "Given your role at Zurich Insurance, I'd value a deeper discussion about how this fits into Swiss enterprise strategy. Could we schedule 30 minutes next month?"

### For ETH Validators
> "I'd like to explore a research collaboration or ETH partnership. Would you be open to introducing me to relevant faculty?"

---

**Demo Complete!**
**Total Time**: 5 minutes
**Impact**: Maximum
**Next Step**: Close the meeting with clear ask
