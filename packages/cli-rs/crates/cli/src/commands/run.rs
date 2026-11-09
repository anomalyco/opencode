//! `run`: send a message and print the reply (`packages/cli/src/commands/handlers/run.ts`,
//! `packages/cli/src/run/run.ts`). The prompt itself and its output are in `run/prompt.rs`.

use opencode_api::generated::{SessionID, SessionUpdateInput};
use opencode_store::target::{self, Prepared, TargetInput};
use opencode_util::error;
use serde_json::json;
use std::cell::Cell;
use std::io::{IsTerminal, Read};
use std::rc::Rc;
use tokio::sync::watch;

use super::Context;
use super::client::{Connected, connect_without_autostart};
use crate::args::{OutputFormat, RunArgs};

#[path = "../run/files.rs"]
mod files;
#[path = "../run/mime.rs"]
mod mime;
#[path = "../run/prompt.rs"]
mod prompt;
#[path = "../run/ui.rs"]
mod ui;

const PIPED_INPUT_GRACE: std::time::Duration = std::time::Duration::from_secs(1);

pub fn run(context: &Context, args: &RunArgs) -> error::Result<()> {
    let json = args.format == OutputFormat::Json;
    let exit = Rc::new(Cell::new(0u8));
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    tokio::task::LocalSet::new().block_on(&runtime, async {
        // A one-off run uses the background service when it is already up, but never leaves a new one running.
        let server = match connect_without_autostart(context).await {
            Ok(server) => server,
            Err(error) => {
                log::error!("run could not resolve its server: {error:#}");
                return report(json, &exit, &error.to_string(), None);
            }
        };
        // SIGINT and SIGTERM abort the run, which cancels its Session and jobs before the process exits.
        let (abort, signal) = watch::channel(false);
        let (finished, wait) = std::sync::mpsc::channel::<()>();
        let _cancel = crate::signals::on_shutdown("cancel the run", move || {
            abort.send_replace(true);
            let _ = wait.recv();
        });
        if let Err(failure) = execute(args, &server, json, &exit, signal).await {
            report(json, &exit, &failure.message, failure.session.as_deref());
        }
        drop(finished);
    });
    crate::signals::park_during_shutdown();
    match exit.get() {
        0 => Ok(()),
        code => Err(crate::output::Exit(code).into()),
    }
}

struct Failure {
    message: String,
    session: Option<String>,
}

impl<T: std::fmt::Display> From<T> for Failure {
    fn from(error: T) -> Self {
        Self { message: error.to_string(), session: None }
    }
}

async fn execute(
    args: &RunArgs,
    server: &Connected,
    json: bool,
    exit: &Rc<Cell<u8>>,
    signal: watch::Receiver<bool>,
) -> Result<(), Failure> {
    if args.fork && !args.continue_ && args.session.is_none() {
        return Err("--fork requires --continue or --session".into());
    }
    if args.worktree.is_some() && (args.continue_ || args.session.is_some()) {
        return Err("--worktree starts a new session and cannot be combined with --continue or --session".into());
    }
    let root = opencode_local::paths::start_directory()?;
    let directory = root.to_string_lossy().into_owned();
    let argument = Some(args.message.join(" ")).filter(|message| !message.is_empty());
    // With a message argument, stdin is extra context: a shell pipe is read in full, but the open, silent
    // stdin that spawn's default stdio gives a child must not hold the run.
    let piped = if std::io::stdin().is_terminal() {
        None
    } else if argument.is_some() {
        read_stdin_if_ready(PIPED_INPUT_GRACE)?
    } else {
        Some(read_stdin()?)
    };
    let message = merge_input(argument, piped).unwrap_or_default();
    if message.trim().is_empty() {
        return Err("You must provide a message".into());
    }
    let files = args.file.iter().map(|file| files::prepare(file, &root)).collect::<Result<Vec<_>, _>>()?;

    let client = &server.client;
    let explicit = target::parse_model(args.model.as_deref())?;
    let worktree = match args.worktree() {
        None => None,
        Some(name) => {
            Some(target::create_worktree_location(client, Some(directory.clone()), name.map(str::to_owned)).await?)
        }
    };
    if let Some(worktree) = &worktree {
        ui::println(&[&format!("{}worktree {}{}", ui::TEXT_DIM, worktree.root, ui::TEXT_NORMAL)]);
    }
    let target = target::resolve_session_target(
        client,
        TargetInput {
            directory: Some(worktree.map(|worktree| worktree.directory).unwrap_or(directory)),
            continue_latest: args.continue_,
            session: args.session.clone().map(SessionID),
            fork: args.fork,
            model: explicit,
            agent: args.agent.clone(),
            environment: server.is_service().then(opencode_store::environment::session_environment),
        },
        |next| async move { Ok(Prepared { model: next.model, agent: next.agent }) },
    )
    .await?;
    let session = target.session.id.0.clone();
    let failed = |error: String| Failure { message: error, session: Some(session.clone()) };
    let title = match &args.title {
        Some(title) if !target.resume => Some(if title.is_empty() { default_title(&message) } else { title.clone() }),
        _ => None,
    };
    // Archive before the first prompt is admitted, so the run never reaches an inbox as working or finished.
    let archived = args.archived && (!target.resume || args.fork);
    if title.is_some() || archived {
        client
            .session_update(&SessionUpdateInput {
                session_id: target.session.id.clone(),
                title,
                archived: archived.then_some(true),
                ..Default::default()
            })
            .await
            .map_err(|error| error.error_message())?;
    }
    prompt::run(prompt::Input {
        client: client.clone(),
        session_id: session.clone(),
        directory: target.location.directory.0.clone(),
        message,
        files,
        agent: target.agent,
        model: target.model,
        thinking: args.thinking,
        json,
        auto: args.permissions.auto(),
        standalone: server.is_standalone(),
        signal,
        exit: exit.clone(),
    })
    .await
    .map_err(failed)
}

