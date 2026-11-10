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
}
