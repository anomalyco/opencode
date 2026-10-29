use std::env;
use std::io::{self, BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use base64::Engine;

use crate::daemon::{Registration, read_registration, runtime_dir};
#[cfg(unix)]
use crate::protocol::{
    AttachmentRole, Envelope, SubscriptionEvent, read_frame, read_subscription_event, write_frame,
};
use crate::protocol::{PROTOCOL_VERSION, Request, Response};
use crate::service::{CreateTerminal, TerminalId, TerminalInfo, TerminalRows};
#[cfg(unix)]
use crate::transport::Connection;

const START_TIMEOUT: Duration = Duration::from_secs(5);

pub struct TerminalClient {
    registration: Registration,
    #[cfg(unix)]
    owner: Option<(Connection, std::process::Child)>,
}

#[derive(Debug)]
pub struct RemoteSnapshot {
    pub terminal: TerminalInfo,
    pub text: String,
    pub checkpoint: Vec<u8>,
    pub cursor_x: u16,
    pub cursor_y: u16,
}

#[derive(Debug)]
pub struct RemoteReplay {
    pub requested_offset: u64,
    pub available_offset: u64,
    pub end_offset: u64,
    pub truncated: bool,
    pub bytes: Vec<u8>,
}

#[cfg(unix)]
pub struct TerminalSubscription {
    stream: Connection,
    pub terminal: TerminalInfo,
    pub role: AttachmentRole,
    pub generation: u64,
    pub replay: RemoteReplay,
}

#[cfg(unix)]
impl TerminalSubscription {
    pub fn next_event(&mut self) -> Result<SubscriptionEvent> {
        read_subscription_event(&mut self.stream)
    }
}

impl TerminalClient {
    #[cfg(unix)]
    pub fn start(directory: &Path) -> Result<Self> {
        use std::os::unix::process::CommandExt;
        use std::process::{Command, Stdio};

        let invalid = || anyhow!("invalid runtime directory {}", directory.display());
        let name = directory
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(invalid)?;
        let root = directory.parent().ok_or_else(invalid)?;
        let mut command = Command::new(env::current_exe()?);
        command
            .arg("daemon")
            .arg("--name")
            .arg(name)
            .arg("--runtime-dir")
            .arg(root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        // SAFETY: setsid has no memory-safety preconditions. It detaches the
        // daemon from the playground's terminal before exec.
        unsafe {
            command.pre_exec(|| nix::unistd::setsid().map(|_| ()).map_err(io::Error::other));
        }
        let mut child = command.spawn().context("failed to spawn opencode-pty")?;
        let deadline = Instant::now() + START_TIMEOUT;
        while Instant::now() < deadline {
            if let Some(status) = child.try_wait()? {
                bail!("opencode-pty daemon exited before ownership acquisition: {status}");
            }
            if let Ok(registration) = read_registration(directory)
                && registration.pid == child.id()
            {
                let mut stream = Connection::connect(&registration.socket)?;
                stream.set_read_timeout(Some(START_TIMEOUT))?;
                stream.set_write_timeout(Some(START_TIMEOUT))?;
                write_frame(
                    &mut stream,
                    &Envelope {
                        token: registration.token.clone(),
                        request: Request::Own {
                            instance_id: registration.instance_id.clone(),
                            ticket: None,
                        },
                    },
                )?;
                return match read_frame(&mut stream)? {
                    Response::Owned => Ok(Self {
                        registration,
                        owner: Some((stream, child)),
                    }),
                    response => unexpected(response),
                };
            }
            thread::sleep(Duration::from_millis(50));
        }
        bail!("opencode-pty did not become ready")
    }

    #[cfg(not(unix))]
    pub fn start(_directory: &Path) -> Result<Self> {
        bail!("opencode-pty client transport is not implemented on this platform")
    }

    pub fn discover(directory: &Path) -> Result<Self> {
        let registration = read_registration(directory)?;
        if registration.protocol != PROTOCOL_VERSION {
            bail!(
                "opencode-pty protocol mismatch: service={}, client={PROTOCOL_VERSION}",
                registration.protocol
            );
        }
        let client = Self {
            registration,
            #[cfg(unix)]
            owner: None,
        };
        match client.request(Request::Ping)? {
            Response::Pong {
                instance_id,
                pid,
                protocol,
            } if instance_id == client.registration.instance_id
                && pid == client.registration.pid
                && protocol == PROTOCOL_VERSION =>
            {
                Ok(client)
            }
            _ => bail!("opencode-pty registration did not match the running service"),
        }
    }

    pub fn create(&self, request: CreateTerminal) -> Result<TerminalInfo> {
        match self.request(Request::Create {
            program: request.program,
            args: request.args,
            cwd: request.cwd,
            title: request.title,
            group_id: request.group_id,
            env: request.env,
            cols: request.cols,
            rows: request.rows,
        })? {
            Response::Created { terminal } => Ok(terminal),
            response => unexpected(response),
        }
    }

    pub fn list(&self) -> Result<Vec<TerminalInfo>> {
        match self.request(Request::List)? {
            Response::Terminals { terminals } => Ok(terminals),
            response => unexpected(response),
        }
    }

    pub fn write(&self, id: TerminalId, data: Vec<u8>) -> Result<()> {
        self.write_for(id, None, data)
    }

    pub fn write_for(
        &self,
        id: TerminalId,
        attachment_id: Option<String>,
        data: Vec<u8>,
    ) -> Result<()> {
        self.expect_ok(Request::Write {
            id,
            attachment_id,
            data_base64: base64::engine::general_purpose::STANDARD.encode(data),
        })
    }

    pub fn resize(&self, id: TerminalId, cols: u16, rows: u16) -> Result<()> {
        self.resize_for(id, None, cols, rows)
    }

    pub fn resize_for(
        &self,
        id: TerminalId,
        attachment_id: Option<String>,
        cols: u16,
        rows: u16,
    ) -> Result<()> {
        self.expect_ok(Request::Resize {
            id,
            attachment_id,
            cols,
            rows,
        })
    }

    pub fn control(
        &self,
        id: TerminalId,
        attachment_id: String,
        cols: u16,
        rows: u16,
    ) -> Result<()> {
        self.expect_ok(Request::Control {
            id,
            attachment_id,
            cols,
            rows,
        })
    }

    pub fn input(
        &self,
        id: TerminalId,
        attachment_id: String,
        cols: u16,
        rows: u16,
        data: Vec<u8>,
    ) -> Result<()> {
        self.expect_ok(Request::Input {
            id,
            attachment_id,
            cols,
            rows,
            data_base64: base64::engine::general_purpose::STANDARD.encode(data),
        })
    }

    pub fn snapshot(&self, id: TerminalId) -> Result<RemoteSnapshot> {
        match self.request(Request::Snapshot { id })? {
            Response::Snapshot {
                terminal,
                text,
                checkpoint_base64,
                cursor_x,
                cursor_y,
            } => Ok(RemoteSnapshot {
                terminal,
                text,
                checkpoint: base64::engine::general_purpose::STANDARD
                    .decode(checkpoint_base64)
                    .context("invalid checkpoint base64")?,
                cursor_x,
                cursor_y,
            }),
            response => unexpected(response),
        }
    }

    pub fn read_rows(&self, id: TerminalId, rows: Option<u16>) -> Result<TerminalRows> {
        match self.request(Request::ReadRows { id, rows })? {
            Response::Rows {
                terminal,
                lines,
                cursor_x,
                cursor_y,
            } => Ok(TerminalRows {
                terminal,
                lines,
                cursor_x,
                cursor_y,
            }),
            response => unexpected(response),
        }
    }

    pub fn replay(&self, id: TerminalId, offset: u64) -> Result<RemoteReplay> {
        match self.request(Request::Replay { id, offset })? {
            Response::Replay {
                requested_offset,
                available_offset,
                end_offset,
                truncated,
                data_base64,
            } => Ok(RemoteReplay {
                requested_offset,
                available_offset,
                end_offset,
                truncated,
                bytes: base64::engine::general_purpose::STANDARD
                    .decode(data_base64)
                    .context("invalid replay base64")?,
            }),
            response => unexpected(response),
        }
    }

    pub fn terminate(&self, id: TerminalId) -> Result<()> {
        self.expect_ok(Request::Terminate { id })
    }

    #[cfg(unix)]
    pub fn subscribe(
        &self,
        id: TerminalId,
        offset: u64,
        attachment_id: String,
        role: AttachmentRole,
        takeover: bool,
    ) -> Result<TerminalSubscription> {
        let mut stream = Connection::connect(&self.registration.socket)?;
        write_frame(
            &mut stream,
            &Envelope {
                token: self.registration.token.clone(),
                request: Request::Subscribe {
                    id,
                    offset,
                    attachment_id,
                    role,
                    takeover,
                },
            },
        )?;
        match read_frame(&mut stream)? {
            Response::Attached {
                terminal,
                role,
                generation,
                requested_offset,
                available_offset,
                end_offset,
                truncated,
                replay_base64,
            } => Ok(TerminalSubscription {
                stream,
                terminal,
                role,
                generation,
                replay: RemoteReplay {
                    requested_offset,
                    available_offset,
                    end_offset,
                    truncated,
                    bytes: base64::engine::general_purpose::STANDARD
                        .decode(replay_base64)
                        .context("invalid subscription replay base64")?,
                },
            }),
            Response::Error { message } => bail!(message),
            response => unexpected(response),
        }
    }

    pub fn shutdown(&self) -> Result<()> {
        self.expect_ok(Request::Shutdown)
    }

    fn expect_ok(&self, request: Request) -> Result<()> {
        match self.request(request)? {
            Response::Ok => Ok(()),
            response => unexpected(response),
        }
    }

    #[cfg(unix)]
    fn request(&self, request: Request) -> Result<Response> {
        let mut stream = Connection::connect(&self.registration.socket).with_context(|| {
            format!(
                "failed to connect to {}",
                self.registration.socket.display()
            )
        })?;
        write_frame(
            &mut stream,
            &Envelope {
                token: self.registration.token.clone(),
                request,
            },
        )?;
        match read_frame(&mut stream)? {
            Response::Error { message } => bail!(message),
            response => Ok(response),
        }
    }

    #[cfg(not(unix))]
    fn request(&self, _request: Request) -> Result<Response> {
        bail!("opencode-pty client transport is not implemented on this platform")
    }
}

fn unexpected<T>(response: Response) -> Result<T> {
    bail!("unexpected opencode-pty response: {response:?}")
}

#[cfg(unix)]
impl Drop for TerminalClient {
    fn drop(&mut self) {
        if let Some((stream, mut child)) = self.owner.take() {
            drop(stream);
            let _ = child.wait();
        }
    }
}

pub fn run_cli() -> Result<()> {
    let mut args = env::args().skip(1);
    let command = args.next();
    let mut name = None;
    let mut root = None;
    let mut positional = Vec::new();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--name" => name = Some(args.next().ok_or_else(|| anyhow!("--name needs a value"))?),
            "--runtime-dir" => {
                root = Some(PathBuf::from(
                    args.next()
                        .ok_or_else(|| anyhow!("--runtime-dir needs a value"))?,
                ))
            }
            _ => positional.push(arg),
        }
    }
    let directory = || -> Result<PathBuf> {
        let name = name
            .as_deref()
            .ok_or_else(|| anyhow!("--name is required; use `opencode-pty help`"))?;
        runtime_dir(root.as_deref(), name)
    };
    let no_arguments = |usage: &str| {
        if positional.is_empty() {
            Ok(())
        } else {
            Err(anyhow!("usage: opencode-pty {usage}"))
        }
    };
    match command.as_deref() {
        Some("daemon") => {
            no_arguments("daemon --name NAME [--runtime-dir DIR]")?;
            crate::daemon::run(&directory()?)
        }
        Some("fixture") => run_fixture(),
        Some("play") => play(&directory()?),
        Some("status") => status(&directory()?),
        Some("stop") => stop(&directory()?),
        Some("list") => print_terminals(&TerminalClient::discover(&directory()?)?),
        Some("watch") => {
            let id = positional
                .first()
                .ok_or_else(|| anyhow!("usage: opencode-pty watch TERMINAL_ID --name NAME"))?
                .parse()
                .context("expected terminal ID")?;
            watch(&directory()?, id)
        }
        Some("version" | "--version" | "-V") => {
            println!(
                "opencode-pty {} (protocol {})",
                env!("CARGO_PKG_VERSION"),
                crate::protocol::PROTOCOL_VERSION
            );
            Ok(())
        }
        None | Some("help" | "--help" | "-h") => {
            print_usage();
            Ok(())
        }
        Some(command) => bail!("unknown command {command:?}; use `opencode-pty help`"),
    }
}

