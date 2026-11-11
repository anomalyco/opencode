//! The serial prompt queue (`runtime.queue.ts`) as a state machine the shell drives. Local operations (`/new`,
//! `/compact`) and turns run one at a time. A prompt submitted while an ordinary turn runs goes to the server's
//! inbox right away (steer by default, queue with `prompt.queue`) instead of waiting here.

use std::collections::VecDeque;

use super::parts::{Delivery, RunPrompt, is_compact, is_exit, is_new};

/// What a submit asks the shell to do.
#[derive(Debug, PartialEq)]
pub enum Submitted {
    Ignored,
    Exit,
    /// Admit to the inbox once the admissions before it are done; call [`Queue::next_admission`].
    Admit,
    /// Queued here; call [`Queue::pump`]. `first` clears the first-prompt hint.
    Queued {
        first: bool,
    },
}

/// The next piece of work [`Queue::pump`] hands out.
#[derive(Debug, PartialEq)]
pub enum Work {
    New,
    Compact,
    /// A turn; an ordinary prompt has its message ID.
    Run(RunPrompt),
}

#[derive(Debug, Default)]
pub struct Queue {
    queue: VecDeque<RunPrompt>,
    /// The turn that runs, or `Some(None)` while a local operation does.
    active: Option<Option<RunPrompt>>,
    /// Admissions made while the active turn ran (`admissionVersion`).
    admissions: u32,
    /// Prompts submitted while the active turn ran, admitted one at a time in order, after the turn's own prompt
    /// (the `admissions` chain).
    follow_ups: VecDeque<(RunPrompt, Delivery)>,
    /// The active turn's own prompt is still being admitted (`state.admission`).
    first_pending: bool,
    /// A follow-up's admission is in flight.
    admitting: bool,
    closed: bool,
}

impl Queue {
    pub fn close(&mut self) {
        self.closed = true;
        self.queue.clear();
        self.follow_ups.clear();
    }

    pub fn busy(&self) -> bool {
        self.active.is_some()
    }

    /// The running turn, if it is a shell command.
    pub fn shell_running(&self) -> bool {
        matches!(&self.active, Some(Some(prompt)) if prompt.shell)
    }

    /// `submit`.
    pub fn submit(&mut self, prompt: RunPrompt) -> Submitted {
        if self.closed || (prompt.text.trim().is_empty() && (prompt.shell || !prompt.has_file())) {
            return Submitted::Ignored;
        }
        if !prompt.shell && is_exit(&prompt.text) {
            return Submitted::Exit;
        }
        let local = |prompt: &RunPrompt| !prompt.shell && (is_new(&prompt.text) || is_compact(&prompt.text));
        let ordinary_active = matches!(&self.active, Some(Some(active)) if !active.shell);
        if ordinary_active
            && !prompt.shell
            && prompt.command.as_ref().and_then(|command| command.source.as_deref()) != Some("skill")
            && !local(&prompt)
            && !self.queue.iter().any(local)
        {
            self.admissions += 1;
            let delivery = prompt.delivery.unwrap_or(Delivery::Queue);
            let sent = RunPrompt { message_id: Some(opencode_api::id::message()), ..prompt };
            self.follow_ups.push_back((sent, delivery));
            return Submitted::Admit;
        }
        let first = !local(&prompt);
        self.queue.push_back(prompt);
        Submitted::Queued { first }
    }

    /// The next work when nothing runs.
    pub fn pump(&mut self) -> Option<Work> {
        if self.closed || self.active.is_some() {
            return None;
        }
        let prompt = self.queue.pop_front()?;
        if !prompt.shell && is_new(&prompt.text) {
            self.active = Some(None);
            return Some(Work::New);
        }
        if !prompt.shell && is_compact(&prompt.text) {
            self.active = Some(None);
            return Some(Work::Compact);
        }
        let sent = if prompt.shell {
            prompt
        } else {
            RunPrompt { message_id: prompt.message_id.clone().or_else(|| Some(opencode_api::id::message())), ..prompt }
        };
        self.admissions = 0;
        self.first_pending = !sent.shell;
        self.active = Some(Some(sent.clone()));
        Some(Work::Run(sent))
    }

    /// The active turn's own prompt was admitted, or failed: the follow-ups may go.
    pub fn first_admitted(&mut self) {
        self.first_pending = false;
    }

    /// The next follow-up to admit, once the turn's prompt and the follow-up before it are done.
    pub fn next_admission(&mut self) -> Option<(RunPrompt, Delivery)> {
        if self.closed || self.first_pending || self.admitting {
            return None;
        }
        let next = self.follow_ups.pop_front()?;
        self.admitting = true;
        Some(next)
    }

