# Product Pulse First-Run Interview

Loaded by `SKILL.md` at the start of Phase 1. Captures the configuration that will be merged into `.compound-engineering/config.local.yaml` (the unified CE local config, gitignored, machine-local) as `pulse_*` keys and re-read on every subsequent run.

For each section: ask the opening question, evaluate the answer against the quality bar, push back when it falls into a named anti-pattern, and capture the final answer in the user's own language.

## Overall Rules

1. **Push back, but don't spiral.** One round of pushback per section max. If the second answer still isn't usable, capture what the user gave, flag it in the config as `needs-review`, and move on.
2. **Name events in the user's own words.** The config will be readable by the whole team - use the terms they actually use, not a generic template.
3. **Ask about tools, not credentials.** The interview captures *which* tool and *what shape of query*. It does not collect API keys, tokens, or database passwords. Those stay in the user's environment.
4. **Honor strategy seeds.** If `SKILL.md` Phase 1.0 surfaced a product name or a list of key metrics from `STRATEGY.md`, start with those as defaults and let the user edit. Do not re-ask questions that the strategy doc already answered unambiguously.
5. **Evaluate metrics against the SMART bar.** Every event, metric, and signal the user proposes should be:
   - **Specific** - a named event or a named metric, not a category. `message_sent` passes; "engagement" does not.
   - **Measurable** - you can point to the tool and query that returns a number. "Users like it" does not pass; "NPS score from Delighted" does.
   - **Actionable** - if the number moves, the team knows what to do next. "Daily active users" alone usually fails this - pair it with a conversion or retention signal that surfaces a decision.
   - **Relevant** - ties to the product's target problem and persona (from the strategy doc if seeded). Generic funnel metrics that don't connect to the strategy are suspect.
   - **Timely** - reads in the pulse window (24h, 7d, etc.) and reflects the current state. Lagging metrics that only move quarterly don't belong in a daily pulse.

   When a user proposes a metric that fails one of these, push back by naming the specific dimension: "That sounds more like a vanity metric than an actionable one - if it moves, what do we do? Is there a tighter signal that would drive a decision?" Do not use the word "SMART" with the user; use the plain-English question.

---

## 1. Product Name

**Opening question:**

- If seeded from strategy: "Product name from strategy is `{{name}}`. Keep it or edit?"
- Otherwise: "What's the product called?"

No pushback needed. Capture verbatim.

---

## 2. Primary Engagement Event

**Opening question:** "When someone is using your product, what single event fires? The one that tells you a user is active right now."

This is the heartbeat of the pulse. Pick one event - the one that represents a user actually using the product, not opening a page.

