#![cfg(windows)]

//! Pipe mode on Windows: no console, one output pipe, job-based kills.
//!
//! The Unix suite in `tests/pipe.rs` keeps its own cases; these only run on
//! Windows. Commands are passed the way OpenCode passes them (`cmd.exe /c
//! <command>`), and longer checks use a PowerShell script file. Windows
//! PowerShell needs `SystemRoot` in its environment to start, so test
//! children get a PATH, SystemRoot and TEMP, never the daemon's own.

use std::collections::HashMap;
use std::env;
use std::fs;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use opencode_pty::service::{
    CreatePipe, MAX_METADATA_BYTES, PipeMetadata, ProcessExit, ProcessInfo, ProcessMode,
    ProcessSignal, TerminalId, TerminalLifecycle, TerminalService,
};
use windows_sys::Win32::Foundation::{ERROR_PRIVILEGE_NOT_HELD, WAIT_OBJECT_0};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject,
};

/// A unique temporary path, removed when dropped even if a test fails.
struct TempPath(PathBuf);

impl TempPath {
    fn new(name: &str) -> Self {
        Self(env::temp_dir().join(format!(
            "opencode-pty-pipe-{name}-{:032x}",
            rand::random::<u128>()
        )))
    }

    fn script(name: &str, extension: &str) -> Self {
        Self(env::temp_dir().join(format!(
            "opencode-pty-pipe-{name}-{:032x}.{extension}",
            rand::random::<u128>()
        )))
    }
}

impl Drop for TempPath {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// A PowerShell script on disk.
struct Script(TempPath);

impl Script {
    fn powershell(name: &str, body: &str) -> Self {
        let path = TempPath::script(name, "ps1");
        fs::write(&path.0, body).unwrap();
        Self(path)
    }

