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
    /// Admit to the inbox now; the prompt has its message ID.
    Admit(RunPrompt, Delivery),
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
    closed: bool,
}

impl Queue {
    pub fn close(&mut self) {
        self.closed = true;
        self.queue.clear();
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
        let local = |prompt: &RunPrompt| {
            !prompt.shell && (is_new(&prompt.text) || is_compact(&prompt.text))
        };
        let ordinary_active = matches!(&self.active, Some(Some(active)) if !active.shell);
        if ordinary_active
            && !prompt.shell
            && prompt
                .command
                .as_ref()
                .and_then(|command| command.source.as_deref())
                != Some("skill")
            && !local(&prompt)
            && !self.queue.iter().any(local)
        {
            self.admissions += 1;
            let delivery = prompt.delivery.unwrap_or(Delivery::Queue);
            let sent = RunPrompt {
                message_id: Some(opencode_api::id::message()),
                ..prompt
            };
            return Submitted::Admit(sent, delivery);
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
            RunPrompt {
                message_id: prompt
                    .message_id
                    .clone()
                    .or_else(|| Some(opencode_api::id::message())),
                ..prompt
            }
        };
        self.admissions = 0;
        self.active = Some(Some(sent.clone()));
        Some(Work::Run(sent))
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
        let Some(Work::Run(run)) = queue.pump() else {
            panic!("a turn")
        };
        assert!(run.message_id.is_some());
        assert_eq!(queue.pump(), None);
        // Enter steers; `prompt.queue` queues; a prompt without a delivery queues.
        let steer = RunPrompt {
            delivery: Some(Delivery::Steer),
            ..text("two")
        };
        let Submitted::Admit(sent, Delivery::Steer) = queue.submit(steer) else {
            panic!("admitted")
        };
        assert!(sent.message_id.is_some());
        assert!(matches!(
            queue.submit(text("three")),
            Submitted::Admit(_, Delivery::Queue)
        ));
        assert!(queue.take_admissions());
        assert!(!queue.take_admissions());
        assert!(!queue.done());
    }

    #[test]
    fn shells_and_local_operations_wait_their_turn() {
        let mut queue = Queue::default();
        let shell = RunPrompt {
            shell: true,
            ..text("ls")
        };
        assert_eq!(
            queue.submit(shell.clone()),
            Submitted::Queued { first: true }
        );
        assert_eq!(queue.pump(), Some(Work::Run(shell)));
        assert!(queue.shell_running());
        // A prompt behind a shell waits here.
        assert_eq!(
            queue.submit(text("after")),
            Submitted::Queued { first: true }
        );
        assert!(queue.done());
        assert!(matches!(queue.pump(), Some(Work::Run(_))));
        assert_eq!(
            queue.submit(text("/compact")),
            Submitted::Queued { first: false }
        );
        // While `/compact` waits, an ordinary prompt waits behind it too.
        assert_eq!(
            queue.submit(text("later")),
            Submitted::Queued { first: true }
        );
        assert!(queue.done());
        assert_eq!(queue.pump(), Some(Work::Compact));
        assert!(queue.done());
        assert!(matches!(queue.pump(), Some(Work::Run(_))));
    }
}
