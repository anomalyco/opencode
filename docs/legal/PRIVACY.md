# DeskFox Privacy Policy

> **Version**: v1.0 (final) | **Effective**: 2026-05-01
> **Canonical published URL**: https://deskfox.ai/privacy (until the site is live, this markdown file in the source repository is the authoritative source)
> **Applies to**: DeskFox v2026.4.29.2 and later (the "Usage Statistics" and "Update Check" sections describe behavior that has been live since this version, see Section 3)
> **Related**: [`docs/installer-versions.md`](../installer-versions.md) / 中文版: [`隐私协议.md`](./隐私协议.md) / Open-source license: [`LICENSE`](../../LICENSE)
> **Language priority**: This policy is published in both Chinese and English. **In case of conflict between the two versions, the Chinese version prevails**; this English version is provided for reference only.

---

## Introduction

Welcome to **DeskFox** (the "Software"). DeskFox is an **open-source desktop tool**, independently maintained by the DeskFox project maintainer. It helps you read and edit files locally and chat with various AI models. This policy explains **how we handle your data** and what rights you have.

> **Nature of this Software**: This Software is developed and freely open-sourced by the DeskFox project maintainer in spare time. It does not constitute a commercial service and carries no enterprise-level SLA commitment. Please understand the "individual open-source" nature before use — maintenance cadence, bug response time, and feature iteration are all **unpredictable**, and you should evaluate whether this is suitable for your scenario (especially commercial scenarios). See Section 8 for the disclaimer.

### Why You Can Trust This Policy

This Software is **fully open source**. The source code is hosted on two public repositories:
- GitHub: https://github.com/zoulukuang/deskfox
- Gitee: https://gitee.com/zoulukuang/deskfox

**You can audit the code yourself** to verify whether what we say in this policy is true — what we collect, what we don't, and how data leaves your machine. This is a stronger privacy guarantee than any legal promise.