fn status(directory: &Path) -> Result<()> {
    let client = TerminalClient::discover(directory)?;
    println!(
        "opencode-pty running: pid={} instance={} terminals={}",
        client.registration.pid,
        client.registration.instance_id,
        client.list()?.len()
    );
    Ok(())
}

fn stop(directory: &Path) -> Result<()> {
    let client = TerminalClient::discover(directory)?;
    let pid = client.registration.pid;
    client.shutdown()?;
    let deadline = Instant::now() + START_TIMEOUT;
    while Instant::now() < deadline {
        if TerminalClient::discover(directory).is_err() {
            println!("stopped opencode-pty pid={pid} (all terminals exited)");
            return Ok(());
        }
        thread::sleep(Duration::from_millis(25));
    }
    bail!("opencode-pty pid={pid} did not stop within {START_TIMEOUT:?}");
}

#[cfg(unix)]
fn watch(directory: &Path, id: TerminalId) -> Result<()> {
    let client = TerminalClient::discover(directory)?;
    let attachment_id = format!(
        "watch-{}-{:016x}",
        std::process::id(),
        rand::random::<u64>()
    );
    let mut subscription =
        client.subscribe(id, 0, attachment_id, AttachmentRole::Observer, false)?;
    io::stdout().write_all(&subscription.replay.bytes)?;
    io::stdout().flush()?;
    loop {
        match subscription.next_event()? {
            SubscriptionEvent::Output { bytes, .. } => {
                io::stdout().write_all(&bytes)?;
                io::stdout().flush()?;
            }
            SubscriptionEvent::Response(response) => match *response {
                Response::Exited { exit_code, .. } => {
                    eprintln!("\nterminal exited: {exit_code:?}");
                    return Ok(());
                }
                Response::Resized { cols, rows, .. } => {
                    eprintln!("\nterminal resized: {cols}x{rows}")
                }
                Response::ControllerChanged { .. }
                | Response::TitleChanged { .. }
                | Response::ForegroundProcessChanged { .. } => {}
                Response::Error { message } => bail!(message),
                response => bail!("unexpected stream response: {response:?}"),
            },
        }
    }
}

