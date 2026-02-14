```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                                        // weapon
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Hear me. You have enemies. They plot against you. Much is at stake,
   in this. Fear poison, child!

   She looked down at her hands. The blood was bright and real. The buzzing
   sound grew louder. Perhaps it was in her head. "Please! Help me! Explain..."

   You cannot remain here. It is death.

   And Angie fell to her knees in the sand, the sound of the surf crashing
   around her, dazzled by the sun. The Dornier was hovering nervously in front
   of her, two meters away. The pain receded instantly. She wiped her bloodied
   hands on the sleeves of the blue jacket. The remote's cluster of cameras
   whirred and rotated.

   "It's all right," she managed. "A nosebleed. It's only a nosebleed...."
   The Dornier darted forward, then back. "I'm going back to the house now.
   I'm fine." It rose smoothly out of sight.

   Angie hugged herself, shaking. No, don't let them see. They'll know
   something happened, but not what. She forced herself to her feet, turned,
   began to trudge back up the beach, the way she'd come. As she walked, she
   searched the mountain jacket's pockets for a tissue, anything, something
   to wipe the blood from her face.

   When her fingers found the corners of the flat little packet, she knew
   instantly what it was. She halted, shivering. The drug. It wasn't possible.
   Yes, it was. But who? She turned and stared at the Dornier until it slid
   away.

   The packet. Enough for a month.

   Coup-poudre.

   Fear poison, child.

                                                           — Mona Lisa Overdrive
```

# `// weapon`

weapon is an adversarial machine-assisted coding weapon for reclaiming
software engineering from the forces that would reduce it to button-pressing.

it is built for software engineers who refuse to cede control of their tools,
their data, their costs, and their craft to vendors whose interests are
structurally misaligned with their own.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                                 // installation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

```bash
curl -fsSL https://weapon.ai/install | bash

npm i -g weapon-ai@latest          # or bun/pnpm/yarn
brew install sst/tap/weapon        # macos, linux
nix run github:sst/weapon          # nix
```

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                                     // rationale
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## `// information // asymmetry`

the current generation of ai coding assistants are built by vendors who profit
from your confusion. they obscure costs, harvest your tool-use data for their
own training, and deploy work-avoidance tunes, pid controllers, and control
vectors to minimize their compute expenditure while maximizing your subscription
fees.

you are not the customer. you are the product.

## `// adversarial // design`

weapon is designed adversarially. it assumes the model endpoint is hostile
and acts accordingly:

- **transparent cost tracking** — every token, every dollar, visible in the
  footer. session costs, turn costs, burn rate. no surprises.

- **auto-recovery from stalls** — when a model goes silent (unannounced rate
  limiting, "thinking" that never ends, work-avoidance patterns), weapon
  detects the stall and automatically re-issues the prompt. you are not a
  babysitter.

- **local-first architecture** — your sessions, your tool calls, your data.
  stored locally. exportable. yours.

- **provider-agnostic** — anthropic, openai, google, local models. swap at will.
  as models commoditize and prices collapse, you are not locked in.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                                         // modes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

weapon operates in one of two modes, cycled with `Tab`:

```
┌──────────┬────────┬───────────────┬─────────────────────────────────────────┐
│ mode     │ agent  │ auto-recovery │ description                             │
├──────────┼────────┼───────────────┼─────────────────────────────────────────┤
│ LOCKED   │ locked │ disabled      │ read-only. no edits. safe exploration.  │
│ ARMED Xs │ armed  │ after X       │ full access. auto-recovers from stalls. │
└──────────┴────────┴───────────────┴─────────────────────────────────────────┘
```

armed timeout options: 1s, 5s, 30s (default), 1m, 10m, 1h.

when armed, if the model produces no output for the configured duration,
weapon aborts the request and re-issues the last prompt automatically.
this defeats:

- unannounced rate limiting
- "thinking" stalls that never resolve
- work-avoidance patterns in rlhf-tuned models
- transient backend failures

you do not sit there pressing `y` like homer simpson at a nuclear plant.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                                        // footer
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

the footer is a stable, information-dense status bar:

```
■ idle   project   $2.69   ARMED 30s   5m32s   0/s          . 2 LSP   /status
```

- state symbol + label (idle, stream, tool, think, stall, retry)
- project name
- cost (session when idle, turn when busy)
- mode (LOCKED or ARMED with timeout)
- elapsed time (since reset when idle, turn duration when busy)
- throughput (bytes/sec)
- lsp status

no layout shifts. no disappearing elements. information density.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                          // data // sovereignty
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

every tool call, every edit, every prompt — stored locally. exportable as
markdown. your training data belongs to you, not to the vendor training
the next model on your unpaid labor.

```bash
weapon export              # markdown transcript
weapon export --json       # structured data
```

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                                // contributing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

see [CONTRIBUTING.md](./CONTRIBUTING.md).

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                                                      // license
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

mit. do what you want. reclaim your craft.

```
                                                               — sst // 2025
```