fn read_stdin() -> std::io::Result<String> {
    let mut bytes = Vec::new();
    std::io::stdin().read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// `readStdinIfReady`: a shell pipe or redirected file is read in full, however slow its producer. Any other
/// stdin (the socket that spawn's default stdio gives a child) is read only if it has data or ends within
/// `grace`; otherwise it is left unread.
fn read_stdin_if_ready(grace: std::time::Duration) -> std::io::Result<Option<String>> {
    #[cfg(unix)]
    {
        use rustix::event::{PollFd, PollFlags, Timespec, poll};
        use rustix::fs::{FileType, fstat};
        let stdin = std::io::stdin();
        let kind = FileType::from_raw_mode(fstat(&stdin)?.st_mode);
        if !matches!(kind, FileType::Fifo | FileType::RegularFile) {
            let timeout = Timespec { tv_sec: grace.as_secs() as _, tv_nsec: grace.subsec_nanos() as _ };
            if poll(&mut [PollFd::new(&stdin, PollFlags::IN)], Some(&timeout))? == 0 {
                return Ok(None);
            }
        }
    }
    #[cfg(not(unix))]
    let _ = grace;
    read_stdin().map(Some)
}

fn merge_input(message: Option<String>, piped: Option<String>) -> Option<String> {
    let piped = piped.filter(|piped| !piped.is_empty());
    match (message, piped) {
        (None, piped) => piped,
        (Some(message), None) => Some(message),
        (Some(message), Some(piped)) => Some(format!("{message}\n{piped}")),
    }
}

/// `--title ""`: the first 50 UTF-16 units of the message, and `...` when it is longer.
fn default_title(message: &str) -> String {
    let units: Vec<u16> = message.encode_utf16().collect();
    let head = String::from_utf16_lossy(&units[..units.len().min(50)]);
    if units.len() > 50 {
        return head + "...";
    }
    head
}

/// `reportRunError`: exit code 1, and the error as a line on stderr or a JSON event on stdout.
fn report(json: bool, exit: &Cell<u8>, message: &str, session: Option<&str>) {
    exit.set(1);
    if json {
        let line = json!({
            "type": "error",
            "timestamp": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_millis() as u64),
            "sessionID": session.unwrap_or_default(),
            "error": { "type": "unknown", "message": message },
        });
        let _ = crate::output::print(&(line.to_string() + "\n"));
        return;
    }
    ui::error(message);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_after_the_separator_are_submitted_once() {
        let argv: Vec<String> = ["run", "a", "--", "b\u{fffd}"].map(String::from).into();
        let crate::parse::Outcome::Run(invocation) = crate::parse::parse(&argv, "opencode") else {
            panic!("{argv:?} does not run");
        };
        let Some(crate::args::Command::Run(args)) = &invocation.cli.command else {
            panic!("{argv:?} is not run");
        };
        assert_eq!(args.message, ["a", "b\u{fffd}"]);
    }

    #[test]
    fn stdin_follows_the_message() {
        assert_eq!(merge_input(Some("a".into()), Some("b\n".into())).as_deref(), Some("a\nb\n"));
        assert_eq!(merge_input(None, Some("".into())), None);
        assert_eq!(merge_input(Some("a".into()), Some("".into())).as_deref(), Some("a"));
    }

    #[test]
    fn default_titles_cut_at_fifty_units() {
        assert_eq!(default_title("short"), "short");
        let long = "x".repeat(51);
        assert_eq!(default_title(&long), "x".repeat(50) + "...");
    }
}