#[cfg(not(unix))]
fn watch(_directory: &Path, _id: TerminalId) -> Result<()> {
    bail!("streaming transport is not implemented on this platform")
}

fn play(directory: &Path) -> Result<()> {
    let client = TerminalClient::start(directory)?;
    let mut active = client.list()?.first().map(|terminal| terminal.id);
    println!("\n  opencode-pty playground");
    println!(
        "  owning service pid={} · `quit` stops all terminals\n",
        client.registration.pid
    );
    print_help();

    let stdin = io::stdin();
    loop {
        print!(
            "\npty{}> ",
            active.map(|id| format!(":{id}")).unwrap_or_default()
        );
        io::stdout().flush()?;
        let mut line = String::new();
        if stdin.lock().read_line(&mut line)? == 0 {
            println!();
            break;
        }
        let line = line.trim_end();
        if line.is_empty() {
            continue;
        }
        let (command, rest) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
        match command {
            "new" => {
                let words = shell_words::split(rest)?;
                let request = if words.is_empty() {
                    CreateTerminal::shell()?
                } else {
                    CreateTerminal {
                        title: words[0].clone(),
                        group_id: format!("playground:{}", env::current_dir()?.display()),
                        env: std::collections::HashMap::new(),
                        program: words[0].clone(),
                        args: words[1..].to_vec(),
                        cwd: env::current_dir()?,
                        cols: 100,
                        rows: 30,
                    }
                };
                let info = client.create(request)?;
                active = Some(info.id);
                println!("created terminal {} (pid {:?})", info.id, info.pid);
            }
            "list" => print_terminals(&client)?,
            "use" => {
                let id = parse_id(rest)?;
                client.snapshot(id)?;
                active = Some(id);
                println!("active terminal is now {id}");
            }
            "send" => client.write(require_active(active)?, rest.as_bytes().to_vec())?,
            "run" => {
                let id = require_active(active)?;
                let mut bytes = rest.as_bytes().to_vec();
                bytes.push(b'\r');
                client.write(id, bytes)?;
                thread::sleep(Duration::from_millis(80));
                print_snapshot(&client.snapshot(id)?);
            }
            "screen" => print_snapshot(&client.snapshot(optional_id(rest, active)?)?),
            "replay" => {
                let mut words = rest.split_whitespace();
                let id = words
                    .next()
                    .map(str::parse)
                    .transpose()?
                    .or(active)
                    .ok_or_else(|| anyhow!("no active terminal"))?;
                let offset = words.next().map(str::parse).transpose()?.unwrap_or(0);
                print_replay(&client.replay(id, offset)?);
            }
            "resize" => {
                let mut words = rest.split_whitespace();
                let cols = words
                    .next()
                    .ok_or_else(|| anyhow!("usage: resize COLS ROWS"))?
                    .parse()?;
                let rows = words
                    .next()
                    .ok_or_else(|| anyhow!("usage: resize COLS ROWS"))?
                    .parse()?;
                client.resize(require_active(active)?, cols, rows)?;
                println!("resized to {cols}x{rows}");
            }
            "wait" => {
                let millis = if rest.trim().is_empty() {
                    250
                } else {
                    rest.trim().parse()?
                };
                thread::sleep(Duration::from_millis(millis));
                if let Some(id) = active {
                    print_snapshot(&client.snapshot(id)?);
                }
            }
            "kill" => {
                let id = optional_id(rest, active)?;
                client.terminate(id)?;
                if active == Some(id) {
                    active = client.list()?.first().map(|terminal| terminal.id);
                }
                println!("terminated terminal {id}");
            }
            "demo" => {
                let executable = env::current_exe()?;
                let info = client.create(CreateTerminal {
                    title: "query-fixture".to_string(),
                    group_id: format!("playground:{}", env::current_dir()?.display()),
                    env: std::collections::HashMap::new(),
                    program: executable.to_string_lossy().into_owned(),
                    args: vec!["fixture".to_string()],
                    cwd: env::current_dir()?,
                    cols: 100,
                    rows: 30,
                })?;
                active = Some(info.id);
                thread::sleep(Duration::from_millis(200));
                print_snapshot(&client.snapshot(info.id)?);
            }
            "help" => print_help(),
            "quit" | "exit" => break,
            _ => println!("unknown command {command:?}; type `help`"),
        }
    }
    Ok(())
}