    /// A follow-up's admission ended, admitted or not; the next one may go.
    pub fn admission_done(&mut self) {
        self.admitting = false;
    }

    /// Whether every follow-up was admitted (`await admissions`).
    pub fn admissions_idle(&self) -> bool {
        !self.admitting && self.follow_ups.is_empty()
    }

    /// Whether prompts were admitted while the active turn ran, so it settles once more before it ends.
    pub fn take_admissions(&mut self) -> bool {
        std::mem::take(&mut self.admissions) > 0
    }

    /// The active work finished. Returns whether more waits.
    pub fn done(&mut self) -> bool {
        self.active = None;
        !self.queue.is_empty() && !self.closed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(text: &str) -> RunPrompt {
        RunPrompt::text(text)
    }

    #[test]
    fn prompts_while_a_turn_runs_go_to_the_inbox() {
        let mut queue = Queue::default();
        assert_eq!(queue.submit(text("  ")), Submitted::Ignored);
        assert_eq!(queue.submit(text("/exit")), Submitted::Exit);
        assert_eq!(queue.submit(text("one")), Submitted::Queued { first: true });
        let Some(Work::Run(run)) = queue.pump() else { panic!("a turn") };
        assert!(run.message_id.is_some());
        assert_eq!(queue.pump(), None);
        // Enter steers; `prompt.queue` queues; a prompt without a delivery queues.
        let steer = RunPrompt { delivery: Some(Delivery::Steer), ..text("two") };
        assert_eq!(queue.submit(steer), Submitted::Admit);
        assert_eq!(queue.submit(text("three")), Submitted::Admit);
        // Follow-ups reach the server in order: after the turn's own prompt, one at a time
        // (`runtime.queue.ts:266-275`).
        assert_eq!(queue.next_admission(), None);
        queue.first_admitted();
        let Some((sent, Delivery::Steer)) = queue.next_admission() else { panic!("two steers") };
        assert_eq!(sent.text, "two");
        assert!(sent.message_id.is_some());
        assert_eq!(queue.next_admission(), None);
        assert!(!queue.admissions_idle());
        queue.admission_done();
        let Some((sent, Delivery::Queue)) = queue.next_admission() else { panic!("three queues") };
        assert_eq!(sent.text, "three");
        queue.admission_done();
        assert!(queue.admissions_idle());
        assert!(queue.take_admissions());
        assert!(!queue.take_admissions());
        assert!(!queue.done());
    }

    #[test]
    fn shells_and_local_operations_wait_their_turn() {
        let mut queue = Queue::default();
        let shell = RunPrompt { shell: true, ..text("ls") };
        assert_eq!(queue.submit(shell.clone()), Submitted::Queued { first: true });
        assert_eq!(queue.pump(), Some(Work::Run(shell)));
        assert!(queue.shell_running());
        // A prompt behind a shell waits here.
        assert_eq!(queue.submit(text("after")), Submitted::Queued { first: true });
        assert!(queue.done());
        assert!(matches!(queue.pump(), Some(Work::Run(_))));
        assert_eq!(queue.submit(text("/compact")), Submitted::Queued { first: false });
        // While `/compact` waits, an ordinary prompt waits behind it too.
        assert_eq!(queue.submit(text("later")), Submitted::Queued { first: true });
        assert!(queue.done());
        assert_eq!(queue.pump(), Some(Work::Compact));
        assert!(queue.done());
        assert!(matches!(queue.pump(), Some(Work::Run(_))));
    }

    /// The queue model (M4): random submits of prompts, commands, shells, `/new` and `/compact`, and the answers to
    /// the work they start, in any order. The harness drives [`Queue`] as `Mini::enqueue`, `pump`, `send`,
    /// `admit_next`, `settle` and `finish` do. The session changes only while no turn is active, so `Mini::settle`
    /// needs no guard, and every follow-up reaches the session of the turn it was submitted during.
    mod model {
        use super::*;
        use crate::prompt::parts::Command as ServerCommand;

        /// SplitMix64.
        struct Rng(u64);

        impl Rng {
            fn next(&mut self) -> u64 {
                self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
                let mut z = self.0;
                z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
                z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
                z ^ (z >> 31)
            }

            fn below(&mut self, n: u64) -> u64 {
                self.next() % n
            }
        }

        fn env(name: &str, default: u64) -> u64 {
            std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
        }

        #[derive(Clone, Copy, Debug)]
        enum Kind {
            Prompt,
            Steer,
            New,
            Compact,
            Shell,
            Command,
            Skill,
        }

        #[derive(Clone, Copy, Debug)]
        enum Step {
            Submit(Kind),
            /// The turn's own prompt was admitted, or failed.
            Answer(bool),
            /// The follow-up in flight was admitted.
            Admitted,
            /// The session settled.
            Settled,
            /// `/new`, `/compact` or a shell command ended.
            Ended,
        }

        fn step(rng: &mut Rng) -> Step {
            const KINDS: [Kind; 7] =
                [Kind::Prompt, Kind::Steer, Kind::New, Kind::Compact, Kind::Shell, Kind::Command, Kind::Skill];
            match rng.below(10) {
                0..=3 => Step::Submit(KINDS[rng.below(KINDS.len() as u64) as usize]),
                4 => Step::Answer(rng.below(4) > 0),
                5..=6 => Step::Admitted,
                7..=8 => Step::Settled,
                _ => Step::Ended,
            }
        }

        fn prompt(kind: Kind) -> RunPrompt {
            let command = |source: Option<&str>| ServerCommand {
                name: "review".into(),
                arguments: String::new(),
                source: source.map(str::to_owned),
            };
            match kind {
                Kind::Prompt => text("hello"),
                Kind::Steer => RunPrompt { delivery: Some(Delivery::Steer), ..text("steer") },
                Kind::New => text("/new"),
                Kind::Compact => text("/compact"),
                Kind::Shell => RunPrompt { shell: true, ..text("ls") },
                Kind::Command => RunPrompt { command: Some(command(None)), ..text("/review") },
                Kind::Skill => RunPrompt { command: Some(command(Some("skill"))), ..text("/review") },
            }
        }

        /// The work in flight, as the shell runs it.
        enum Running {
            /// A turn, whose own prompt is admitted (`answered`) before it settles.
            Turn {
                command: bool,
                answered: bool,
            },
            Shell,
            New,
            Compact,
        }

        #[derive(Default)]
        struct Shell {
            queue: Queue,
            /// The session; `/new` opens the next one.
            session: u32,
            /// The work in flight and the session it started in.
            running: Option<(Running, u32)>,
            /// The session of the turn each follow-up was submitted during, in order.
            owners: VecDeque<u32>,
            /// The follow-up in flight: the session it goes to, and the one it belongs to.
            admitting: Option<(u32, u32)>,
            settling: bool,
            settle_after: bool,
            /// The follow-ups admitted.
            admitted: usize,
        }

        impl Shell {
            fn run(&mut self, step: Step) -> Result<(), String> {
                match step {
                    Step::Submit(kind) => match self.queue.submit(prompt(kind)) {
                        Submitted::Admit => {
                            let Some((Running::Turn { .. }, session)) = &self.running else {
                                return Err("a follow-up without a turn".into());
                            };
                            self.owners.push_back(*session);
                            self.admit_next();
                        }
                        Submitted::Queued { .. } => self.pump(),
                        Submitted::Ignored | Submitted::Exit => {}
                    },
                    // `Mini::send`'s answer.
                    Step::Answer(ok) => {
                        let Some((Running::Turn { command, answered: answered @ false }, _)) = &mut self.running else {
                            return Ok(());
                        };
                        *answered = true;
                        let command = *command;
                        self.queue.first_admitted();
                        self.admit_next();
                        if ok && !command {
                            self.settle();
                            return Ok(());
                        }
                        if self.settle_admissions() {
                            return Ok(());
                        }
                        return self.finish();
                    }
                    Step::Admitted => {
                        let Some((target, owner)) = self.admitting.take() else { return Ok(()) };
                        if target != owner {
                            return Err(format!("a follow-up of session {owner} went to session {target}"));
                        }
                        self.admitted += 1;
                        self.queue.admission_done();
                        self.admit_next();
                    }
                    Step::Settled => {
                        if !std::mem::take(&mut self.settling) || self.settle_admissions() {
                            return Ok(());
                        }
                        return self.finish();
                    }
                    Step::Ended => match &self.running {
                        // `Mini::opened`.
                        Some((Running::New, _)) => {
                            if matches!(self.queue.active, Some(Some(_))) {
                                return Err("the session changed while a turn was active".into());
                            }
                            self.session += 1;
                            return self.finish();
                        }
                        Some((Running::Compact | Running::Shell, _)) => return self.finish(),
                        _ => {}
                    },
                }
                Ok(())
            }

            /// `Mini::pump`.
            fn pump(&mut self) {
                let running = match self.queue.pump() {
                    None => return,
                    Some(Work::New) => Running::New,
                    Some(Work::Compact) => Running::Compact,
                    Some(Work::Run(prompt)) if prompt.shell => Running::Shell,
                    Some(Work::Run(prompt)) => Running::Turn { command: prompt.command.is_some(), answered: false },
                };
                self.running = Some((running, self.session));
            }

            /// `Mini::admit_next`.
            fn admit_next(&mut self) {
                if self.queue.next_admission().is_none() {
                    if self.queue.admissions_idle() && std::mem::take(&mut self.settle_after) {
                        self.settle();
                    }
                    return;
                }
                let owner = self.owners.pop_front().expect("an owner per follow-up");
                self.admitting = Some((self.session, owner));
            }

            /// `Mini::settle_admissions`.
            fn settle_admissions(&mut self) -> bool {
                if !self.queue.take_admissions() {
                    return false;
                }
                match self.queue.admissions_idle() {
                    true => self.settle(),
                    false => self.settle_after = true,
                }
                true
            }

            fn settle(&mut self) {
                assert!(!self.settling, "one settle at a time");
                self.settling = true;
            }

            /// `Mini::finish`: a turn ends in the session it started in.
            fn finish(&mut self) -> Result<(), String> {
                let Some((running, session)) = self.running.take() else {
                    return Err("finished without work".into());
                };
                if matches!(running, Running::Turn { .. }) && session != self.session {
                    return Err(format!("a turn of session {session} ended in session {}", self.session));
                }
                if self.queue.done() {
                    self.pump();
                }
                Ok(())
            }

            fn idle(&self) -> bool {
                self.running.is_none() && self.admitting.is_none() && !self.settling
            }

            /// Answers everything in flight until nothing is.
            fn drain(&mut self) -> Result<(), String> {
                for _ in 0..1000 {
                    if self.idle() {
                        if self.queue.busy() || !self.queue.admissions_idle() {
                            return Err("the queue is stuck".into());
                        }
                        return Ok(());
                    }
                    for step in [Step::Admitted, Step::Answer(true), Step::Settled, Step::Ended] {
                        self.run(step)?;
                    }
                }
                Err("the drain does not end".into())
            }
        }

        /// Runs `steps`, then drains; the sessions `/new` opened and the follow-ups admitted.
        fn play(steps: &[Step]) -> Result<(u32, usize), String> {
            let mut shell = Shell::default();
            for (index, step) in steps.iter().enumerate() {
                shell.run(*step).map_err(|error| format!("at {index}: {error}"))?;
            }
            shell.drain().map(|()| (shell.session, shell.admitted))
        }

        /// A follow-up of a command turn is admitted to its session before a queued `/new` opens the next one.
        #[test]
        fn a_command_turn_admits_its_follow_ups_before_a_new_session() {
            let steps = [
                Step::Submit(Kind::Command),
                Step::Submit(Kind::Prompt),
                Step::Submit(Kind::Steer),
                Step::Submit(Kind::New),
                Step::Answer(true),
                Step::Ended,
            ];
            assert_eq!(play(&steps), Ok((1, 2)));
        }

        /// Removes one step at a time while the run still fails.
        fn shrink(mut steps: Vec<Step>) -> Vec<Step> {
            let mut index = 0;
            while index < steps.len() {
                let mut shorter = steps.clone();
                shorter.remove(index);
                if play(&shorter).is_err() {
                    steps = shorter;
                } else {
                    index += 1;
                }
            }
            steps
        }

        #[test]
        fn the_session_changes_only_while_no_turn_runs() {
            let seed = env("MODEL_SEED", 1);
            let cases = env("MODEL_CASES", 500);
            let len = env("MODEL_LEN", 40) as usize;
            let mut rng = Rng(seed);
            let (mut opened, mut admitted) = (0, 0);
            for case in 0..cases {
                let steps: Vec<Step> = (0..len).map(|_| step(&mut rng)).collect();
                match play(&steps) {
                    Ok((sessions, follow_ups)) => {
                        opened += u64::from(sessions);
                        admitted += follow_ups as u64;
                    }
                    Err(error) => {
                        let shrunk = shrink(steps);
                        panic!("seed {seed} case {case}: {error}\nshrunk: {shrunk:?}\n{:?}", play(&shrunk));
                    }
                }
            }
            assert!(opened >= cases && admitted >= cases, "coverage: {opened} sessions, {admitted} follow-ups");
        }
    }
}
