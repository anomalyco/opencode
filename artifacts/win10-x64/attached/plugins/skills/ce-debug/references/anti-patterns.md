# Debugging Anti-Patterns

Read this before forming hypotheses. These patterns describe the most common ways debugging goes wrong. They feel productive in the moment — that is what makes them dangerous.

---

## Prediction Quality

The prediction requirement exists to prevent symptom-fixing. A prediction tests whether your understanding of the bug is correct, not just whether a fix makes the error go away.

**Bad prediction (restates the hypothesis):**
> Hypothesis: The null pointer is because `user` is not initialized.
> Prediction: `user` will be null when I log it.

This just re-describes the symptom. It cannot be wrong if the hypothesis is right — so it cannot catch a wrong hypothesis.

**Good prediction (tests something non-obvious):**
> Hypothesis: The null pointer is because the auth middleware skips initialization on cached requests.
> Prediction: Non-cached requests to the same endpoint will NOT produce the null pointer, and the `X-Cache` header will be present on failing requests.

This tests a different code path and a different observable. If the prediction is wrong — cached and non-cached requests both fail — the hypothesis is wrong even if "initializing user earlier" happens to fix the immediate error.

**Rule of thumb:** A good prediction names something you have not looked at yet. If confirming the prediction requires only looking at the same line of code you already identified, the prediction is not adding information.

---

## Shotgun Debugging

Changing multiple things at once to "see if it helps."

**How it feels:** Productive. You're making changes, running tests, making progress.

**What actually happens:** If the bug goes away, you do not know which change fixed it. If it persists, you do not know which changes are relevant. You have introduced variables instead of eliminating them.

**The fix:** One hypothesis, one change, one test. If the first change does not fix it, revert it before trying the next. Changes should be additive to understanding, not cumulative to the codebase.

---

## Confirmation Bias

Interpreting ambiguous evidence as supporting your current hypothesis.

**How it looks:**
- A log line that *could* support your theory — you treat it as proof
- A test passes after your change — you declare the bug fixed without checking if the test was actually exercising the failure path
- The error message changes slightly — you interpret the change as "getting closer" instead of recognizing a different failure mode

**The defense:** Before declaring a hypothesis confirmed, ask: "What evidence would DISPROVE this hypothesis?" If you cannot name something that would change your mind, you are not testing — you are justifying.

---

## "It Works Now, Move On"

The bug stops appearing after a change. The temptation is to declare victory and move on.

**When this is a trap:** If you cannot explain WHY the change fixed the bug — the full causal chain from your change through the system to the symptom — you may have:
- Fixed a symptom while the root cause remains
- Introduced a change that masks the bug without resolving it
- Gotten lucky with timing (especially for intermittent bugs)

**The test:** Can you explain the fix to someone else without using the words "somehow" or "I think"? If not, the root cause is not confirmed.

---

## Thoughts That Signal You Are About to Shortcut

These feel like reasonable next steps. They are warning signs that investigation is being skipped.

**Proposing a fix before explaining the cause.** If the words "I think we should change..." come before "the root cause is...", pause. The fix might be right, but without a confirmed causal chain there is no way to know. Explain the cause first.

**Reaching for another attempt without new information.** After 2-3 failed hypotheses, trying a 4th without learning something new from the failures is not debugging — it is guessing with increasing frustration. Stop and diagnose why previous hypotheses failed (see smart escalation).

**Certainty without evidence.** The feeling of "I know what this is" before reading the relevant code. Experienced developers have strong pattern-matching instincts, and they are right often enough to be dangerous when wrong. Read the code even when you are confident.

**Minimizing the scope.** "It is probably just..." — the word "just" signals an assumption that the problem is small. Small problems do not resist 2-3 fix attempts. If you are still debugging, it is not "just" anything.

**Treating environmental differences as irrelevant.** When something works in one environment and fails in another, the difference between environments IS the investigation. Do not dismiss it — compare them systematically.

---

## Smart Escalation Patterns

When 2-3 hypotheses have been tested and none confirmed, the problem is not "I need hypothesis #4." The problem is usually one of these:

**Different subsystems keep appearing.** Hypothesis 1 pointed to auth, hypothesis 2 to the database, hypothesis 3 to caching. This scatter pattern means the bug is not in any one subsystem — it is in the interaction between them, or in an architectural assumption that cuts across all of them. This is a design problem, not a localized bug.

**Evidence contradicts itself.** The logs say X happened, but the code makes X impossible. The test fails with error A, but the code path that produces error A is unreachable from the test. When evidence contradicts, the mental model is wrong. Step back. Re-read the code from the entry point without any assumptions about what it does.

**Works locally, fails elsewhere.** The most common causes: environment variables, dependency versions, file system differences (case sensitivity, path separators), timing differences (faster/slower machines), and data differences (test fixtures vs production data). Systematically compare the two environments rather than debugging the code.

**Fix works but prediction was wrong.** This is the most dangerous pattern. The bug appears fixed, but the causal chain you identified was incorrect. The real cause is still present and will resurface. Keep investigating — you found a coincidental fix, not the root cause.