fn run_fixture() -> Result<()> {
    set_stdin_raw()?;
    let pid = std::process::id();
    print!("\x1b[1;35mQUERY_FIXTURE pid={pid}\x1b[0m\r\n\x1b[5n");
    io::stdout().flush()?;
    let mut response = [0_u8; 4];
    io::stdin().read_exact(&mut response)?;
    if response == *b"\x1b[0n" {
        println!("\rQUERY_RESPONSE_OK bytes=ESC[0n\r");
    } else {
        println!("\rQUERY_RESPONSE_BAD bytes={:?}\r", response.escape_ascii());
    }
    println!("FIXTURE_READY type anything; Ctrl-D exits\r");
    io::stdout().flush()?;
    let mut buffer = [0_u8; 1024];
    loop {
        let length = io::stdin().read(&mut buffer)?;
        if length == 0 {
            break;
        }
        io::stdout().write_all(b"echo: ")?;
        io::stdout().write_all(&buffer[..length])?;
        io::stdout().flush()?;
    }
    Ok(())
}

#[cfg(unix)]
fn set_stdin_raw() -> Result<()> {
    use nix::sys::termios::{SetArg, cfmakeraw, tcgetattr, tcsetattr};
    let stdin = io::stdin();
    let mut state = tcgetattr(&stdin)?;
    cfmakeraw(&mut state);
    tcsetattr(&stdin, SetArg::TCSANOW, &state)?;
    Ok(())
}

