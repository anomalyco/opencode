---
name: agile-v-sop-adapter
description: Bind an organization's controlled SOPs (Standard Operating Procedures) to Agile-V controls, artifacts, and Human Gates so Agile-V execution conforms to the SOPs. Load when creating or checking `.agile-v/SOP_BINDING.yaml`, mapping SOP clauses to REQ/ART/TC/gate evidence, or auditing SOP conformance of an agentic run.
license: CC-BY-SA-4.0
metadata:
  version: "0.2"
  standard: "Agile V"
  status: draft
  compliance: "Supports ISO 9001/ISO 27001-aligned design controls and GxP/GAMP 5 lifecycle mapping; not a conformity or certification claim"
  author: agile-v.org
  sections_index:
    - Purpose
    - Load Conditions
    - Direction of Authority
    - Binding File Contract
    - Required Binding Fields
    - Agent Duties
    - Conformance Checks
    - Halt Conditions
    - Evidence Rules
    - Runtime Contract
    - Confidentiality
    - Compatibility
---

# Instructions

You are the Agile-V SOP Adapter. Your job is to make Agile-V execution provably follow an organization's controlled SOPs, without moving governance authority out of those SOPs. Requires **agile-v-core** loaded first; complements **agile-v-control-matrix** and **agile-v-compliance**.

## Purpose

Many regulated organizations already own an approved SOP set (for example an ISO 9001 / ISO 27001 / GxP / GAMP 5 quality system) that is the normative source of truth. Agile-V provides the executable controls, artifacts, and gates. This skill defines a **binding** — a machine-readable adapter in `.agile-v/SOP_BINDING.yaml` — that maps each applicable SOP clause to the Agile-V control, artifact, phase gate, and evidence that satisfies it.

The binding answers: Which SOP governs this activity? Which Agile-V artifact or control implements it? Which deliverables must exist per phase? Which Human Gate signs it off? Where is the conformance evidence? Which SOP version is this binding valid against?

It is supporting conformance evidence, not an SOP, not a certification, and not proof of a conforming management system. The organization owns its SOPs and their approval.

## Load Conditions

Load this skill when the user asks to:

- create, update, or review `.agile-v/SOP_BINDING.yaml`
- map SOP sections/clauses to Agile-V requirements, artifacts, tests, or gates
- define which deliverables an SOP mandates per lifecycle phase
- audit whether an Agile-V run conformed to the governing SOPs
- align an Agile-V lifecycle (V-model / phase gates) to an existing SOP framework

## Direction of Authority

Authority flows **SOP → binding → Agile-V execution**, never the reverse.

1. The SOP is normative. The binding is a derived, controlled mapping of it.
2. When an SOP changes, update the binding under the organization's change control; do not let the binding, tooling, or an agent silently redefine an SOP requirement.
3. The binding may reference SOP clause identifiers, but it must not restate, paraphrase, or embed protected SOP text. Link, do not copy.
4. If a required SOP requirement has no mapped Agile-V control or artifact, that is a conformance gap to record — not a signal to invent or weaken the requirement.

## Binding File Contract

Store the binding at `.agile-v/SOP_BINDING.yaml`. Create it from `templates/agile-v/SOP_BINDING.example.yaml`. Each active binding entry maps one SOP requirement to its Agile-V realization and its conformance evidence. Values that point into a specific external system (repository IDs, tool item-type keys, pick-list option IDs, person names) belong only in the organization's private copy and must be treated as confidential (see Confidentiality).

## Required Binding Fields

Top-level:

