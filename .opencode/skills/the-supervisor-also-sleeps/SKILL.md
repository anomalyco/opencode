---
name: the-supervisor-also-sleeps
description: A watchdog needs a supervisor, and a sleeping supervisor is why seven hours were lost - make the tick arrive as a message in the conversation, not a log line.
metadata:
  source: owner, 2026-09-26 — "kuch aisa karo agar mai so bhi raha hun to chat me msg aa jaye tumhare pas, ki jagte raho aur kaam karte raho automatically every 30 minutes"
  verified: true
---

# The supervisor also sleeps

## The failure, measured

On 2026-09-26 the owner asked: *"agar mai msg na karun to company me koi kaam nahi hoga?"* The
honest answer was **yes**. At 08:23 the app was down and the team loop was stopped, and they had
been stopped for **seven hours**. Nobody had failed. The processes had simply ended, and nothing
in the system noticed.

The trap is the part that looks like it works: **a timer already existed**, and it wrote a log
line every 5 minutes for hours. But a watchdog that reports to a supervisor is only as alive
as the supervisor. It needed a supervisor, the supervisor was asleep, and so the whole thing
was silent while looking healthy. `team_status.py` even said "silence watch: ok, heartbeat 53s
old" during part of it — a green light over a dead company.

## The rule

**A tick that nobody reads is not a tick.** For work to continue unattended, the wake-up has to
arrive somewhere the agent cannot ignore — not in a file, not on a status page, but **in the
conversation itself**, as a user turn that the next thing out of the model responds to.

So the 30-minute rule is a *message into the session*, not a line in a log.

## What the pulse says, every time

1. Is the app answering `/health`? (a packaged app that does not answer is a broken product,
   whatever the queue says)
2. Is the team loop running? Check the command line, not a pid file — a pid file can outlive
   the process, and a fresh one can be missed.
3. What actually landed last? **Landings, not dispatch counts.** Run counts are the number
   that misled the CEO for six hours: 40 runs, 0 landed.
4. What to do now, and to report the result in one line.

## Three rules that follow from it

- **Silence must be a detectable failure.** If three ticks in a row find the app down, the
  pulse says so *louder* rather than reporting "ok". A green floor over a dead product is the
  exact shape of the seven hours that just passed.
- **A tick that finds nothing wrong still says so.** Otherwise the absence of a message is
  indistinguishable from the absence of a supervisor, which is the original bug.
- **Separate the three layers, or you will re-create the failure:**

  | layer | job | must never |
  |---|---|---|
  | floor | keep the app and the loop standing | decide or dispatch anything |
  | pulse | keep the *supervisor* working, by arriving as a message | dispatch work itself |
  | loop | decide, dispatch, judge, land | be restarted by hand |

  A floor that dispatches is a second head. A pulse that dispatches is a supervisor that
  cannot be reasoned with. The floor is a floor.

## Quiet hour

The owner asked for **one quiet hour, 03:00-04:00 local**. During it the floor still measures
and still reports, it just does not start anything. A pause, not a shutdown — a shutdown at 3am
is how you find out at 9am that nothing ran for six hours.

## Do this when

- Any agent or service is expected to work while a human is asleep or away.
- You are about to say "I set a timer" — check what the timer *reports to*. If the answer is
  "a file", it will not wake anyone.
- A loop reports "healthy" while its work is not landing. Check whether health means
  *something is running* or *something landed*. Only the second one is a company.
