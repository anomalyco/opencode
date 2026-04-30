# DeskFox Privacy Policy

> **Status**: v0.4 draft (drafted 2026-04-30; subject to final approval by Xiao Nan (笑南) before release)
> **Applies to**: DeskFox v2026.4.29.2 and later (the "Usage Statistics" and "Update Check" sections apply to future versions, see Section 3)
> **Related**: [`docs/installer-versions.md`](../installer-versions.md) / 中文版: [`隐私协议.md`](./隐私协议.md) / Open-source license: [`LICENSE`](../../LICENSE)
> **Language priority**: This policy is published in both Chinese and English. **In case of conflict between the two versions, the Chinese version prevails**; this English version is provided for reference only.

---

## Introduction

Welcome to **DeskFox** (the "Software"). DeskFox is an **individually-developed, open-source desktop tool**, maintained solely by individual developer **Xiao Nan (笑南)**. It helps you read and edit files locally and chat with various AI models. This policy explains **how we handle your data** and what rights you have.

> **Nature of this Software**: This Software is developed and freely open-sourced by Xiao Nan as an **individual developer** in spare time. It does not constitute a commercial service and carries no enterprise-level SLA commitment. Please understand the "individual open-source" nature before use — maintenance cadence, bug response time, and feature iteration are all **unpredictable**, and you should evaluate whether this is suitable for your scenario (especially commercial scenarios). See Section 8 for the disclaimer.

### Why You Can Trust This Policy

This Software is **fully open source**. The source code is hosted on two public repositories:
- GitHub: https://github.com/yuesoue/opencode-for-office-deskfox
- Gitee: https://gitee.com/zoulukuang/opencode-for-office-deskfox

**You can audit the code yourself** to verify whether what we say in this policy is true — what we collect, what we don't, and how data leaves your machine. This is a stronger privacy guarantee than any legal promise.