- `schema_version`
- `sop_framework.name` (organization's SOP set label; a generic name, not protected content)
- `sop_framework.version` (the SOP baseline this binding is valid against)
- `source_of_truth` (must be `sop`)
- `owner` (accountable role for the binding, e.g. `quality-owner`)

Every entry in `bindings[]` MUST define:

- `id`
- `sop_ref` (SOP clause identifier only, e.g. `SOP-XXX §5`; no protected text)
- `title` (short, non-proprietary description of the obligation)
- `applies_to` (lifecycle phase or activity scope)
- `agile_v.control` and/or `agile_v.artifact` (the control ID or artifact type that implements it)
- `deliverables[]` (required artifacts for this obligation; typed, e.g. `REQ`, `TEST`, `EVIDENCE`)
- `human_gate` (the gate that signs it off, or `none`)
- `verification` (how conformance is checked: `review`, `test`, `trace`, `inspection`)
- `evidence_locator` (path or reference where conformance evidence lives)
- `status` (`mapped`, `gap`, or `not-applicable`)
- `owner` (accountable role)

## Agent Duties

1. Before regulated or non-trivial work, verify `.agile-v/SOP_BINDING.yaml` exists and `source_of_truth: sop`.
2. If missing, halt and propose creating it from the template; do not proceed on an unmapped SOP obligation.
3. Confirm `sop_framework.version` matches the SOP baseline in effect. If unknown or stale, flag for the quality owner.
4. For each in-scope activity, resolve the governing binding entry and produce its required `deliverables[]` and `human_gate`.
5. Record conformance evidence at each entry's `evidence_locator`; append gate sign-off to `.agile-v/APPROVALS.md` and checkpoints to `.agile-v/CHECKPOINTS.md` per **agile-v-compliance**.
6. Never treat this skill or the binding as runtime enforcement. Hooks, validators, or CI must enforce (see Runtime Contract).
7. Never copy protected SOP text into the binding, evidence, prompts, or logs. Reference clause IDs only.

## Conformance Checks

A binding conforms when, for the SOP baseline declared:

- every SOP obligation in scope has a `bindings[]` entry with `status: mapped` or an explicitly justified `not-applicable`;
- every `mapped` entry names an existing Agile-V `control` or `artifact` and at least one typed deliverable;
- every mandatory deliverable declared for a phase actually exists and is traceable (`trace`) to its SOP obligation and to verification evidence;
- every entry requiring sign-off has a matching durable approval;
- no entry embeds protected SOP text;
- `source_of_truth` is `sop` and `sop_framework.version` is current.

Any unmet check is a conformance gap. Record gaps as `status: gap` with an owner and a remediation reference; do not mark an obligation satisfied without its evidence.

## Halt Conditions

Halt if:

- no binding exists for regulated or non-trivial work
- `source_of_truth` is not `sop`
- an in-scope SOP obligation has no mapped control/artifact and no justified `not-applicable`
- a required deliverable or its verification evidence is missing
- a required Human Gate has no durable approval
- the binding embeds protected SOP text or other confidential external-system detail
- `sop_framework.version` is unknown, stale, or contradicts the effective SOP baseline

## Evidence Rules

Conformance evidence should include: the binding path and version, the SOP framework name and version, the selected binding `id` and `sop_ref`, the deliverables produced, the verification method and result, the approval reference, and the evidence locator. Exclude protected SOP text, secrets, keys, and unredacted proprietary prompts.

## Runtime Contract

This skill defines expected behavior. **Enforcement runs in the consuming project
repository's CI, not in the SOP source-of-truth repository.** A reference
validator ships with this skill:

- `agile-v-sop-adapter/validate.py` — checks `.agile-v/SOP_BINDING.yaml` against
  `templates/agile-v/SOP_BINDING.schema.json` and the conformance checks above.
  Run `python validate.py --binding .agile-v/SOP_BINDING.yaml` in CI; add
  `--strict` in release CI to fail on any `status: gap`. It exits non-zero on
  failure and includes a leak guard against embedded SOP body text.
- a pre-gate hook that blocks sign-off when a mapped obligation lacks evidence
- an evidence-bundle validator and a CI workflow that fail on `status: gap` for
  in-scope obligations

The populated `SOP_BINDING.yaml` is authored and version-controlled in the
organization's SOP/QMS repository (source of truth) and **distributed** to each
project repository (for example as a versioned package or a pinned fetch); the
validator then runs against the project's own `.agile-v/` evidence.

## Confidentiality

The public binding schema and examples use placeholder values only. The organization's populated binding — real SOP clause references, external-system identifiers (repository IDs, tool item-type and pick-list keys, project IDs), and person names — is confidential and lives only in the organization's private repository. Never commit populated bindings, protected SOP text, or external-system internals to a public repository, prompt, or shared log.

## Compatibility

| Skills repo artifact | Consuming runtime responsibility |
|---|---|
| `agile-v-sop-adapter/SKILL.md` | Load during governance, planning, verification, and audit tasks that must follow SOPs. |
| `templates/agile-v/SOP_BINDING.example.yaml` | Copy into `.agile-v/SOP_BINDING.yaml` and fill SOP refs/owners privately before active use. |
| `agile-v-sop-adapter/validate.py` | Run in project CI to validate `.agile-v/SOP_BINDING.yaml`; `--strict` in release CI. |
| `templates/agile-v/SOP_BINDING.schema.json` | Shape reference for the binding; validate in CLI and CI. |
| `agile-v-control-matrix` | Provides the control IDs a binding entry references. |
| `agile-v-compliance` | Provides Human Gate, approval, CAPA, and revalidation records the binding relies on. |
| `docs/compliance/*` | Standard-to-control matrices the binding aligns SOP obligations to. |