**Apply the SMART bar** (see Overall Rules). The event must be specific (a named event), measurable (the analytics tool returns a count), actionable (if it moves, the team notices), relevant (ties to the product's job), and timely (reads cleanly in short windows).

**Engagement vs value test.** After the user names an event, ask yourself: does this event fire when the user is *using* the product, or when the user has *gotten value* from it? Engagement is earlier (they're in it). Value is later (it worked). If the candidate is really value-realization, push back: "That sounds like the moment the product *worked* for them. What event happens earlier - when they're in the middle of using it? The value event belongs in section 3." Common slips: `agent_accepted_draft` (value) vs `agent_received_draft` (engagement); `ride_completed` (value) vs `ride_started` (engagement); `question_answered_correctly` (value) vs `question_asked` (engagement).

**Anti-patterns and pushback:**

- **Page view or visit** ("pageview", "app opened", "login") -> "Those tell you someone showed up. I'm looking for the event that says they actually *used* the product. What fires when a user is doing the thing the product is for?"
- **Multiple events with no clear primary** ("well, it could be X or Y or Z depending on the flow") -> "For the pulse, pick the one that's closest to 'a user is active using the core product.' If two candidates are genuinely tied, pick the one that happens *when the user spends time in exchange for value* - for async products that's usually 'contributed content' over 'opened app'."
- **Too deep in the funnel** ("purchase_completed") -> "That's a conversion event - we'll capture that separately. For the primary engagement event, what happens earlier - when they're using the product, not when they've already converted?"
- **Vague** ("interaction", "activity") -> "Is there a specific event name in your analytics tool? I want to write down the literal event name so this is repeatable."

**Capture:** Event name verbatim (e.g., `message_sent`, `document_edited`, `ride_started`). Plus a one-line description of what it means.

---

## 3. Value-Realization Event

**Opening question:** "What event fires when a user actually gets value - when the product delivered what they came for?"

Different from engagement. Engagement says "they're using it"; value-realization says "they got what they wanted." Some products have a clear distinction (engagement: `typed_in_box`; value: `got_useful_answer`); for others it's the same event (engagement: `ride_requested`; value: `ride_completed`).

**Apply the SMART bar.** The bar here is the same - specific, measurable, actionable, relevant, timely - and the proxy test is especially important because value-realization is often felt, not fired.

**Anti-patterns and pushback:**

- **Same as engagement event, accidentally** -> "Is that the same as the engagement event you gave me? If so, that's fine - some products have one event that covers both. Want to confirm, or is there a later signal that says 'this user got the thing they came for'?"
- **Revenue event** ("purchase") -> "Purchase is a conversion event - we'll capture that separately. For value-realization, I'm looking for the moment a user knows the product worked for them, which is usually before or separate from payment."
- **Value is a feeling, not an event** ("they feel like the team aligned", "they trust the output") -> "That's real, but we can't measure a feeling directly in the pulse. What's a proxy event that correlates? Common patterns: a completion event (workflow finished), a time-to-first-X metric (seconds from open to output), a short-window return rate (came back the next day), or a copy/share/export event (took the output into their actual work). Pick the one closest to the feeling."
- **Can't name one** -> "That's useful to know. If there's no discrete event, is there a session or workflow *completion* that stands in? Something like 'they finished the task they opened the product to do.' If not, we'll treat engagement as the value proxy and note it in the config."

**Capture:** Event name verbatim, or `same-as-engagement` with a note, or `not-defined` with a note.

---

## 4. Completion or Conversion Events

**Opening question:** "Any conversion or completion events worth tracking - signups, upgrades, trial starts, purchases?"

Optional section. 0-3 events is typical.

**Apply the SMART bar** (see Overall Rules). Each conversion event should tie to a decision: if `trial_started` moves ±20%, what would the team do? If the answer is "nothing", the event is a vanity metric and shouldn't be in the pulse.

**Anti-patterns and pushback:**

- **Long list** ("we have 12 of them") -> "Pick the top 3 that move the business. The others can be queried ad-hoc when you want; the pulse keeps the top 3."
- **Non-actionable conversion** ("email_opens", "logo_impressions") -> "If that number swings, what do we do? If the answer is 'nothing,' it's a vanity metric. What's a tighter signal further down the funnel?"

**Capture:** List of 0-3 event names with one-line descriptions each.

---

## 5. Quality Scoring (optional, AI products)

**Opening question:** "Is this an AI product where a conversation or session could be rated for quality? If yes, I'll sample up to 10 sessions per run and score each 1-5 on a dimension you define. Say no if this isn't applicable."

If the user opts in, ask: "What dimension should sessions be scored on? (e.g., 'got to a useful answer', 'response was accurate', 'no hallucinations')."

**Pushback:**

- **Vague dimension** ("quality", "goodness", "helpful", "good response") -> "Quality on what axis specifically? The dimension should be something a human could look at a transcript and judge consistently."
- **Multiple dimensions** ("accurate AND actionable") -> "Start with one. You can add dimensions by editing the config later. Keeping it at one keeps the scores comparable across runs. Which matters more right now?"
- **Reviewability test** - after the user names a dimension, apply this check silently: could two separate reviewers look at the same session and agree on the score? If no, push back once: "Let's tighten this - what would make a reviewer score this a 5 vs a 3? If you can name the distinction in one sentence, the dimension is tight enough." If the user can answer, capture it as a scoring note alongside the dimension. If they can't, flag the dimension `needs-review` and move on.

**Capture:** opt-in (yes/no), dimension (if opted in), scoring note (1 sentence distinguishing 5 from 3), scoring discipline reminder ("default to 4-5; reserve 1-3 for clear failures").

---

## 6. Data Sources

**Opening framing:** "Now we wire up the connections needed to actually report on the events and metrics you've named. The goal is the smallest set of sources that covers everything above - one source can be enough. Let's walk through each metric."

### 6.0 Build the metric-to-source list

Compile the full list of signals that need a source:

- The primary engagement event (section 2)
- The value-realization event (section 3), if different from engagement
- Each completion/conversion event (section 4)
- Each key metric carried from the strategy doc, if strategy was seeded

For each entry, ask one question: "Where does `{{event or metric}}` live? Name the tool (e.g. Mixpanel, PostHog, Amplitude, Stripe, internal DB) and how the agent would query it."

The answer produces (tool name, query shape). If multiple entries land in the same tool, consolidate them into one source entry.

**Persist per-strategy-metric source mapping.** For each strategy metric whose source differs from the default (`pulse_analytics_source` for analytics-class metrics, `pulse_payments_source` for revenue/payments-class metrics, etc.), record the override in `pulse_metric_sources` as a `metric=source` pair. Example: if `pulse_analytics_source` is `posthog` but `nps` is captured in Delighted, write `pulse_metric_sources: "nps=delighted"`. Strategy metrics whose source matches the class default do not need an entry. Without this mapping, multi-source setups silently lose the per-metric routing between runs.

**Dual-source arbitration.** If a single signal could be answered from two different sources (e.g., both PostHog and a read-only DB replica have the search events), pick one as canonical and name it in the config. Ask: "Both `{{source A}}` and `{{source B}}` can cover this - which is the source of truth? The pulse queries one per signal so numbers stay consistent across runs." Capture the canonical source. The other tool may still be used for ad-hoc investigation but is not wired into the pulse.

**If the user says "we don't have that instrumented yet"** (common for strategy-seeded metrics like retention or NPS): offer two off-ramps and let them pick.

- **Defer** - append the metric name to `pulse_pending_metrics` (CSV). The metric renders as `no data` in each pulse report until instrumentation lands. Right call when the metric matters and the team will instrument it.
- **Drop from pulse** - append the metric name to `pulse_excluded_metrics` (CSV). The metric stays in `STRATEGY.md` but the pulse skips it entirely. Right call when the metric is aspirational and won't have data any time soon.

Do not silently skip. Every un-instrumented strategy metric must land in exactly one of `pulse_pending_metrics` (visible as `no data`) or `pulse_excluded_metrics` (omitted from the report).

### 6.1 MCP nudge

After each unique source is named, check MCP coverage:

1. Call `search_mcp_registry` with the tool name to see if an official or community MCP exists. Do not guess from memory.
2. If one exists and the user already has it connected (ask: "Is the `{{tool}}` MCP already connected?"), note `using MCP for {{tool}}` in the config.
3. If one exists but the user hasn't connected it, suggest: "There's an MCP for `{{tool}}`. Connecting it is the fastest way to let the agent query on each run - I can call `suggest_connectors` to walk you through it, or we can skip and I'll note the source as `manual - agent will need credentials or another path`."
4. If no MCP exists, capture `manual` and note what shape of query the agent should use (CLI, API, etc.).

Do not set up MCP connections inside this interview - that's a separate flow. Just record which tools have MCP coverage and which do not.

### 6.2 Database access (optional, read-only only)

Ask explicitly: "Do you have a read-only database connection you'd like the agent to use for any signals that live in the DB? Read-only only - I will refuse a read-write connection."

**Handling the answer:**

- **"No" or "skip"** -> capture `database: not used` and move on. DB is entirely optional; many products report the pulse from analytics and tracing alone.
- **"Yes, read-only"** (read replica, read-only user, row-level-security enforced) -> capture connection shape and which tables are available. Ask about cost: "For pulse queries, scans need to be cheap - what indexed columns are available, and are there any tables to avoid?"
- **"Yes, but it's my prod credential"** or any indication the connection has write access -> refuse: "For safety the pulse will not query a database with write access, even read-only in intent. The options are: (a) set up a read-only replica or a read-only user, (b) skip the DB entirely - analytics usually covers the pulse. Which do you want?" Do not proceed until the user picks (a) with verified read-only scope or (b) skip. Do not capture a read-write connection under any framing.

### 6.3 Consolidated source list

When every signal has a source (or is marked "covered by analytics above"), summarize the source list back to the user: "Here's what we'll wire up: {{sources}}. Any source missing for a signal you care about?"

Capture the final list in the config. A minimum of one source is acceptable.

**Source-count check** - judge by ratio, not absolute count:

- If the config has 3-4 metrics and every source covers a distinct one, 3-4 sources is the floor and not a warning. Accept without flagging.
- If the config has 1-2 metrics spread across 4+ sources, the setup is over-instrumented - flag for review and ask: "We have {{N}} sources but only {{M}} metrics. Is there a single tool that could cover most of this?"
- Above 5 sources regardless of metric count, flag for review. Lots of sources means lots of auth, latency, and failure modes on every run.

---

## 7. System Performance

**Opening framing:** "The system performance portion of the pulse is pretty standard - most teams want the same thing: top errors with context, and latency percentiles. Unless you have strong opinions, I'll set up the recommended default."

**Recommended default (confirm or override):**

- **Top errors:** top 5 error signatures from the tracing tool, by count, descending. Each entry includes the signature and a one-line explanation of what it likely means.
- **Latency:** p50, p95, p99 over the window, compared to the prior equal-length window.
- **Tracing tool:** {{capture tool name if not already named in section 6}}

Ask one confirmation question: "Keep the recommended setup, or customize?"

- **Keep** -> capture defaults.
- **Customize** -> ask what they want to change. Common adjustments: "top 3 instead of 5", "skip latency", "add a specific error signature to always surface". Accept and record.

If no tracing tool was named in section 6, ask: "What tool do you use for application tracing and errors? (e.g., Datadog, Sentry, Honeycomb, New Relic.) Skip if you don't have one - I'll omit the system performance section from the report." Skipping is fine - the pulse will just report usage and followups in that case.

**Capture:** tool name (or "none"), top-error count (default 5), latency opt (default on).

---

## 8. Default Lookback Window

**Opening question:** "What should the default lookback window be when no time window is specified? Common: 24h for daily ops, 7d for weekly review, 1h for launches."

Capture: single default (e.g., `24h`).

---

## 9. Scheduling Recommendation

After the config is written and shown to the user, make a scheduling offer before handing back to Phase 2.

**Opening framing:** "Pulses are most useful on a cadence - a report once a day (or once a week) catches drift you'd miss otherwise. Want me to set up a recurring run?"

**Ask one question:**

- "Yes, daily" - at a time they pick
- "Yes, weekly" - day + time they pick
- "Not now - I'll run it manually"
- "Later - remind me after a few manual runs"

**Handling the answer:**

- **Yes (daily or weekly)** -> "I'll hand this to the `schedule` skill. Confirm the time/day and it'll set up the recurring job." Do not schedule inline - hand off to the `schedule` skill explicitly, which is the single source of truth for recurring tasks. On Claude Code, this uses the Routines feature.
- **Not now** -> capture `schedule: manual` in the config. No nag.
- **Later** -> capture `schedule: ask-again-after-3-runs` in the config. The SKILL.md Phase 3 logic re-surfaces the offer after 3 manual runs.

Skipping this entirely is fine - the skill does not require a schedule to function. But recommending one is the right default because the value of pulse compounds through the saved-reports timeline; one-off runs lose most of that value.

**Capture:** `schedule: daily | weekly | manual | ask-again-after-3-runs` plus time/day if applicable.

---

## Config File Shape

After the interview completes, merge a `pulse_*` block into `<repo-root>/.compound-engineering/config.local.yaml`. Resolve the repo root with `git rev-parse --show-toplevel`. Preserve any non-pulse keys that already exist in the file (e.g., `work_delegate_*`); only add or update `pulse_*` keys.

If the file does not yet exist, create the directory and file. If `.compound-engineering/config.local.yaml` is not already covered by `.gitignore`, offer to add the entry before writing.

The pulse block uses these flat keys (matches the `work_delegate_*` precedent for consistency):

~~~yaml
# --- Product pulse ---

pulse_product_name: "{{product_name}}"
pulse_lookback_default: {{24h | 7d | 1h | other}}    # default 24h if omitted
pulse_primary_event: "{{event_name}}"
pulse_value_event: "{{event_name}}"                  # may equal pulse_primary_event; omit if not defined
pulse_completion_events: "{{event,event,event}}"     # comma-separated, 0-3 events; omit if none
pulse_quality_scoring: {{true | false}}              # AI products only; default false
pulse_quality_dimension: "{{dimension}}"             # only meaningful when pulse_quality_scoring is true
pulse_analytics_source: {{posthog | mixpanel | custom | omit}}
pulse_tracing_source: {{sentry | datadog | custom | omit}}
pulse_payments_source: {{stripe | custom | omit}}    # omit if not used
pulse_db_enabled: {{true | false}}                   # default false; read-only DB access only
pulse_metric_sources: "{{metric=source,metric=source}}"  # strategy-metric -> source overrides; omit metrics that use the class default (pulse_analytics_source for analytics-class, pulse_payments_source for revenue, etc.)
pulse_pending_metrics: "{{metric,metric}}"           # strategy metrics deferred for instrumentation; render as 'no data'; omit if none
pulse_excluded_metrics: "{{metric,metric}}"          # strategy metrics intentionally not in pulse; omit if none
~~~

**Notes on what is NOT persisted in config:**

- **Strategy metrics carried forward**: surfaced in the report, not stored as config — they live in `STRATEGY.md` and are re-read each run from there.
- **Per-source connection details** (URLs, API keys, query specifics): live with the user's MCP configuration, not in this config.
- **Hardcoded operational settings** (15-minute trailing buffer, top-N error count, p50/p95/p99 latencies, "no PII in reports", "parallel analytics + tracing, serial DB"): these are skill behavior, not user config; they live in `SKILL.md` and stay constant.
- **Schedule cadence**: handled by the `schedule` skill (or platform-native cron), not pulse config. The pulse skill only hands off; it does not own the cadence record.
- **Tracing top-N count and latency on/off**: not configurable in this version. The report always includes top 5 errors and full p50/p95/p99 latency. Add config keys later if a real need surfaces.

After writing, surface the resulting `pulse_*` block to the user in chat. Offer one round of edits. Then return to SKILL.md Phase 2.
