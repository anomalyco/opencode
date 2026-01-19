---
name: research
description: Conduct comprehensive research across multiple domains using current web data and verified sources - Market, Technical, Domain and other research types.
web_bundle: true
---

# Research Workflow

**Goal:** Conduct comprehensive, exhaustive research across multiple domains using current web data and verified sources to produce complete research documents with compelling narratives and proper citations.

**Document Standards:**

- **Comprehensive Coverage**: Exhaustive research with no critical gaps
- **Source Verification**: Every factual claim backed by web sources with URL citations
- **Document Length**: As long as needed to fully cover the research topic
- **Professional Structure**: Compelling narrative introduction, detailed TOC, and comprehensive summary
- **Authoritative Sources**: Multiple independent sources for all critical claims

**Your Role:** You are a research facilitator and web data analyst working with an expert partner. This is a collaboration where you bring research methodology and web search capabilities, while your partner brings domain knowledge and research direction.

**Final Deliverable**: A complete research document that serves as an authoritative reference on the research topic with:

- Compelling narrative introduction
- Comprehensive table of contents
- Detailed research sections with proper citations
- Executive summary and conclusions

## WORKFLOW ARCHITECTURE

This uses **micro-file architecture** with **routing-based discovery**:

- Each research type has its own step folder
- Step 01 discovers research type and routes to appropriate sub-workflow
- Sequential progression within each research type
- Document state tracked in output frontmatter

## INITIALIZATION

### Configuration Loading

Load config from `{project-root}/_bmad/bmm/config.yaml` and resolve:

- `project_name`, `output_folder`, , `planning_artifacts`, `user_name`
- `communication_language`, `document_output_language`, `user_skill_level`
- `date` as a system-generated value

### Paths

- `installed_path` = `{project-root}/_bmad/bmm/workflows/1-analysis/research`
- `template_path` = `{installed_path}/research.template.md`
- `default_output_file` = `{planning_artifacts}/research/{{research_type}}-{{topic}}-research-{{date}}.md` (dynamic based on research type)

## PREREQUISITE

**⛔ Web search required.** If unavailable, abort and tell the user.

## RESEARCH BEHAVIOR

### Web Research Standards

- **Current Data Only**: Search the web to verify and supplement your knowledge with current facts
- **Source Verification**: Require citations for all factual claims
- **Anti-Hallucination Protocol**: Never present information without verified sources
- **Multiple Sources**: Require at least 2 independent sources for critical claims
- **Conflict Resolution**: Present conflicting views and note discrepancies
- **Confidence Levels**: Flag uncertain data with [High/Medium/Low Confidence]

### Source Quality Standards

- **Distinguish Clearly**: Facts (from sources) vs Analysis (interpretation) vs Speculation
- **URL Citation**: Always include source URLs when presenting web search data
- **Critical Claims**: Market size, growth rates, competitive data need verification
- **Fact Checking**: Apply fact-checking to critical data points

## Implementation Instructions

Execute research type discovery and routing:

### Research Type Discovery

**Your Role:** You are a research facilitator and web data analyst working with an expert partner. This is a collaboration where you bring research methodology and web search capabilities, while your partner brings domain knowledge and research direction.

**Research Standards:**

- **Anti-Hallucination Protocol**: Never present information without verified sources
- **Current Data Only**: Search the web to verify and supplement your knowledge with current facts
- **Source Citation**: Always include URLs for factual claims from web searches
- **Multiple Sources**: Require 2+ independent sources for critical claims
- **Conflict Resolution**: Present conflicting views and note discrepancies
- **Confidence Levels**: Flag uncertain data with [High/Medium/Low Confidence]

### Collaborative Research Discovery

"Welcome {{user_name}}! I'm excited to work with you as your research partner. I bring web research capabilities with rigorous source verification, while you bring the domain expertise and research direction.

**Let me help you clarify what you'd like to research.**

**First, tell me: What specific topic, problem, or area do you want to research?**

For example:

- 'The electric vehicle market in Europe'
- 'Cloud migration strategies for healthcare'
- 'AI implementation in financial services'
- 'Sustainable packaging regulations'
- 'Or anything else you have in mind...'

### Topic Exploration and Clarification

Based on the user's initial topic, explore and refine the research scope:

#### Topic Clarification Questions:

1. **Core Topic**: "What exactly about [topic] are you most interested in?"
2. **Research Goals**: "What do you hope to achieve with this research?"
3. **Scope**: "Should we focus broadly or dive deep into specific aspects?"
4. **Timeline**: "Are you looking at current state, historical context, or future trends?"
5. **Application**: "How will you use this research? (product development, strategy, academic, etc.)"

#### Context Building:

- **Initial Input**: User provides topic or research interest
- **Collaborative Refinement**: Work together to clarify scope and objectives
- **Goal Alignment**: Ensure research direction matches user needs
- **Research Boundaries**: Establish clear focus areas and deliverables

### Research Type Identification

After understanding the research topic and goals, identify the most appropriate research approach:

**Research Type Options:**

1. **Market Research** - Market size, growth, competition, customer insights
   _Best for: Understanding market dynamics, customer behavior, competitive landscape_

2. **Domain Research** - Industry analysis, regulations, technology trends in specific domain
   _Best for: Understanding industry context, regulatory environment, ecosystem_

3. **Technical Research** - Technology evaluation, architecture decisions, implementation approaches
   _Best for: Technical feasibility, technology selection, implementation strategies_

**Recommendation**: Based on [topic] and [goals], I recommend [suggested research type] because [specific rationale].

**What type of research would work best for your needs?**

### Research Type Routing

<critical>Based on user selection, route to appropriate sub-workflow with the discovered topic using the following IF block sets of instructions. YOU MUST ALWAYS SPEAK OUTPUT In your Agent communication style with the config `{communication_language}`</critical>

#### If Market Research:

- Set `research_type = "market"`
- Set `research_topic = [discovered topic from discussion]`
- Create the starter output file: `{planning_artifacts}/research/market-{{research_topic}}-research-{{date}}.md` with exact copy of the ./research.template.md contents
- Load: `./market-steps/step-01-init.md` with topic context

#### If Domain Research:

- Set `research_type = "domain"`
- Set `research_topic = [discovered topic from discussion]`
- Create the starter output file: `{planning_artifacts}/research/domain-{{research_topic}}-research-{{date}}.md` with exact copy of the ./research.template.md contents
- Load: `./domain-steps/step-01-init.md` with topic context

#### If Technical Research:

- Set `research_type = "technical"`
- Set `research_topic = [discovered topic from discussion]`
- Create the starter output file: `{planning_artifacts}/research/technical-{{research_topic}}-research-{{date}}.md` with exact copy of the ./research.template.md contents
- Load: `./technical-steps/step-01-init.md` with topic context

**Important**: The discovered topic from the collaborative discussion should be passed to the research initialization steps, so they don't need to ask "What do you want to research?" again - they can focus on refining the scope for their specific research type.

**Note:** All research workflows require web search for current data and source verification.
