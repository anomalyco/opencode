//! The terminal released to another program: the external editor (`$EDITOR`) and a plugin's program in the
//! foreground (ABI 1.6 `Host::foreground`). OpenTUI keeps one pending release, and a second one in the same turn
//! would replace the first unseen, so a release waits in one slot here and a second is refused while it waits.

use std::path::PathBuf;

use opencode_plugin::abi;

use crate::prelude::*;

#[derive(Default)]
pub struct Foreground {
    /// A release is pending or running.
    busy: Cell<bool>,
}

/// Releases the terminal to `task` once the current turn is done, unless another release waits; whether it will. The
/// slot frees once `task` has run, or when it is dropped unrun, as when the TUI exits first.
pub fn release(tui: &Tui, task: impl FnOnce() + 'static) -> bool {
    if tui.foreground.busy.replace(true) {
        return false;
    }
    let slot = Slot(tui.weak());
    tui.app.release_terminal(move |_| {
        let _slot = slot;
        task();
    });
    true
}

/// Frees the slot as it drops.
struct Slot(Weak<Tui>);

impl Drop for Slot {
    fn drop(&mut self) {
        if let Some(tui) = self.0.upgrade() {
            tui.foreground.busy.set(false);
        }
    }
}

/// Runs a plugin's `program` in the foreground once the current turn is done, while `alive` still holds for its
/// plugin, and calls `reply` with `{ "code" }` (and `"signal"` on Unix when a signal ended it) or the error. Every
/// request gets one reply: a refused or dropped one gets an error.
pub fn run(tui: &Tui, program: abi::Foreground, alive: Box<dyn Fn() -> bool>, reply: opencode_plugin::Reply) {
    let answer = Answer(Some(reply));
    // A headless TUI (drive mode) has no terminal to give the program.
    if tui.app.is_headless() {
        return answer.send(Err("no terminal to give the program: the TUI runs headless".to_owned()));
    }
    // Where the TUI works, when that is a directory here: a remote server's directory may not exist locally.
    let cwd = program
        .cwd
        .clone()
        .map(PathBuf::from)
        .or_else(|| Some(PathBuf::from(&tui.directory)).filter(|dir| dir.is_dir()));
    let weak = tui.weak();
    let pending = Rc::new(RefCell::new(Some(answer)));
    let task = {
        let pending = pending.clone();
        move || {
            let Some(answer) = pending.borrow_mut().take() else { return };
            if !alive() {
                return answer.send(Err("the plugin that asked for the program is no longer active".to_owned()));
            }
            let mut command = std::process::Command::new(&program.command);
            command.args(&program.args);
            if let Some(cwd) = &cwd {
                command.current_dir(cwd);
            }
            let result = opencode_util::job::run(&mut command).map(exit);
            let result = result.map_err(|error| format!("{}: {error}", program.command));
            // Once the terminal is set up again: the suspended terminal lost the title, and the program may have set
            // its own, so the last title comes back first, before the reply, which may set another.
            let Some(tui) = weak.upgrade() else { return answer.send(result) };
            tui.app.defer(bind!(tui, |tui, _| {
                crate::features::title::resumed(&tui);
                answer.send(result);
            }));
            tui.app.request_redraw();
        }
    };
    if !release(tui, task) {
        let answer = pending.borrow_mut().take();
        if let Some(answer) = answer {
            answer.send(Err("another program is in the foreground".to_owned()));
        }
    }
}

/// The reply of an exit `status`.
fn exit(status: std::process::ExitStatus) -> Value {
    // Only Unix adds the signal.
    #[cfg_attr(not(unix), allow(unused_mut))]
    let mut reply = json!({ "code": status.code() });
    #[cfg(unix)]
    if let Some(signal) = std::os::unix::process::ExitStatusExt::signal(&status) {
        reply["signal"] = json!(signal);
    }
    reply
}

/// One reply: sent once, or an error when it drops unsent.
struct Answer(Option<opencode_plugin::Reply>);

impl Answer {
    fn send(mut self, result: Result<Value, String>) {
        if let Some(reply) = self.0.take() {
            reply(result);
        }
    }
}

impl Drop for Answer {
    fn drop(&mut self) {
        if let Some(reply) = self.0.take() {
            reply(Err("the program did not run: the TUI exited first".to_owned()));
        }
    }
}