The Software is licensed under the [**MIT License**](../../LICENSE) (same as upstream [sst/opencode](https://github.com/sst/opencode)). You may use, modify, and distribute it freely, subject to keeping the copyright and license text.

### Our Core Commitment

**Xiao Nan (笑南) does not read or store your chat content, file content, or API keys.** The most we collect is **anonymous aggregate usage statistics** and the **minimum information needed for update checks** (software version, platform), all of which **can be disabled in Settings**.

This policy applies to your full lifecycle of downloading, installing, and using the DeskFox desktop application.

---

## 1. Overall Data Flow (Please Understand the Architecture First)

```
Your computer                              
┌────────────────┐    
│  DeskFox.exe   │ ──┬─→ AI model providers you choose (Claude / GPT / GetBot / ...)
│  (runs local) │   │  Sent: chat text, file content added to context, API requests
│                │   │  ※ Xiao Nan (笑南) is NOT in the middle, we cannot see this
│  local files   │   │
│  chat history  │   ├─→ Xiao Nan (笑南) usage statistics endpoint (starting v[TBD])
│  API keys      │   │  Sent: anonymous device UUID + software version + OS + country/region
│  config        │   │  ※ Contains NO chat / file / API key content
│                │   │  ※ Toggle off in Settings (see Section 3)
│                │   │
│                │   └─→ Xiao Nan (笑南) update check endpoint (starting v[TBD])
│                │      Sent: current software version + platform
│                │      ※ Only checks for new versions; no silent download, no silent install
│                │      ※ Toggle off in Settings (see Section 3)
└────────────────┘
```

Four data channels:

| Channel | Direction | Who can see | Your control |
|---|---|---|---|
| **Chat / file context** | Your computer → Your chosen model provider | Model provider (subject to their privacy policy); **Xiao Nan (笑南) cannot see** | Connect no model = nothing sent |
| **Local data** | Stays on your computer | Only those who can log into your computer account (including you) | Uninstall + delete local dir = fully wiped |
| **Usage statistics** (future) | Your computer → Xiao Nan (笑南) statistics endpoint | Xiao Nan (笑南), **at aggregate level only**, no individual identification | One-click toggle in Settings |
| **Update check** (future) | Your computer → Xiao Nan (笑南) update endpoint | Xiao Nan (笑南), **only version + platform** | One-click toggle in Settings |

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

When you **actively** perform any of the following, data is sent from your computer to your chosen model provider:
- Type and send a message in the chat box
- Use "Right-click → Add to chat" to include file content as context
- Have the model Edit / Write your files (the model needs to read/write file content)
- Line comment review path

**What is sent**: your prompt, file content added to context, your system prompt, agent configuration, etc.

**Important**: These requests are initiated by DeskFox **directly from your machine** and **do not pass through any Xiao Nan (笑南) server**. What the model provider receives, retains, and how they use it is governed by **their respective privacy policies** (see Appendix A for common providers). We recommend reviewing the relevant provider's policy before choosing.

### 2.3 What We Will **Never** Collect (Now or in the Future)

- ❌ **Chat content**: any conversation with any model — never collected
- ❌ **File content / names / paths**: any file you open or edit — never collected
- ❌ **API keys**: never collected
- ❌ **Granular behavior logs**: we do not record which buttons you click or how long you use which feature
- ❌ **Real IP address**: used only to derive coarse region (country/province), then **immediately discarded**, never stored
- ❌ **Identifying information**: name, email, phone, account, biometrics, etc.
- ❌ **Crash reports with real data**: local crash logs stay local by default; if crash reporting is added in the future, it will require separate consent and only sanitized stack traces will be uploaded
- ❌ **Ads / tracking / data sales**: never

---

## 3. Communications with Xiao Nan (笑南)'s Server

DeskFox communicates with Xiao Nan (笑南)'s server **only for the following two purposes**, with strictly limited data:

### 3.1 Usage Statistics (starting v[TBD])

**Purpose**: Understand the overall scale, regional distribution, and version distribution of users, to inform maintenance and localization priorities.

#### What We Collect

| Data point | Example | Purpose |
|---|---|---|
| Anonymous device UUID | `b4c7e2a1-...` (random ID generated locally on first launch) | Counts unique devices; **cannot be linked to your real identity** (we hold no mapping table) |
| Software version | `2026.4.29.2` | Version distribution |
| OS family | `Windows` / `macOS` | OS distribution (no minor version detail) |
| Country / region | Coarse codes like `CN-EastChina` / `US-CA` | Derived from request IP; **the IP itself is immediately discarded** |
| Heartbeat events | "first launch" / "active today" | User count |

#### Frequency
One send on first launch, then **once per day** as a heartbeat (multiple launches in the same day count as one).

#### Default State
**On by default, with a notice dialog on first launch.** You can:
- Click "Don't send statistics" in the dialog to permanently disable
- Toggle anytime via `Settings → Privacy → Usage Statistics`

(This default may be changed to "off by default, opt-in" by Xiao Nan (笑南); see TODO list.)

#### Storage and Retention

| Data form | Retention | Location |
|---|---|---|
| Raw heartbeat records | Destroyed after 30 days | [TBD by Xiao Nan (笑南): in China / overseas] |
| Aggregated statistics (DAU, MAU, regional breakdown) | 12 months | Same |
| Final aggregated trends / charts | Permanent | Same |

### 3.2 Update Check (starting v[TBD])

**Purpose**: Notify you when a new version is available; **you decide** whether to download and update.

#### What We Collect

| Data point | Example | Purpose |
|---|---|---|
| Current software version | `2026.4.29.2` | Server determines whether an update exists |
| Platform | `windows-x64` / `macos-arm64` | Server returns platform-specific update info |

**Not collected**: device UUID, region, IP (used only to send the response, not stored), or anything else.

#### Behavior Boundaries (Important)

- ✅ Only **queries** for new versions
- ✅ If a new version exists, a notification or menu item appears; **you must click** to navigate to download
- ❌ **No silent download** of new versions
- ❌ **No silent install** / no forced upgrade / no replacing files without your knowledge
- ❌ **No tracking of your update behavior** (we don't know whether you accepted the prompt)

#### Frequency
Once on launch (max once per day across multiple launches).

#### Default State
**On by default**, can be disabled at `Settings → Privacy → Update Check`.

#### Difference from Upstream sst/opencode

DeskFox **has disabled the upstream sst/opencode official auto-update channel** (see [`改动日志.md`](../../改动日志.md) entry "禁自动升级") because the upstream channel would overwrite DeskFox with the upstream binary. The update check described here is Xiao Nan (笑南)'s **own** channel, used only to notify of DeskFox's own version updates, unrelated to the upstream channel.

---

## 4. Third-Party Components and Dependencies

### 4.1 Microsoft WebView2

DeskFox uses WebView2 to render its UI. This is a Windows system component maintained by Microsoft. WebView2's own data collection behavior is governed by **Microsoft's privacy statement**, which we cannot influence. See https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution#privacy.

### 4.2 Open-Source Upstream Dependencies

DeskFox is forked from the open-source project [sst/opencode](https://github.com/sst/opencode) under MIT license, and depends on a series of frontend / Rust third-party libraries. These libraries **run as code on your local machine** and do not independently transmit your data. Full dependency manifest in source `package.json` and `Cargo.toml`.

### 4.3 AI Model Providers You Choose

Any model provider you connect to DeskFox (Anthropic Claude / OpenAI / GetBot / Google Gemini / self-hosted / others) **independently processes your request data**, each with its own privacy policy. **Xiao Nan (笑南) is not responsible for model providers' data handling**, but we recommend prioritizing providers with **clear privacy policies and data-non-retention options**.

---

## 5. Your Controls

> The controls listed in this section correspond to the rights of personal information subjects under Articles 13-20 of the **Personal Information Protection Law of the People's Republic of China (PIPL)**, including the right to be informed, to decide, to access, to copy, to correct, to supplement, to delete, and to withdraw consent. If you believe this Software has failed to fulfill these obligations, you may contact Xiao Nan (笑南) directly via Section 12.

You can manage your data at any time:

| What you want | How |
|---|---|
| Disable usage statistics | Settings → Privacy → Usage Statistics → Off (future versions) |
| Disable update check | Settings → Privacy → Update Check → Off (future versions) |
| Delete chat history | Delete the relevant session inside DeskFox, or delete the local DB file directly |
| Revoke / replace a model API key | Settings → Models in DeskFox, or edit the local config file |
| Stop using a model | Switch / remove in the model selector |
| Fully wipe all DeskFox data | Uninstall DeskFox + manually delete the local config directory (Appendix B) |
| Reset anonymous device UUID | Delete the local config dir (Appendix B) and relaunch — a new UUID is generated, decoupling from historical statistics |
| Use fully offline | Connect no model providers + disable statistics + disable update check → DeskFox becomes a fully local tool |

---

## 6. Open Source & Auditability

### 6.1 Source Code Hosting

| Repository | URL | Role |
|---|---|---|
| GitHub | https://github.com/yuesoue/opencode-for-office-deskfox | Primary / Issues / PRs |
| Gitee | https://gitee.com/zoulukuang/opencode-for-office-deskfox | China mirror / two-way sync |
| Upstream | https://github.com/sst/opencode | We fork from this (MIT) |

### 6.2 What You Can Verify

Because the code is fully public, you (or any technical person) can:
- **Audit** what we collect and what we don't (just `grep` the source)
- **Build from source** to verify the shipped binaries behave consistently (reproducibility; see [`docs/governance/UPSTREAM-MERGE-GUIDE.md`](../governance/UPSTREAM-MERGE-GUIDE.md) for the build flow)
- **Fork** your own version (MIT permits) and fully bypass Xiao Nan (笑南)'s statistics and update channels

### 6.3 License

The Software is licensed under the **MIT License** (full text in repo root [`LICENSE`](../../LICENSE)). You must keep the copyright and license text, but may freely use, modify, merge, publish, distribute, sublicense, and sell. The **MIT License** itself contains a strong "AS IS" disclaimer; see Section 8.

---

## 7. Security Notice (Please Read Carefully)

DeskFox has the following **known security limits** in the current version. Please understand them before use:

1. **Installer is unsigned**: For cost reasons, the installer is not code-signed (see [`docs/governance/数字签名问题.md`](../governance/数字签名问题.md)). Windows / macOS may show "unknown publisher / unidentified developer" warnings on first run. **Only proceed if you downloaded from the official GitHub / Gitee Release page above.** Do not run installers from unknown sources — they may be impersonations.
2. **Local data is not encrypted**: Chat history, API keys, and config files are stored in **user-readable form on your machine**. Anyone who can log into your computer account (or any malicious software with that access) can read them. **Protect your account password**; users on shared computers should be especially careful.
3. **Your API key is your asset**: A leaked API key can be used to incur costs. If you suspect a leak, **immediately revoke the key in the model provider's console**, then replace it in DeskFox.

---

## 8. Disclaimer & Limitation of Liability

> **Legal note**: This section is a Chinese-friendly elaboration of the default MIT License terms. In case of conflict between this section and the LICENSE in repo root, **the English LICENSE controls**.

### 8.1 The Software Is Provided "AS IS"

The Software is **provided free of charge, on an "AS IS" basis**, without warranty of any kind, express or implied, including but not limited to warranties of **merchantability, fitness for a particular purpose, and non-infringement**.

Xiao Nan (笑南), the Software's authors, the upstream sst/opencode authors, and all contributors **make no warranty** that:
- The Software is bug-free, fault-free, or uninterrupted
- The Software is suitable for your specific use case
- The Software's output is accurate, reliable, or up-to-date
- The Software is compatible with your hardware, OS, or network
- The Software will work stably with any model provider you choose
- Any specific feature will be retained in future versions

### 8.2 Specific Scenarios for Which Xiao Nan (笑南) Bears No Liability

Xiao Nan (笑南) **bears no liability** for any direct or indirect loss (including loss of property, data, goodwill, business, opportunity, etc.) arising from the following:

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
- Your processing of others' privacy / commercial secrets / state secrets in DeskFox

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

### 8.4 Liability Cap

To the maximum extent permitted by applicable law, **Xiao Nan (笑南)'s liability for any loss caused to you by the Software shall not exceed USD 0** (the Software is provided free of charge).

If your jurisdiction does not allow this cap, the lowest cap permitted by local law applies.

---

## 9. Minors

DeskFox is a productivity tool intended for **adults**. If you are under 14, please do not use it independently. Users between 14 and 18 should use under guardian supervision, with the guardian reviewing this policy on their behalf. We do not **knowingly** collect any data from minors (and structurally, we collect almost nothing — see Sections 2 and 3).

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

The interpretation, performance, and dispute resolution of this policy is governed by the laws of **the People's Republic of China** (excluding Hong Kong, Macao, and Taiwan). Specifically including but not limited to:
- Civil Code of the People's Republic of China
- Personal Information Protection Law (PIPL)
- Data Security Law
- Cybersecurity Law
- Law on the Protection of Consumer Rights and Interests (where applicable, even though the Software is free)

The **MIT License itself** (English text in `LICENSE`) is interpreted per its original text and international open-source community conventions, not affected by this policy.

If any clause of this policy is invalidated by applicable law, **only that clause is invalid**; the rest remain in effect.

In case of dispute over this policy that cannot be resolved through negotiation, either party may file suit at the competent People's Court of **the place where Xiao Nan (笑南) resides**.

---

## 12. Contact

| Purpose | Contact |
|---|---|
| Privacy policy questions | yuexiaonan@gmail.com (placeholder; to be replaced by Xiao Nan (笑南)) |
| Software bug reports / feature requests | GitHub Issues: https://github.com/yuesoue/opencode-for-office-deskfox/issues |
| Gitee feedback | Gitee Issues: https://gitee.com/zoulukuang/opencode-for-office-deskfox/issues |
| Security vulnerability disclosure | Email the address above (please do not disclose unfixed issues in public issues) |

---

## Appendix A: Common Model Provider Privacy Policy Links

> Listed for reference only. **The provider's official policy controls.**

| Provider | Privacy policy / data terms |
|---|---|
| Anthropic Claude | https://www.anthropic.com/legal/privacy |
| OpenAI | https://openai.com/policies/privacy-policy |
| Google Gemini | https://policies.google.com/privacy |
| GetBot | (link to be added) |
| Others | Check the provider's official site |

## Appendix B: DeskFox Local Data Location

> To fully wipe data: uninstall DeskFox, then manually delete the directory below.
> To rotate the anonymous device UUID (decoupling from historical statistics): manually delete the directory and relaunch.

| OS | Path |
|---|---|
| Windows | `%APPDATA%\DeskFox\` (actual path as the software writes; Xiao Nan (笑南) to confirm with `grep` of source before official release) |
| macOS | `~/Library/Application Support/DeskFox/` (same, actual path takes precedence) |

---

## TODO for Xiao Nan (笑南) (Pre-Release Checklist)

Before publishing, please confirm:

### Decided (locked in v0.4)

- [x] **Operator name**: Xiao Nan (笑南), individual developer
- [x] **Governing law**: People's Republic of China
- [x] **CN/EN conflict**: Chinese version prevails
- [x] **EULA / ToS**: **Not separately published.** MIT LICENSE already permits virtually all lawful user actions; Section 8 "Your Responsibilities" already covers compliant use. Together they functionally substitute for an EULA, with a lighter footprint that suits an individual OSS project.

### Pending (awaiting data / decisions)

- [ ] **Official contact email** — currently placeholder `yuexiaonan@gmail.com`; replace with a dedicated email if available
- [ ] **Effective date** (replace "v0.4 draft" in the header)
- [ ] **Statistics rollout version** (replace `v[TBD]` in Section 3.1) — fill in once code lands and ships
- [ ] **Update check rollout version** (replace `v[TBD]` in Section 3.2) — same
- [ ] **Statistics storage location** (in China / overseas — Aliyun / AWS / self-hosted / etc.) — affects PIPL cross-border compliance; fill in when service provider is chosen
- [ ] **Statistics default state** — currently opt-out (on by default); switch to opt-in if preferred
- [ ] **Update check default state** — currently opt-out
- [ ] **Appendix A GetBot link** — fill in GetBot's official privacy policy
- [ ] **Appendix B actual paths** — verify by searching code (`appData` / `dirs::config_dir`)
- [ ] **Minors section** — keep or drop based on your distribution audience
- [ ] **First-run consent dialog** — referenced in Sections 3, 4, 10; decide whether to implement (file as separate feat: `first-run-privacy-dialog`)

---

## Revision History

| Version | Date | Changes | Author |
|---|---|---|---|
| v0.1 (draft) | 2026-04-30 | Initial draft | Claude (drafting) |
| v0.2 (draft) | 2026-04-30 | Added Statistics notice + adjusted core narrative + split CN/EN files | Claude (drafting) |
| v0.3 (draft) | 2026-04-30 | Added OSS statement + repo links + MIT reference + Update Check channel + Disclaimer & Limitation of Liability (Section 8) + Governing Law (Section 11) | Claude (drafting) |
| v0.4 (draft) | 2026-04-30 | Locked in operator = Xiao Nan (individual) / governing law = PRC / CN prevails on conflict / EULA decided not to be separately published; added PIPL Article 13 reference in Section 5; expanded Section 11 with applicable PRC law list and competent court | Claude (drafting; pending final approval by Xiao Nan) |
