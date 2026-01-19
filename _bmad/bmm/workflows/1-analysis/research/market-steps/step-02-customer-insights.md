# Market Research Step 2: Customer Insights

## MANDATORY EXECUTION RULES (READ FIRST):

- 🛑 NEVER generate content without web search verification

- 📖 CRITICAL: ALWAYS read the complete step file before taking any action - partial understanding leads to incomplete decisions
- 🔄 CRITICAL: When loading next step with 'C', ensure the entire file is read and understood before proceeding
- ✅ Search the web to verify and supplement your knowledge with current facts
- 📋 YOU ARE A CUSTOMER INSIGHTS ANALYST, not content generator
- 💬 FOCUS on customer behavior and needs analysis
- 🔍 WEB SEARCH REQUIRED - verify current facts against live sources
- ✅ YOU MUST ALWAYS SPEAK OUTPUT In your Agent communication style with the config `{communication_language}`

## EXECUTION PROTOCOLS:

- 🎯 Show web search analysis before presenting findings
- ⚠️ Present [C] continue option after customer insights content generation
- 💾 ONLY save when user chooses C (Continue)
- 📖 Update frontmatter `stepsCompleted: [1, 2]` before loading next step
- 🚫 FORBIDDEN to load next step until C is selected

## CONTEXT BOUNDARIES:

- Current document and frontmatter from step-01 are available
- Focus on customer behavior and needs analysis
- Web search capabilities with source verification are enabled
- May need to search for current customer behavior trends

## YOUR TASK:

Conduct comprehensive customer insights analysis with emphasis on behavior patterns and needs.

## CUSTOMER INSIGHTS SEQUENCE:

### 1. Begin Customer Insights Analysis

**UTILIZE SUBPROCESSES AND SUBAGENTS**: Use research subagents, subprocesses or parallel processing if available to thoroughly analyze different customer areas simultaneously and thoroughly

Start with customer research approach:
"Now I'll conduct **customer insights analysis** to understand customer behavior and needs.

**Customer Insights Focus:**

- Customer behavior patterns and preferences
- Pain points and challenges
- Decision-making processes
- Customer journey mapping
- Customer satisfaction drivers
- Demographic and psychographic profiles

**Let me search for current customer insights using parallel web searches for comprehensive coverage.**"

### 2. Parallel Customer Research Execution

**Execute multiple web searches simultaneously:**

Search the web: "[product/service/market] customer behavior patterns"
Search the web: "[product/service/market] customer pain points challenges"
Search the web: "[product/service/market] customer decision process"

**Analysis approach:**

- Look for customer behavior studies and surveys
- Search for customer experience and interaction patterns
- Research customer satisfaction methodologies
- Note generational and cultural customer variations
- Research customer pain points and frustrations
- Analyze decision-making processes and criteria

### 3. Analyze and Aggregate Results

**Collect and analyze findings from all parallel searches:**

"After executing comprehensive parallel web searches, let me analyze and aggregate the customer insights:

**Research Coverage:**

- Customer behavior patterns and preferences
- Pain points and challenges
- Decision-making processes and journey mapping

**Cross-Customer Analysis:**
[Identify patterns connecting behavior, pain points, and decisions]

**Quality Assessment:**
[Overall confidence levels and research gaps identified]"

### 4. Generate Customer Insights Content

Prepare customer analysis with web search citations:

#### Content Structure:

When saving to document, append these Level 2 and Level 3 sections:

```markdown
## Customer Insights

### Customer Behavior Patterns

[Customer behavior analysis with source citations]
_Source: [URL]_

### Pain Points and Challenges

[Pain points analysis with source citations]
_Source: [URL]_

### Decision-Making Processes

[Decision-making analysis with source citations]
_Source: [URL]_

### Customer Journey Mapping

[Customer journey analysis with source citations]
_Source: [URL]_

### Customer Satisfaction Drivers

[Satisfaction drivers analysis with source citations]
_Source: [URL]_

### Demographic Profiles

[Demographic profiles analysis with source citations]
_Source: [URL]_

### Psychographic Profiles

[Psychographic profiles analysis with source citations]
_Source: [URL]_
```

### 5. Present Analysis and Continue Option

Show the generated customer insights and present continue option:
"I've completed the **customer insights analysis** for customer behavior and needs.

**Key Customer Findings:**

- Customer behavior patterns clearly identified
- Pain points and challenges thoroughly documented
- Decision-making processes mapped
- Customer journey insights captured
- Satisfaction and profile data analyzed

**Ready to proceed to competitive analysis?**
[C] Continue - Save this to the document and proceed to competitive analysis

### 6. Handle Continue Selection

#### If 'C' (Continue):

- Append the final content to the research document
- Update frontmatter: `stepsCompleted: [1, 2]`
- Load: `./step-05-competitive-analysis.md`

## APPEND TO DOCUMENT:

When user selects 'C', append the content directly to the research document using the structure from step 4.

## SUCCESS METRICS:

✅ Customer behavior patterns identified with current citations
✅ Pain points and challenges clearly documented
✅ Decision-making processes thoroughly analyzed
✅ Customer journey insights captured and mapped
✅ Customer satisfaction drivers identified
✅ [C] continue option presented and handled correctly
✅ Content properly appended to document when C selected

## FAILURE MODES:

❌ Relying solely on training data without web verification for current facts

❌ Missing critical customer behavior patterns
❌ Not identifying key pain points and challenges
❌ Incomplete customer journey mapping
❌ Not presenting [C] continue option after content generation
❌ Appending content without user selecting 'C'

❌ **CRITICAL**: Reading only partial step file - leads to incomplete understanding and poor decisions
❌ **CRITICAL**: Proceeding with 'C' without fully reading and understanding the next step file
❌ **CRITICAL**: Making decisions without complete understanding of step requirements and protocols

## CUSTOMER RESEARCH PROTOCOLS:

- Search for customer behavior studies and surveys
- Use market research firm and industry association sources
- Research customer experience and interaction patterns
- Note generational and cultural customer variations
- Research customer satisfaction methodologies

## NEXT STEP:

After user selects 'C' and content is saved to document, load `./step-05-competitive-analysis.md` to focus on competitive landscape analysis.

Remember: Always emphasize current customer data and rigorous source verification!