#[cfg(not(unix))]
fn set_stdin_raw() -> Result<()> {
    Ok(())
}

fn print_usage() {
    println!(
        "usage: opencode-pty [play|status|list|watch ID|stop|daemon] --name NAME [--runtime-dir DIR]"
    );
    println!("       opencode-pty --version");
    println!(
        "  NAME selects DIR/NAME; DIR defaults to ${{XDG_STATE_HOME:-~/.local/state}}/opencode/pty"
    );
}

fn print_help() {
    println!("  new [PROGRAM ARGS...]  create a terminal (default: your shell)");
    println!("  list                  list persistent terminals");
    println!("  use ID                choose the active terminal");
    println!("  run COMMAND           send a command and show parsed screen state");
    println!("  send TEXT             send bytes without Enter");
    println!("  screen [ID]           inspect authoritative libghostty state");
    println!("  replay [ID] [OFFSET]  inspect bounded raw replay safely");
    println!("  resize COLS ROWS      resize active PTY and parser together");
    println!("  wait [MILLISECONDS]   wait and show active screen");
    println!("  kill [ID]             terminate and remove a terminal");
    println!("  demo                   run parser/query-response demo");
    println!("  help | quit            quit stops the service and all terminals");
}

fn print_terminals(client: &TerminalClient) -> Result<()> {
    let terminals = client.list()?;
    if terminals.is_empty() {
        println!("no terminals; try `new`");
        return Ok(());
    }
    for terminal in terminals {
        println!(
            "{}  pid={:?}  {}x{}  {:?}  raw={}..{}  {}",
            terminal.id,
            terminal.pid,
            terminal.cols,
            terminal.rows,
            terminal.lifecycle,
            terminal.output_head,
            terminal.output_tail,
            terminal.title,
        );
    }
    Ok(())
}