    /// A request that runs the script; `env` replaces the whole environment.
    fn request(&self, output: &Path, env: HashMap<String, String>) -> CreatePipe {
        pipe(
            "powershell.exe",
            vec![
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-ExecutionPolicy".into(),
                "Bypass".into(),
                "-File".into(),
                self.0.0.display().to_string(),
            ],
            output,
            env,
        )
    }
}

fn pipe(
    program: &str,
    args: Vec<String>,
    output: &Path,
    env: HashMap<String, String>,
) -> CreatePipe {
    CreatePipe {
        program: program.into(),
        args,
        cwd: env::current_dir().expect("cwd"),
        env,
        group_id: "pipe".into(),
        output_path: output.to_path_buf(),
        metadata: PipeMetadata::new(),
    }
}

/// A `cmd.exe /c <command>` request, the way OpenCode runs shell commands.
fn cmd(command: &str, output: &Path) -> CreatePipe {
    pipe(
        "cmd.exe",
        vec!["/d".into(), "/c".into(), command.into()],
        output,
        base_env(),
    )
}

/// The daemon's own environment is never inherited, so children get just what
/// their program needs. Windows PowerShell fails to load without SystemRoot.
fn base_env() -> HashMap<String, String> {
    ["PATH", "SystemRoot", "TEMP"]
        .into_iter()
        .filter_map(|name| Some((name.to_string(), env::var(name).ok()?)))
        .collect()
}

/// Starts a request with a fresh output file.
fn start(
    service: &TerminalService,
    request: impl FnOnce(&Path) -> CreatePipe,
) -> (ProcessInfo, TempPath) {
    let file = TempPath::new("out");
    let info = service.create_pipe(request(&file.0)).unwrap();
    (info, file)
}

struct Finished {
    output: String,
    exit: ProcessExit,
    elapsed: Duration,
}

/// Waits for the exit and reads the output file.
fn run(service: &TerminalService, id: TerminalId, file: &TempPath) -> Finished {
    let started = Instant::now();
    let exit = service.wait(id).unwrap().recv().unwrap();
    Finished {
        output: String::from_utf8_lossy(&fs::read(&file.0).unwrap()).into_owned(),
        exit,
        elapsed: started.elapsed(),
    }
}

/// Polls the output file until it holds a whole first line.
fn first_line(file: &TempPath) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let output = fs::read_to_string(&file.0).unwrap_or_default();
        if let Some((line, _)) = output.split_once("\r\n") {
            return line.to_string();
        }
        assert!(Instant::now() < deadline, "no output line");
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Polls a file written by a child until it holds a PID.
fn read_pid(file: &Path) -> u32 {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Ok(text) = fs::read_to_string(file)
            && let Ok(pid) = text.trim().parse()
        {
            return pid;
        }
        assert!(Instant::now() < deadline, "child did not write its PID");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn alive(pid: u32) -> bool {
    // SAFETY: a successful handle is adopted immediately; it is only waited on.
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        return false;
    }
    // SAFETY: OpenProcess returned a new, uniquely owned handle.
    let handle = unsafe { OwnedHandle::from_raw_handle(handle) };
    // SAFETY: the owned handle stays valid through this zero-timeout wait.
    unsafe { WaitForSingleObject(handle.as_raw_handle(), 0) != WAIT_OBJECT_0 }
}

fn wait_dead(pid: u32) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while alive(pid) {
        assert!(Instant::now() < deadline, "process {pid} is still running");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn newlines(bytes: &[u8]) -> u64 {
    bytes.iter().filter(|&&byte| byte == b'\n').count() as u64
}

/// A path as a single-quoted PowerShell string literal.
fn ps_path(path: &Path) -> String {
    path.display().to_string().replace('\'', "''")
}

/// Writes a batch file. Paths are quoted inside the file, where cmd parses
/// them normally; quoting them inside the `/c` argument would be mangled by
/// the MSVCRT escaping applied to command-line arguments.
fn batch(name: &str, lines: &[String]) -> TempPath {
    let path = TempPath::script(name, "cmd");
    fs::write(&path.0, lines.join("\r\n") + "\r\n").unwrap();
    path
}

/// A long-lived PowerShell grandchild in the job that writes its PID, and the
/// batch parent that starts it (staying alive when asked).
struct GrandchildTree {
    /// The script must outlive the child that runs it.
    _inner: Script,
    pid_file: TempPath,
    outer: TempPath,
}

impl GrandchildTree {
    fn start(&self, service: &TerminalService) -> (ProcessInfo, TempPath) {
        start(service, |file| {
            cmd(&self.outer.0.display().to_string(), file)
        })
    }
}

fn grandchild_tree(name: &str, keep_parent_alive: bool) -> GrandchildTree {
    let pid_file = TempPath::new(&format!("{name}-pid"));
    let inner = Script::powershell(
        &format!("{name}-grandchild"),
        &format!(
            r#"
            [System.IO.File]::WriteAllText('{}', "$PID")
            Start-Sleep -Seconds 60
            "#,
            ps_path(&pid_file.0)
        ),
    );
    let mut lines = vec![
        "@echo off".to_string(),
        format!(
            "start /b powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{}\"",
            inner.0.0.display()
        ),
    ];
    if keep_parent_alive {
        lines.push("ping -n 60 127.0.0.1".to_string());
    }
    GrandchildTree {
        _inner: inner,
        pid_file,
        outer: batch(&format!("{name}-outer"), &lines),
    }
}

#[test]
fn reports_ordered_output_and_exit_code_without_a_terminal() {
    let service = TerminalService::default();
    let (info, file) = start(&service, |file| {
        cmd(
            "echo out1&echo err1>&2&echo out2&echo err2>&2&echo out3&echo err3>&2&set /p line=&echo stdin-closed&exit /b 7",
            file,
        )
    });
    assert_eq!(info.mode, ProcessMode::Pipe);
    assert!(info.pty.is_none());
    let pipe = info.pipe.as_ref().unwrap();
    assert_eq!(pipe.output_path, file.0);
    assert_eq!(info.exited_at, None);
    let finished = run(&service, info.id, &file);
    assert_eq!(
        finished.output,
        "out1\r\nerr1\r\nout2\r\nerr2\r\nout3\r\nerr3\r\nstdin-closed\r\n"
    );
    assert_eq!(finished.exit.exit_code, Some(7));
    assert_eq!(finished.exit.signal, None);
    assert_eq!(finished.exit.output_error, None);
    assert_eq!(finished.exit.output_lines, Some(7));
    assert_eq!(finished.exit.final_offset, finished.output.len() as u64);
    let listed = service.list(ProcessMode::Pipe).unwrap();
    assert_eq!(
        listed[0].lifecycle,
        TerminalLifecycle::Exited {
            exit_code: Some(7),
            signal: None
        }
    );
    assert_eq!(listed[0].exited_at, Some(finished.exit.exited_at));
    assert!(listed[0].started_at <= finished.exit.exited_at);
    assert_eq!(listed[0].pipe.as_ref().unwrap().output_lines, 7);
    assert_eq!(listed[0].output_tail, finished.exit.final_offset);
    service.terminate(info.id).unwrap();
}

#[test]
fn fast_exit_without_output_is_reported() {
    let service = TerminalService::default();
    let (info, file) = start(&service, |file| cmd("exit /b 3", file));
    let finished = run(&service, info.id, &file);
    assert_eq!(finished.output, "");
    assert_eq!(finished.exit.exit_code, Some(3));
    assert_eq!(finished.exit.final_offset, 0);
    assert_eq!(finished.exit.output_lines, Some(0));
    service.terminate(info.id).unwrap();
}

#[test]
fn the_child_gets_exactly_the_given_environment() {
    let service = TerminalService::default();
    let system_root = env::var("SystemRoot").unwrap();
    let (info, file) = start(&service, |file| {
        pipe(
            "cmd.exe",
            vec!["/d".into(), "/c".into(), "set".into()],
            file,
            // No PATH and nothing else from the daemon.
            HashMap::from([
                ("ONLY".to_string(), "this".to_string()),
                ("SystemRoot".to_string(), system_root.clone()),
            ]),
        )
    });
    let finished = run(&service, info.id, &file);
    // `set` also prints each drive's current directory as an `=C:` entry, and
    // cmd defines COMSPEC, PATHEXT and PROMPT itself when they are missing;
    // everything else must come from the request.
    let variables = finished
        .output
        .lines()
        .map(|line| line.trim_end_matches('\r'))
        .filter(|line| {
            !line.starts_with('=')
                && !line.starts_with("COMSPEC=")
                && !line.starts_with("PATHEXT=")
                && !line.starts_with("PROMPT=")
                && !line.starts_with("PROCESSOR_ARCHITECTURE=")
        })
        .collect::<Vec<_>>();
    let expected = format!("SystemRoot={system_root}");
    assert_eq!(variables, ["ONLY=this", expected.as_str()]);
    service.terminate(info.id).unwrap();
}

#[test]
fn output_file_keeps_everything_and_is_truncated_on_open() {
    let service = TerminalService::default();
    let file = TempPath::new("full");
    fs::write(&file.0, "earlier output that must go\r\n").unwrap();
    let script = Script::powershell(
        "full",
        r#"
        $lines = (1..20000) -join "`r`n"
        [Console]::Out.Write($lines + "`r`n")
        [Console]::Error.Write("done`r`n")
        "#,
    );
    let info = service
        .create_pipe(script.request(&file.0, base_env()))
        .unwrap();
    let exit = service.wait(info.id).unwrap().recv().unwrap();
    let expected = (1..=20000).map(|n| format!("{n}\r\n")).collect::<String>() + "done\r\n";
    assert_eq!(fs::read_to_string(&file.0).unwrap(), expected);
    assert_eq!(exit.final_offset, expected.len() as u64);
    assert_eq!(exit.output_lines, Some(20001));
    assert_eq!(exit.output_error, None);
    service.terminate(info.id).unwrap();
}

#[test]
fn rejected_requests_never_touch_the_output_file_or_run() {
    let service = TerminalService::default();
    let missing = TempPath::new("missing-directory").0.join("out");
    let marker = TempPath::new("should-not-run");
    let target = TempPath::new("target");
    fs::write(&target.0, "kept").unwrap();
    let existing = TempPath::new("existing");
    fs::write(&existing.0, "kept").unwrap();
    let touch = format!("echo ran> \"{}\"", marker.0.display());
    let mut huge = PipeMetadata::new();
    huge.insert("command".into(), "x".repeat(MAX_METADATA_BYTES).into());
    let mut cases = vec![
        (
            CreatePipe {
                output_path: PathBuf::from("relative.out"),
                ..cmd(&touch, &existing.0)
            },
            "must be absolute",
        ),
        (
            CreatePipe {
                cwd: "relative".into(),
                ..cmd(&touch, &existing.0)
            },
            "cwd must be absolute",
        ),
        (
            CreatePipe {
                metadata: huge,
                ..cmd(&touch, &existing.0)
            },
            "metadata exceeds",
        ),
        (cmd(&touch, &missing), "failed to open output file"),
    ];
    let link = TempPath::new("link");
    let reparse = match std::os::windows::fs::symlink_file(&target.0, &link.0) {
        Ok(()) => {
            cases.push((cmd(&touch, &link.0), "reparse point"));
            true
        }
        // Symbolic link creation needs Developer Mode or an elevated account.
        Err(error) if error.raw_os_error() == Some(ERROR_PRIVILEGE_NOT_HELD as i32) => {
            eprintln!("skipping the reparse point case: {error}");
            false
        }
        Err(error) => panic!("failed to create a symlink: {error}"),
    };
    for (request, error) in cases {
        let message = format!("{:#}", service.create_pipe(request).unwrap_err());
        assert!(message.contains(error), "{message}");
    }
    assert!(service.list(ProcessMode::Pipe).unwrap().is_empty());
    assert_eq!(fs::read_to_string(&existing.0).unwrap(), "kept");
    assert_eq!(fs::read_to_string(&target.0).unwrap(), "kept");
    if reparse {
        assert_eq!(fs::read_to_string(&link.0).unwrap(), "kept");
    }
    // Give a wrongly spawned child time to run before checking.
    std::thread::sleep(Duration::from_millis(100));
    assert!(!marker.0.exists());
}

#[test]
fn output_lines_count_newlines_in_the_file() {
    let service = TerminalService::default();
    for (name, body, expected) in [
        ("two", r#"[Console]::Out.Write("a`nb`nc")"#, Some(2)),
        ("blanks", r#"[Console]::Out.Write("a`n`n`nb`n")"#, Some(4)),
        ("empty", r#"[Console]::Out.Write("")"#, Some(0)),
        (
            "many",
            r#"[Console]::Out.Write(((1..200000) -join "`n"))"#,
            Some(199999),
        ),
        (
            "small",
            r#"for ($i = 1; $i -le 2000; $i++) { [Console]::Out.WriteLine($i) }"#,
            Some(2000),
        ),
        (
            "random",
            r#"
            $bytes = New-Object byte[] 300000
            (New-Object Random).NextBytes($bytes)
            [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
            "#,
            None,
        ),
    ] {
        let script = Script::powershell(name, body);
        let (info, file) = start(&service, |file| script.request(file, base_env()));
        let exit = run(&service, info.id, &file).exit;
        let bytes = fs::read(&file.0).unwrap();
        assert_eq!(exit.output_lines, Some(newlines(&bytes)), "{name}");
        if let Some(expected) = expected {
            assert_eq!(exit.output_lines, Some(expected), "{name}");
        }
        assert_eq!(exit.final_offset, bytes.len() as u64, "{name}");
        let listed = service.get(info.id).unwrap();
        assert_eq!(
            listed.pipe.unwrap().output_lines,
            exit.output_lines.unwrap()
        );
        service.terminate(info.id).unwrap();
    }
}

#[test]
fn wait_blocks_until_the_exit_and_answers_every_waiter() {
    let service = TerminalService::default();
    let script = Script::powershell(
        "wait",
        r#"
        Start-Sleep -Milliseconds 300
        [Console]::Out.WriteLine("done")
        exit 2
        "#,
    );
    let (info, file) = start(&service, |file| script.request(file, base_env()));
    let waits = (0..3)
        .map(|_| service.wait(info.id).unwrap())
        .collect::<Vec<_>>();
    assert!(waits[0].exit.try_recv().is_err());
    let exits = waits
        .iter()
        .map(|wait| wait.recv().unwrap())
        .collect::<Vec<_>>();
    assert!(exits.iter().all(|exit| *exit == exits[0]));
    assert_eq!(exits[0].exit_code, Some(2));
    assert_eq!(exits[0].output_lines, Some(1));
    assert_eq!(fs::read_to_string(&file.0).unwrap(), "done\r\n");
    // After the exit, a new waiter is answered at once.
    let started = Instant::now();
    assert_eq!(service.wait(info.id).unwrap().recv().unwrap(), exits[0]);
    assert!(started.elapsed() < Duration::from_millis(500));
    service.terminate(info.id).unwrap();
    assert!(service.wait(info.id).is_err());
}

#[test]
fn terminate_ends_a_pending_wait_with_an_error() {
    let service = TerminalService::default();
    let (info, _file) = start(&service, |file| cmd("ping -n 30 127.0.0.1 >nul", file));
    let wait = service.wait(info.id).unwrap();
    service.terminate(info.id).unwrap();
    assert_eq!(wait.recv().unwrap_err().to_string(), "terminated");
}

#[test]
fn signal_stops_a_process_and_keeps_its_record() {
    let service = TerminalService::default();
    let (info, file) = start(&service, |file| {
        cmd("echo started&ping -n 30 127.0.0.1 >nul", file)
    });
    first_line(&file);
    service.signal(info.id, ProcessSignal::Term).unwrap();
    let exit = service.wait(info.id).unwrap().recv().unwrap();
    assert_eq!(exit.exit_code, None);
    assert_eq!(exit.signal.as_deref(), Some("SIGTERM"));
    assert_eq!(exit.output_lines, Some(1));
    assert_eq!(
        service.get(info.id).unwrap().lifecycle,
        TerminalLifecycle::Exited {
            exit_code: None,
            signal: Some("SIGTERM".into())
        }
    );
    // What is left of the job is killed again without an error.
    service.signal(info.id, ProcessSignal::Kill).unwrap();
    service.terminate(info.id).unwrap();
    assert!(service.signal(info.id, ProcessSignal::Kill).is_err());
}

#[test]
fn signal_reaches_a_grandchild_in_the_job() {
    let service = TerminalService::default();
    let tree = grandchild_tree("grandchild", true);
    let (info, _file) = tree.start(&service);
    let grandchild = read_pid(&tree.pid_file.0);
    assert!(alive(grandchild));
    service.signal(info.id, ProcessSignal::Term).unwrap();
    let exit = service.wait(info.id).unwrap().recv().unwrap();
    assert_eq!(exit.signal.as_deref(), Some("SIGTERM"));
    wait_dead(grandchild);
    service.terminate(info.id).unwrap();
}

#[test]
fn terminate_does_not_hang_on_a_grandchild() {
    let service = TerminalService::default();
    let tree = grandchild_tree("terminate", true);
    let (info, _file) = tree.start(&service);
    let grandchild = read_pid(&tree.pid_file.0);
    assert!(alive(grandchild));
    let started = Instant::now();
    service.terminate(info.id).unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "{:?}",
        started.elapsed()
    );
    wait_dead(grandchild);
}

#[test]
fn a_noisy_grandchild_still_exits_after_the_drain() {
    let service = TerminalService::default();
    let marker = TempPath::new("noisy-marker");
    let inner = Script::powershell(
        "noisy-grandchild",
        &format!(
            r#"
            # Prove the pipe is live before the parent exits.
            [Console]::Out.Write('x')
            [Console]::Out.Flush()
            [System.IO.File]::WriteAllText('{}', 'started')
            while ($true) {{
                [Console]::Out.Write('x')
            }}
            "#,
            ps_path(&marker.0)
        ),
    );
    // A batch parent: it waits for the marker, so the grandchild is already
    // writing when the parent exits and the drain deadline is exercised.
    let outer = batch(
        "noisy-outer",
        &[
            "@echo off".to_string(),
            format!(
                "start /b powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{}\"",
                inner.0.0.display()
            ),
            ":wait".to_string(),
            format!("if exist \"{}\" goto done", marker.0.display()),
            "ping -n 2 127.0.0.1 >nul".to_string(),
            "goto wait".to_string(),
            ":done".to_string(),
            "exit /b 0".to_string(),
        ],
    );
    let (info, file) = start(&service, |file| cmd(&outer.0.display().to_string(), file));
    let finished = run(&service, info.id, &file);
    assert_eq!(finished.exit.exit_code, Some(0));
    assert!(
        finished.elapsed < Duration::from_secs(10),
        "{:?}",
        finished.elapsed
    );
    service.terminate(info.id).unwrap();
}

#[test]
fn signal_after_a_normal_exit_kills_a_leftover_grandchild() {
    let service = TerminalService::default();
    let tree = grandchild_tree("leftover", false);
    let (info, _file) = tree.start(&service);
    let grandchild = read_pid(&tree.pid_file.0);
    // A descendant holds the pipe, so the exit waits for at most the drain.
    let started = Instant::now();
    let exit = service.wait(info.id).unwrap().recv().unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(exit.exit_code, Some(0));
    assert_eq!(exit.signal, None);
    // The process keeps its record after the exit; the grandchild still runs.
    assert!(alive(grandchild));
    assert_eq!(
        service.get(info.id).unwrap().lifecycle,
        TerminalLifecycle::Exited {
            exit_code: Some(0),
            signal: None
        }
    );
    assert_eq!(service.list(ProcessMode::Pipe).unwrap().len(), 1);
    service.signal(info.id, ProcessSignal::Kill).unwrap();
    wait_dead(grandchild);
    service.terminate(info.id).unwrap();
    assert!(service.list(ProcessMode::Pipe).unwrap().is_empty());
}

#[test]
fn the_stdout_survives_closing_stderr() {
    let service = TerminalService::default();
    let script = Script::powershell(
        "stderr",
        r#"Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class StandardHandles {
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetStdHandle(int handle);
    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);
}
"@
# STD_ERROR_HANDLE - stdout must be a separate handle to the same pipe.
[StandardHandles]::CloseHandle([StandardHandles]::GetStdHandle(-12)) | Out-Null
Start-Sleep -Milliseconds 200
[Console]::Out.WriteLine("after-stderr-closed")
"#,
    );
    let (info, file) = start(&service, |file| script.request(file, base_env()));
    let finished = run(&service, info.id, &file);
    assert_eq!(finished.output, "after-stderr-closed\r\n");
    assert_eq!(finished.exit.exit_code, Some(0));
    service.terminate(info.id).unwrap();
}

#[test]
fn arguments_round_trip_through_the_command_line() {
    let service = TerminalService::default();
    let script = Script::powershell(
        "quoting",
        r#"for ($i = 0; $i -lt $args.Count; $i++) { [Console]::Out.WriteLine("$i<$($args[$i])>") }"#,
    );
    // A trailing backslash needs doubling only when the argument is quoted.
    let args = ["plain", "with space", "say \"hi\"", r"C:\with space\"];
    let (info, file) = start(&service, |file| {
        let mut request = script.request(file, base_env());
        request.args.extend(args.iter().map(|arg| arg.to_string()));
        request
    });
    let finished = run(&service, info.id, &file);
    assert_eq!(
        finished.output,
        "0<plain>\r\n1<with space>\r\n2<say \"hi\">\r\n3<C:\\with space\\>\r\n"
    );
    assert_eq!(finished.exit.exit_code, Some(0));
    service.terminate(info.id).unwrap();
}

#[test]
fn the_child_has_no_console_window() {
    let service = TerminalService::default();
    let script = Script::powershell(
        "console",
        r#"Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ConsoleWindow {
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();
}
"@
$window = [ConsoleWindow]::GetConsoleWindow()
if ($window -eq [IntPtr]::Zero) {
    [Console]::Out.WriteLine("no-console")
} else {
    [Console]::Out.WriteLine("console")
}
"#,
    );
    let (info, file) = start(&service, |file| script.request(file, base_env()));
    let finished = run(&service, info.id, &file);
    assert_eq!(finished.output, "no-console\r\n");
    assert_eq!(finished.exit.exit_code, Some(0));
    service.terminate(info.id).unwrap();
}

#[test]
fn the_output_file_can_be_read_and_deleted_while_open() {
    let service = TerminalService::default();
    let (info, file) = start(&service, |file| {
        cmd("echo started&ping -n 30 127.0.0.1 >nul", file)
    });
    first_line(&file);
    assert!(fs::read_to_string(&file.0).unwrap().starts_with("started"));
    fs::remove_file(&file.0).unwrap();
    service.terminate(info.id).unwrap();
}
