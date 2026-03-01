# DECISION_140 Delivery Delta (2026-02-25)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_140_OPENCLAW_WEBPAGE_AND_BIBLE_DELIVERY_GAP.md`

## Historical Recall Path

- `DECISION_136` -> OpenClaw external audit kickoff
- `DECISION_137` -> Substack teachings capture and search delivery
- `DECISION_138` -> Restore mode soul and gateway token continuity
- `DECISION_139` -> Deliverable completeness audit
- `DECISION_140` -> Webpage + bible visibility gap closure

## Assimilated Truth

- `1008 unauthorized: gateway token missing` can be caused by preserved Basic dashboard auth header blocking Bearer injection to gateway.
- Textbook route truth requires both handler correctness and container payload presence; route patch alone is insufficient when doctrine assets are absent in image.
- Bible visibility closure is strongest when portal body, artifact links, and artifact retrieval endpoints are all validated.
- Setup visibility can fail operator experience when relying only on browser Basic auth challenge; a first-party login page + session cookie removes that ambiguity while keeping password gate intact.

## Operational Evidence Anchors

- Railway deployment: `b50cb6c8-bd82-4628-9297-f38643f96fdc` status `SUCCESS`.
- Follow-up hardening deployment: `fab3abac-58e9-4615-9003-05ffd8af31a2` status `SUCCESS`.
- Textbook body proof: `/textbook/` returns `Nate Doctrine Textbook Portal`.
- Bible proof: portal body includes `AI_BIBLE` references and linked mirror path.
- Gateway continuity proof: websocket upgrade returns `101 Switching Protocols` and `connect.challenge` event.
- Setup login proof: `/setup` renders login HTML; `/setup/auth/login` issues `openclaw_dashboard_auth` cookie; cookie-authenticated `/setup` returns full setup page.

## Query Anchors

- `openclaw textbook route serving spa fallback fix`
- `openclaw 1008 unauthorized gateway token missing basic auth bearer`
- `railway docker copy memory doctrine-bible p4nthe0n-openfixer`
- `decision 140 textbook bible visibility closure evidence`
- `openclaw setup page blank basic auth fallback login form cookie`