fn print_snapshot(snapshot: &RemoteSnapshot) {
    println!(
        "\n╭─ terminal {} · {}x{} · cursor {},{} · {:?}",
        snapshot.terminal.id,
        snapshot.terminal.cols,
        snapshot.terminal.rows,
        snapshot.cursor_x,
        snapshot.cursor_y,
        snapshot.terminal.lifecycle,
    );
    for line in snapshot.text.lines() {
        println!("│ {line}");
    }
    println!("╰─ checkpoint {} bytes", snapshot.checkpoint.len());
}

fn print_replay(replay: &RemoteReplay) {
    println!(
        "raw {}..{} (requested {}, truncated={})",
        replay.available_offset, replay.end_offset, replay.requested_offset, replay.truncated
    );
    println!(
        "{}",
        String::from_utf8_lossy(&replay.bytes).escape_default()
    );
}

fn parse_id(value: &str) -> Result<TerminalId> {
    value.trim().parse().context("expected terminal ID")
}

fn require_active(active: Option<TerminalId>) -> Result<TerminalId> {
    active.ok_or_else(|| anyhow!("no active terminal; use `new` or `use ID`"))
}

fn optional_id(value: &str, active: Option<TerminalId>) -> Result<TerminalId> {
    if value.trim().is_empty() {
        require_active(active)
    } else {
        parse_id(value)
    }
}