The Software is licensed under the [**MIT License**](../../LICENSE) (same as upstream [anomalyco/opencode](https://github.com/anomalyco/opencode)). You may use, modify, and distribute it freely, subject to keeping the copyright and license text.

### Our Core Commitment

**DeskFox does not read or store your chat content, file content, or API keys.** The most we collect is **anonymous aggregate usage statistics** and the **minimum information needed for update checks** (software version, platform), all of which **can be disabled in Settings**.

### Role Boundary (Important)

When you use DeskFox to handle data **of others** (e.g., your company's customer records, colleague information, family member data), under the Personal Information Protection Law (PIPL) and similar data-protection regimes, **you yourself** are the "personal information processor (controller)" of that data. **DeskFox only puts the tool in your hands and does not participate in the content, purpose, or flow of what you process**.

Analogy: Microsoft does not become the processor of your customer contracts merely because you typed them in Word. The Software's role positioning is the same.

Detailed allocation of responsibility: see Section 8.3.

---

This policy applies to your full lifecycle of downloading, installing, and using the DeskFox desktop application.

---

## 1. Overall Data Flow (Please Understand the Architecture First)

```
Your computer                              
┌────────────────┐    
│  DeskFox.exe   │ ──┬─→ AI model providers you connect (Claude / GPT / Gemini / ...)
│  (runs local) │   │  Sent: chat text, file content added to context, API requests
│                │   │  ※ Direct to provider; no DeskFox backend in the path
│  local files   │   │
│  chat history  │   ├─→ DeskFox usage statistics endpoint (live since v2026.4.29.2)
│  API keys      │   │  Sent: anonymous install_id + software version + OS + arch + country
│  config        │   │  ※ Contains NO chat / file / API key content
│                │   │  ※ Three ways to disable (see Section 3)
│                │   │
│                │   └─→ DeskFox update check endpoint (live since v2026.4.29.2)
│                │      Behavior: HTTP GET pulls a static JSON
│                │      ※ Client does NOT send its own version (compared locally)
│                │      ※ No silent download, no silent install
│                │      ※ Toggle off in Settings (see Section 3)
└────────────────┘
```

Four data channels:

| Channel | Direction | Who can see | Your control |
|---|---|---|---|
| **Chat / file context** | Your computer → Model provider you connect | Model provider (subject to their privacy policy); **DeskFox cannot see** | Connect no model = nothing sent (see Section 2.2 "Definition of Connection") |
| **Local data** | Stays on your computer | Only those who can log into your computer account (including you) | Uninstall + delete local dir = fully wiped |
| **Usage statistics** | Your computer → DeskFox statistics endpoint | DeskFox, **at aggregate level only**, no individual identification | Three ways to disable |
| **Update check** | Your computer → DeskFox update endpoint (GET static JSON) | DeskFox server only sees access log; **does NOT receive your version** | Toggle off in Settings, independent of statistics toggle |

---

## 2. How We Handle Your Data

### 2.1 Stays on Your Computer (We Cannot See)

| Data type | Location | Leaves your computer? |
|---|---|---|
| Files you open / edit | Original path on your computer | ❌ No (unless you actively "Add to chat") |
| Chat history | DeskFox user config directory (local DB) | ❌ No |
| Model API keys | Local config file | ❌ No (sent directly to model provider, no relay) |
| DeskFox preferences | Local config file | ❌ No |
| File tree state / recent files | Local config file | ❌ No |

### 2.2 Sent to Third-Party Model Providers (Determined by Your Choice)

#### Definition of "Connection" (Important)

In this policy, "**connecting to a model provider**" means you have **actively** completed both of the following steps:

1. Entered the provider's API key in DeskFox settings
2. The key has **successfully made a request** to the provider's API (the provider accepted the request and returned a response)

**Until both steps are complete, DeskFox does NOT send any request to that provider**, even if the provider's name appears in the UI. This boundary is drawn so that no "out-of-the-box, unknowingly connected" situation can occur.

#### After a Successful Connection

Once a connection is established, when you **actively** perform any of the following, data is sent from your computer to that provider:
- Type and send a message in the chat box
- Use "Right-click → Add to chat" to include file content as context
- Have the model Edit / Write your files (the model needs to read/write file content)
- Line comment review path

**What is sent**: your prompt, file content added to context, your system prompt, agent configuration, etc.

**Important**: These requests are initiated by DeskFox **directly from your machine** and **do not pass through any DeskFox server**. What the model provider receives, retains, and how they use it is governed by **their respective privacy policies** (see Appendix A for common providers). We recommend reviewing the relevant provider's policy before connecting.

### 2.3 What We Will **Never** Collect (Now or in the Future)

- ❌ **Chat content**: any conversation with any model — never collected
- ❌ **File content / names / paths**: any file you open or edit — never collected
- ❌ **API keys**: never collected
- ❌ **Granular behavior logs**: we do not record which buttons you click or how long you use which feature (we record only the fixed events listed in Section 3)
- ❌ **Real IP address**: used only by the server to derive country, then **immediately discarded**, never stored
- ❌ **Identifying information**: name, email, phone, account, biometrics, etc.
- ❌ **Crash reports with real data**: local crash logs stay local by default; **the current version collects no crash data at all** (see Section 7); if crash reporting is added in the future, it will require separate consent and only sanitized stack traces will be uploaded

---

## 3. Communications with DeskFox's Server

DeskFox communicates with DeskFox's server **only for the following two purposes**, with strictly limited data. Both have been live since **DeskFox v2026.4.29.2**.

### 3.1 Usage Statistics

**Purpose**: Understand the overall scale, regional distribution, and version distribution of users, to inform maintenance and localization priorities.

**Endpoint**: `https://telemetry.deskfox.ai/api/event` (backed by self-hosted Plausible Analytics).

#### Fields Collected (Complete payload per event)

| Data point | Example | Purpose |
|---|---|---|
| Anonymous install ID (`install_id`) | `b4c7e2a1-...` (random UUID generated locally on first launch, stored locally) | Counts unique devices; **cannot be linked to your real identity** (we hold no mapping table) |
| Software version (`version`) | `2026.4.29.2` | Version distribution |
| OS platform (`os`) | `win32` / `darwin` / `linux` (Node.js `process.platform`) | OS distribution |
| CPU architecture (`arch`) | `x64` / `arm64` | Architecture distribution |
| Country (`country`) | `CN` / `US` etc. **at country level** (no province/state) | Derived by Plausible server-side from request IP; **the IP itself is immediately discarded** |

#### Event Whitelist (Hardcoded Strong Commitment)

The Software's source code **strictly limits** which events can be reported. Any event name not on this list is silently dropped at the client (defense-in-depth, see the `ALLOWED_EVENTS` constant in `packages/desktop-electron/src/main/telemetry-strategy.ts`).

| Event | Trigger | Payload |
|---|---|---|
| `pageview` (heartbeat) | Software launch | Only the 5 fields above; no extra info |
| `desktop.app_open` | Software launch | Same as above |
| `desktop.project_open` | You open a project | Same; **no project name / path** |
| `desktop.ai_request` | You issue a model request | Same; **no prompt / file content / model name** |
| `desktop.update_seen` | You see the update prompt | Same |
| `desktop.update_downloaded` | A new version finishes downloading | Same |
| `desktop.update_applied` | You restart to apply update | Same |

#### Frequency
On each launch: one heartbeat (`pageview`) + one `desktop.app_open` event; other whitelisted events fire as their triggers occur. The client buffers (5 minutes / 20 events) and retries 3 times on failure.

#### Default State
**On by default, with a native first-run dialog** (three buttons: `Allow` / `Disable telemetry` / `Privacy policy`). You can disable directly in the dialog, or later via **any one** of the three methods below (any one suffices, all behave identically):

1. In-app `Settings → Privacy → Usage Statistics` (writes to `config.json` below)
2. Environment variable `OPENCODE_TELEMETRY=0` (highest priority; overrides config)
3. Edit `~/.config/opencode/config.json`, set `"telemetry": false`

Disabling **takes effect immediately**; the client sends nothing further to the statistics endpoint.

#### Storage and Retention

| Data form | Retention | Location |
|---|---|---|
| Raw event records | Destroyed after 30 days | **Servers within mainland China** |
| Aggregated statistics (version / country / DAU / MAU breakdown) | 12 months | Same |
| Final aggregated trends / charts | Permanent | Same |

**Cross-border transfer**: The Software's statistics data is stored **only within mainland China**, with **no cross-border transfer**. Should the storage location change (e.g., to overseas nodes), we will re-obtain your consent under PIPL Chapter III, with a prominent notice in this policy.

### 3.2 Update Check

**Purpose**: Notify you when a new version is available; **you decide** whether to download and update.

**Endpoint**: `https://updates.deskfox.ai/v1/latest/<client>/latest.json` (static JSON).

#### Behavior (At the Code Level)

- The client issues an **HTTP GET** request to fetch the static JSON above
- The server **only returns the latest version metadata** (version number, release time, release notes URL)
- **The client does NOT send its own version to the server**; the comparison happens locally on your machine
- The only fields visible server-side are the network-layer IP (used to return the response) and the URL path's `<client>` segment (`desktop` / `cli`, telling the server which client's update info you want)
- 24-hour local cache so we don't pound the endpoint on every launch

#### Behavior Boundaries (Important)

- ✅ Only **queries** for new versions
- ✅ If a new version exists, a notification or menu item appears; **you must click** to navigate to download
- ❌ **No silent download** of new versions
- ❌ **No silent install** / no forced upgrade / no replacing files without your knowledge
- ❌ **No tracking of your update behavior** (we don't know whether you accepted the prompt — unless you have usage statistics enabled, in which case `desktop.update_seen` / `update_downloaded` / `update_applied` events fire per Section 3.1's whitelist)

#### Frequency
Once on launch, then every 24 hours. Locally cached; failures silently ignored.

#### Default State
**On by default**, can be disabled via **any one** of the methods below (either suffices; **fully independent** from the usage-statistics toggle):

1. Environment variable `OPENCODE_UPDATE_CHECK=0`
2. Edit `~/.config/opencode/config.json`, set `"update_check": false`

That is, you can disable usage statistics while keeping update checks, or vice versa.

#### Microsoft Store Channel (Special Case)

For DeskFox installed via the **Microsoft Store** (MSIX package), upgrades are **handled entirely by the Store**, and the Software does NOT perform its own update check (corresponding to the `store-skip` strategy in code). This means:

- You will **not** see DeskFox's own update prompt
- DeskFox **does not** send any request to DeskFox's update endpoint
- Update behavior follows Microsoft Store rules, with the Store performing silent updates or prompts per its own policy

#### Difference from Upstream anomalyco/opencode

DeskFox **has disabled the upstream anomalyco/opencode official auto-update channel** (see [`改动日志.md`](../../改动日志.md) entry "禁自动升级") because the upstream channel would overwrite DeskFox with the upstream binary. The update check described here is DeskFox's **own** channel, used only to notify of DeskFox's own version updates, unrelated to the upstream channel.

---

## 4. Third-Party Components and Dependencies

### 4.1 Microsoft WebView2

DeskFox uses WebView2 to render its UI. This is a Windows system component maintained by Microsoft. WebView2's own data collection behavior is governed by **Microsoft's privacy statement**, which we cannot influence. See https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution#privacy.

### 4.2 Open-Source Upstream Dependencies

DeskFox is forked from the open-source project [anomalyco/opencode](https://github.com/anomalyco/opencode) under MIT license, and depends on a series of frontend / Rust third-party libraries. These libraries **run as code on your local machine** and do not independently transmit your data. Full dependency manifest in source `package.json` and `Cargo.toml`.

### 4.3 AI Model Providers You Connect

Any model provider you connect (per the definition in Section 2.2) — Anthropic Claude / OpenAI / Google Gemini / self-hosted / others — **independently processes your request data**, each with its own privacy policy. **DeskFox is not responsible for model providers' data handling**, but we recommend prioritizing providers with **clear privacy policies and data-non-retention options**.

---

## 5. Your Controls

> The controls listed in this section correspond to the rights of personal information subjects under Articles 13-20 of the **Personal Information Protection Law of the People's Republic of China (PIPL)**, including the right to be informed, to decide, to access, to copy, to correct, to supplement, to delete, and to withdraw consent. If you believe this Software has failed to fulfill these obligations, you may contact DeskFox directly via the channels in Section 12.

You can manage your data at any time:

| What you want | How |
|---|---|
| Disable usage statistics | In-app `Settings → Privacy → Usage Statistics`, or env var `OPENCODE_TELEMETRY=0`, or set `"telemetry": false` in `~/.config/opencode/config.json` (any one suffices) |
| Disable update check | Env var `OPENCODE_UPDATE_CHECK=0`, or set `"update_check": false` in `~/.config/opencode/config.json` (either suffices; independent of statistics toggle) |
| Delete chat history | Delete the relevant session inside DeskFox, or delete the local DB file directly |
| Revoke / replace a model API key | Settings → Models in DeskFox, or edit the local config file |
| Stop using a model | Switch / remove in the model selector |
| Fully wipe all DeskFox data | Uninstall DeskFox + manually delete the local config directory (see Appendix B) |
| Reset the anonymous install ID | Delete the local config dir (Appendix B) and relaunch — a new UUID is generated |
| Use fully offline | Connect no model providers + disable statistics + disable update check → DeskFox becomes a fully local tool |

### 5.1 On "Deleting Already-Uploaded Statistics Data"

Because the statistics endpoint **stores no fields that can identify you personally** (no email, no name, no IP retained, no account system, no mapping table from `install_id` to a person), **already-uploaded events cannot be linked back to you**. This means:

- There is no operation that can "delete a user's historical statistics" — because we don't have a "user" concept on our side
- After you disable usage statistics, the client **stops collecting and uploading new data immediately**
- Deleting your local `install_id` file (Appendix B) and relaunching generates a new UUID, decoupling from historical statistics (which are anonymous to begin with and cannot be traced)

This is a **privacy advantage** of this Software relative to typical SaaS tools, but it also means we offer no "user data export / lookup" interface — because we **simply don't have any personal data to export or look up**.

---

## 6. Open Source & Auditability

### 6.1 Source Code Hosting

| Repository | URL | Role |
|---|---|---|
| GitHub | https://github.com/zoulukuang/deskfox | Primary / Issues / PRs |
| Gitee | https://gitee.com/zoulukuang/deskfox | China mirror / two-way sync |
| Upstream | https://github.com/anomalyco/opencode | We fork from this (MIT) |

### 6.2 What You Can Verify

Because the code is fully public, you (or any technical person) can:
- **Audit** what we collect and what we don't (just `grep` the source; the event whitelist is in `packages/desktop-electron/src/main/telemetry-strategy.ts`)
- **Build from source** to verify the shipped binaries behave consistently (reproducibility; see [`docs/governance/UPSTREAM-MERGE-GUIDE.md`](../governance/UPSTREAM-MERGE-GUIDE.md) for the build flow)
- **Fork** your own version (MIT permits) and fully bypass DeskFox's statistics and update channels

### 6.3 License

The Software is licensed under the **MIT License** (full text in repo root [`LICENSE`](../../LICENSE)). You must keep the copyright and license text, but may freely use, modify, merge, publish, distribute, sublicense, and sell. The **MIT License** itself contains a strong "AS IS" disclaimer; see Section 8.

---

## 7. Security Notice (Please Read Carefully)

DeskFox has the following **known security limits** in the current version. Please understand them before use:

1. **Installer is unsigned**: For cost reasons, the installer is not code-signed (see [`docs/governance/数字签名问题.md`](../governance/数字签名问题.md)). Windows / macOS may show "unknown publisher / unidentified developer" warnings on first run. **Only proceed if you downloaded from the official GitHub / Gitee Release page above.** Do not run installers from unknown sources — they may be impersonations.

2. **Local data is not encrypted**: Chat history, API keys, and config files are stored in **user-readable form on your machine**. Anyone who can log into your computer account (or any malicious software with that access) can read them. **Protect your account password**; users on shared computers should be especially careful. **We strongly recommend enabling OS-level full-disk encryption** (see 7.1).

3. **Your API key is your asset**: A leaked API key can be used to incur costs. If you suspect a leak, **immediately revoke the key in the model provider's console**, then replace it in DeskFox.

4. **Current version collects no crash data** (as of 2026-05-01): The Software currently integrates **no** crash-reporting mechanism (no Electron `crashReporter`, no Sentry, no breakpad/crashpad, no Rust panic reporter). This means when the Software crashes:
   - **No DeskFox-specific dump file is written locally**
   - **No crash information is reported to DeskFox or any third party**
   - System-level crash behavior (Windows Event Viewer, macOS Console.app) is handled by the operating system and is unrelated to this Software
   
   If crash reporting is added in the future, it will follow Section 10 ("Policy Revisions"): a re-consent dialog will be shown, and only sanitized stack traces will be uploaded — never source data.

### 7.1 Mitigation for "Local Data is Not Encrypted" (Strongly Recommended)

Since the Software does not encrypt local config / chat history / API keys, **we strongly recommend** you enable OS-level full-disk encryption — the lowest-cost industrial security measure:

- **Windows 10/11 Pro and above**: Enable BitLocker (`Settings → Update & Security → Device encryption`, or `Control Panel → BitLocker Drive Encryption`)
- **macOS**: Enable FileVault (`System Settings → Privacy & Security → FileVault → Turn On`)
- **Linux**: Choose LUKS full-disk encryption at install, or use `fscrypt` for the home directory

Full-disk encryption ensures that even if your computer is stolen or its drive removed, others cannot read your DeskFox local data.

---

## 8. Disclaimer & Limitation of Liability

> **Legal note**: This section is a Chinese-friendly elaboration of the default MIT License terms. In case of ambiguity between the Chinese-language wording of this section and the English LICENSE in repo root regarding the specific scope of disclaimer, **the Chinese version of this policy controls** (consistent with the "Chinese version prevails" rule in the policy header). The English MIT LICENSE itself remains independently governed by its original text and international open-source community conventions.

### 8.1 The Software Is Provided "AS IS"

The Software is **provided free of charge, on an "AS IS" basis**, without warranty of any kind, express or implied, including but not limited to warranties of **merchantability, fitness for a particular purpose, and non-infringement**.

DeskFox, the Software's authors, the upstream anomalyco/opencode authors, and all contributors **make no warranty** that:
- The Software is bug-free, fault-free, or uninterrupted
- The Software is suitable for your specific use case
- The Software's output is accurate, reliable, or up-to-date
- The Software is compatible with your hardware, OS, or network
- The Software will work stably with any model provider you connect
- Any specific feature will be retained in future versions

### 8.2 Specific Scenarios for Which DeskFox Bears No Liability

DeskFox **bears no liability** for any direct or indirect loss (including loss of property, data, goodwill, business, opportunity, etc.) arising from the following:

#### A. Data and Device
- Your computer being infected with malware, attacked, or its drive failing, leading to data loss
- Content you create / edit using DeskFox being lost or corrupted due to software bugs, power outage, mis-operation, or any other cause
- Any cost incurred by your API key being leaked, stolen, or maliciously called
- Your model provider account being banned, throttled, charged, or in dispute

#### B. Model Provider Services
- Model responses being incorrect, biased, illegal, misleading, or factually wrong
- Model API outage, throttling, discontinuation, pricing changes, policy changes
- Model providers' data use or data leak behavior
- Any legal dispute between you and any model provider

#### C. Your Use Behavior
- You using DeskFox for illegal purposes or purposes contrary to public morals
- Indirect losses to your work output caused by DeskFox bugs or model errors
- Your violation of any model provider's terms of service
- Profit/loss from your commercial use of DeskFox
- Your processing of others' privacy / commercial secrets / state secrets in DeskFox (see 8.3 on the personal-information-processor role)

#### D. Systems and Third Parties
- OS, WebView2, or hardware incompatibility
- Behavior of third-party plugins / agents / forks / repackaged versions
- Any loss caused by installers from unknown sources (impersonation, malware insertion, repackaging)
- Network outage, model API balance depletion

#### E. Updates and Maintenance
- The Software ceasing to be maintained, updated, or shipped
- Features being removed or changed across upgrades (we will note in changelog but do not guarantee backward compatibility)
- Compatibility issues caused by you skipping update checks

### 8.3 Your Responsibilities (Counterpart)

By using the Software, you accept the following responsibilities:

- **Data backup**: Back up important data yourself, do not rely on any single piece of software
- **API key and account security**: Safeguard yourself, do not leak
- **Model provider choice**: Evaluate and choose trustworthy, compliant providers; agree to their terms yourself
- **Compliant use**: Comply with the laws of your jurisdiction; do not use the Software for illegal activity
- **Scenario fitness**: Evaluate yourself whether the Software is suitable for your scenario (especially commercial); for high-risk fields like compliance, legal, medical, finance, use only with professional guidance
- **Source verification**: Download installers only from official channels (GitHub Release / Gitee Release)
- **Personal-information-processor role (important)**: When you use DeskFox to handle personal information of **others** (customers, employees of an employer, family members, third parties, etc.), under PIPL and similar data-protection regimes, **you** (not the DeskFox project maintainer) are the "personal information processor (controller)" of that data. The DeskFox project maintainer only provides the Software as a tool developer and **does not participate in the content, purpose, target, or flow of your processing**. You are responsible for fulfilling your own notice and consent obligations toward the data subjects, evaluating the legality, reasonableness, and necessity of your processing, and bearing the corresponding legal liability and external compensation responsibility. **In any related dispute, the DeskFox project maintainer does not bear party-to-the-litigation responsibility or compensation liability**.

### 8.4 Liability Cap

To the maximum extent permitted by applicable law, **DeskFox's liability for any loss caused to you by the Software shall not exceed CNY 0 (zero yuan, RMB)** (the Software is provided free of charge, with no consideration whatsoever).

If your jurisdiction does not allow this cap, the lowest cap permitted by local law applies.

---

## 9. Protection of Minors

### 9.1 Intended Audience

DeskFox is positioned as a productivity tool **for adults** and is not directly marketed to minors, nor specifically designed with minor-friendly features.

### 9.2 Children Under 14

Per Article 31 of the **Personal Information Protection Law of the PRC** and Articles 72-77 of the **Law on the Protection of Minors of the PRC**: **children under 14 may not use the Software unsupervised**. If usage is genuinely needed, the guardian **must** review this policy, separately consent to each provision, and supervise the use throughout.

### 9.3 Minors Aged 14 to 18

Minors aged 14 (inclusive) to under 18 must obtain **separate guardian consent** before use, including consent to this policy, the default-on state of usage statistics in Section 3, and any third-party model-provider connections that may arise from using the Software. If the guardian does not consent to default-on usage statistics, "Disable telemetry" can be selected in the first-run dialog.

### 9.4 Data Protection Commitment

The Software **structurally collects no identifying information** (see Sections 2.3, 3.1). Even if minors use it, **DeskFox's side cannot identify minor status nor link data to any specific minor**. This is an additional layer of protection compared to typical SaaS tools.

If you discover that we have inadvertently collected information that can identify a minor (theoretically impossible, but as a fallback), please notify us via the channels in Section 12; we will verify and delete immediately.

---

## 10. Policy Revisions

This policy may be revised alongside software updates. **Material revisions** (e.g., changing data flow, adding new collection items, changing default toggles, modifying disclaimers) **must**:
- Be clearly noted in the corresponding [`docs/installer-versions.md`](../installer-versions.md) entry
- Bump the version number at the top of this file
- Trigger a **mandatory dialog and re-consent** on first launch of the new version

Non-material revisions (typos, link updates, wording polish) may be made directly without separate notice.

A complete revision history is preserved in the source repository's git log: `git log docs/legal/PRIVACY.md` shows the full history.

---

## 11. Governing Law

### 11.1 Primary Law

The interpretation, performance, and dispute resolution of this policy is governed by the laws of **the People's Republic of China** (excluding Hong Kong, Macao, and Taiwan). Specifically including but not limited to:
- Civil Code of the People's Republic of China
- Personal Information Protection Law (PIPL)
- Data Security Law
- Cybersecurity Law
- Law on the Protection of Minors
- Law on the Protection of Consumer Rights and Interests (where applicable, even though the Software is free)

The **MIT License itself** (English text in `LICENSE`) is interpreted per its original text and international open-source community conventions, not affected by this policy.

If any clause of this policy is invalidated by applicable law, **only that clause is invalid**; the rest remain in effect.

In case of dispute over this policy that cannot be resolved through negotiation, either party may file suit at **a competent People's Court within the People's Republic of China** (the specific court being determined under the relevant provisions of the Civil Procedure Law).

### 11.2 Extraterritorial Fallback (GDPR / CCPA, etc.)

The Software is fully open-source and globally downloadable, and may be used by people subject to extraterritorial laws including but not limited to:
- **EU / EEA users** — General Data Protection Regulation (GDPR) may apply
- **California / other US state users** — California Consumer Privacy Act (CCPA / CPRA) may apply
- **Other countries / regions** — local data protection laws may apply

To the extent such extraterritorial laws by their own personal/territorial reach apply to this Software, **we comply with their mandatory requirements** (e.g., GDPR Article 17 right to erasure, Article 20 right to data portability, CCPA "right to know / delete / non-discrimination").

However, because the Software **structurally collects no personally identifiable data** (see Sections 2.3, 3.1, 5.1), most exercisable rights are practically equivalent to "already zero" — we hold no personal data to export or delete.

If any compliance obligation under such extraterritorial law conflicts with this policy (or the existing settings under PRC law), **the mandatory requirement of that extraterritorial law prevails**, but only with respect to that user and that specific conflict; the overall validity of this policy for other users / circumstances is unaffected.

---

## 12. Contact

As an individual open-source project, this Software **does not maintain a private contact email**. All feedback channels go through public repositories — both for traceability and to avoid single-point dependence on a personal email address.

| Purpose | Channel |
|---|---|
| Privacy policy questions / exercise of data subject rights | GitHub Issues: https://github.com/zoulukuang/deskfox/issues (please include "Privacy" in the title for routing) |
| Software bug reports / feature requests | Same as above |
| Gitee feedback | Gitee Issues: https://gitee.com/zoulukuang/deskfox/issues |
| **Security vulnerability disclosure** (private channel) | Submit privately via GitHub Security Advisory: https://github.com/zoulukuang/deskfox/security/advisories/new (**please do not** disclose unfixed security issues in public Issues) |

If your request involves personal information you'd rather not disclose in a public Issue (e.g., when exercising data subject rights and identity verification is needed), the Security Advisory channel above is also available for private submission.

---

## Appendix A: Common Model Provider Privacy Policy Links

> Listed for reference only. **The provider's official policy controls.**

| Provider | Privacy policy / data terms |
|---|---|
| Anthropic Claude | https://www.anthropic.com/legal/privacy |
| OpenAI | https://openai.com/policies/privacy-policy |
| Google Gemini | https://policies.google.com/privacy |
| Others | Check the provider's official site |

## Appendix B: DeskFox Local Data Location

| OS | Path |
|---|---|
| Windows | `%USERPROFILE%\.config\opencode\` |
| macOS | `~/.config/opencode/` |
| Linux | `~/.config/opencode/` |

Update-check local cache: `~/.cache/opencode/update_check.json` (corresponding paths on each OS).

### About the Path Name (Why `opencode/` instead of `deskfox/`?)

DeskFox **currently reuses the upstream anomalyco/opencode directory name `opencode/`**, for compatibility with upstream config (users coming from opencode get their chat history and model settings automatically without migration). Migrating to a dedicated `deskfox/` directory is on the technical-debt list (it constitutes an upstream-modifying change requiring R3 review).

### Coexistence: Both Upstream anomalyco/opencode and DeskFox Installed

If you have **both** upstream anomalyco/opencode and DeskFox installed on the same machine, please note:

- They **share the same config directory** (including the `install_id` file, `config.json`, chat history, model API keys, MCP configs, etc.)
- A change in either side is read by the other on next startup
- Opening the **same project simultaneously** in both can cause data races (SQLite lock contention) — avoid this
- If their versions diverge in schema, opening data from the other can cause corruption (both sides have version-compat handling, but back up first as a precaution)
- **Statistics streams do NOT cross**: DeskFox sends to `telemetry.deskfox.ai`, upstream opencode to its own endpoint (different endpoints; no cross-leakage at code level); however, the same `install_id` will appear in both backends (each side's "unique device count" statistic will include this machine)
- Disabling statistics on one side = disabling on the other (the toggle lives in the shared `config.json`); **this is user-friendly**

To fully wipe DeskFox data: uninstall DeskFox + manually delete the directory above. **Note**: this also clears upstream opencode's local data (if you also use it); back up important chat history first.

---

## Revision History

| Version | Date | Changes |
|---|---|---|
| v1.0 | 2026-05-01 | Initial official release |

> Full revision history (including pre-release draft iterations) is preserved in the source repository's git log; run `git log docs/legal/PRIVACY.md` to view it.
