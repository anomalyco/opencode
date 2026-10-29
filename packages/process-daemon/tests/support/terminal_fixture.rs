//! A real PTY child shared by direct-service and daemon tests.
//!
//! Include this module as `terminal_fixture`. `Fixture::request` launches this
//! test executable's ignored `terminal_fixture::child` test. The private TCP
//! channel controls the fixture and observes stdin without echoing it back into
//! the PTY (which could conceal lost or duplicated terminal replies).

use std::env;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use opencode_pty::service::CreateTerminal;
use serde::{Deserialize, Serialize};

const ADDRESS: &str = "OPENCODE_PTY_FIXTURE_ADDRESS";
const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Serialize, Deserialize)]
pub enum Command {
    Output(String),
    Read(usize),
    Size,
    Context,
    Exit(i32),
    Flood,
}

pub struct Fixture {
    listener: TcpListener,
}

impl Fixture {
    pub fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        Self { listener }
    }

    pub fn request(&self) -> CreateTerminal {
        CreateTerminal {
            program: env::current_exe().unwrap().to_str().unwrap().to_owned(),
            args: [
                "--ignored",
                "--exact",
                "terminal_fixture::child",
                "--nocapture",
                "--test-threads=1",
            ]
            .map(str::to_owned)
            .into(),
            cwd: env::current_dir().unwrap(),
            title: "terminal-fixture".into(),
            group_id: "terminal-fixture".into(),
            env: [(
                ADDRESS.into(),
                self.listener.local_addr().unwrap().to_string(),
            )]
            .into(),
            cols: 80,
            rows: 24,
        }
    }

    pub fn connect(&self) -> Connection {
        let deadline = Instant::now() + TIMEOUT;
        let stream = loop {
            match self.listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "PTY child did not connect");
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("PTY child connection: {error}"),
            }
        };
        // BSD sockets inherit the listener's nonblocking mode on accept.
        stream.set_nonblocking(false).unwrap();
        stream.set_read_timeout(Some(TIMEOUT)).unwrap();
        stream.set_write_timeout(Some(TIMEOUT)).unwrap();
        let mut connection = Connection(BufReader::new(stream));
        assert_eq!(connection.receive(), serde_json::json!("ready"));
        connection
    }
}

pub struct Connection(BufReader<TcpStream>);

impl Connection {
    pub fn command(&mut self, command: Command) -> serde_json::Value {
        send(self.0.get_mut(), &command);
        self.receive()
    }

    fn receive(&mut self) -> serde_json::Value {
        let mut line = String::new();
        assert_ne!(
            self.0.read_line(&mut line).unwrap(),
            0,
            "PTY child disconnected"
        );
        serde_json::from_str(&line).unwrap()
    }
}

fn send(stream: &mut TcpStream, value: &impl Serialize) {
    serde_json::to_writer(&mut *stream, value).unwrap();
    stream.write_all(b"\n").unwrap();
}

/// Fail a hung runtime test instead of leaving the native CI worker stuck in a
/// destructor. Successful tests cancel this watchdog; it is not runtime cleanup.
pub struct Deadline(mpsc::Sender<()>);

impl Deadline {
    pub fn new() -> Self {
        let (send, receive) = mpsc::channel();
        let test = thread::current().name().unwrap_or("unknown").to_owned();
        thread::spawn(move || {
            if receive.recv_timeout(Duration::from_secs(45)).is_err() {
                eprintln!("PTY runtime test {test} exceeded 45 seconds");
                std::process::exit(124);
            }
        });
        Self(send)
    }
}

impl Drop for Deadline {
    fn drop(&mut self) {
        let _ = self.0.send(());
    }
}

#[test]
#[ignore = "subprocess fixture, launched with a private control channel"]
fn child() {
    // `cargo test -- --include-ignored` runs this entry directly; only a test
    // that launched it provides the control channel.
    let Ok(address) = env::var(ADDRESS) else {
        return;
    };
    configure_console();
    let stream = TcpStream::connect(address).unwrap();
    stream.set_read_timeout(Some(TIMEOUT)).unwrap();
    stream.set_write_timeout(Some(TIMEOUT)).unwrap();
    let mut channel = BufReader::new(stream);
    send(channel.get_mut(), &"ready");
    loop {
        let mut line = String::new();
        if channel.read_line(&mut line).unwrap() == 0 {
            std::process::exit(0);
        }
        let result = match serde_json::from_str(&line).unwrap() {
            Command::Output(text) => {
                let mut stdout = io::stdout().lock();
                stdout.write_all(text.as_bytes()).unwrap();
                stdout.flush().unwrap();
                serde_json::Value::Null
            }
            Command::Read(len) => {
                let mut bytes = vec![0; len];
                io::stdin().read_exact(&mut bytes).unwrap();
                serde_json::json!(bytes)
            }
            Command::Size => serde_json::json!(console_size()),
            Command::Context => serde_json::json!({
                "pid": std::process::id(),
                "cwd": env::current_dir().unwrap(),
                "args": env::args().skip(1).collect::<Vec<_>>(),
                "value": env::var("PTY_FIXTURE_VALUE").ok(),
                "term": env::var("TERM").ok(),
                "colorterm": env::var("COLORTERM").ok(),
            }),
            Command::Exit(code) => {
                send(channel.get_mut(), &serde_json::Value::Null);
                std::process::exit(code);
            }
            Command::Flood => {
                send(channel.get_mut(), &serde_json::Value::Null);
                let mut stdout = io::stdout().lock();
                let chunk = "FLOOD_OUTPUT\r\n".repeat(256);
                loop {
                    stdout.write_all(chunk.as_bytes()).unwrap();
                    stdout.flush().unwrap();
                }
            }
        };
        send(channel.get_mut(), &result);
    }
}

#[cfg(unix)]
fn configure_console() {
    use nix::sys::termios::{SetArg, cfmakeraw, tcgetattr, tcsetattr};
    let stdin = io::stdin();
    let mut attributes = tcgetattr(&stdin).unwrap();
    cfmakeraw(&mut attributes);
    tcsetattr(&stdin, SetArg::TCSANOW, &attributes).unwrap();
}

#[cfg(unix)]
fn console_size() -> (u16, u16) {
    let mut size = std::mem::MaybeUninit::<libc::winsize>::uninit();
    // SAFETY: ioctl initializes this correctly sized winsize on success.
    assert_eq!(
        unsafe { libc::ioctl(0, libc::TIOCGWINSZ, size.as_mut_ptr()) },
        0
    );
    let size = unsafe { size.assume_init() };
    (size.ws_col, size.ws_row)
}

#[cfg(windows)]
fn configure_console() {
    use windows_sys::Win32::System::Console::*;
    // SAFETY: these are this dedicated child's console handles. No handle is
    // retained or closed; all pointers refer to initialized stack storage.
    unsafe {
        let input = GetStdHandle(STD_INPUT_HANDLE);
        let output = GetStdHandle(STD_OUTPUT_HANDLE);
        assert_ne!(SetConsoleCP(65001), 0);
        assert_ne!(SetConsoleOutputCP(65001), 0);
        assert_ne!(SetConsoleMode(input, ENABLE_VIRTUAL_TERMINAL_INPUT), 0);
        assert_ne!(
            SetConsoleMode(
                output,
                ENABLE_PROCESSED_OUTPUT
                    | ENABLE_WRAP_AT_EOL_OUTPUT
                    | ENABLE_VIRTUAL_TERMINAL_PROCESSING
                    | DISABLE_NEWLINE_AUTO_RETURN,
            ),
            0
        );
    }
}

#[cfg(windows)]
fn console_size() -> (u16, u16) {
    use windows_sys::Win32::System::Console::*;
    let mut info = std::mem::MaybeUninit::<CONSOLE_SCREEN_BUFFER_INFO>::uninit();
    // SAFETY: the console API initializes the complete output on success.
    assert_ne!(
        unsafe { GetConsoleScreenBufferInfo(GetStdHandle(STD_OUTPUT_HANDLE), info.as_mut_ptr()) },
        0
    );
    let info = unsafe { info.assume_init() };
    (
        (info.srWindow.Right - info.srWindow.Left + 1) as u16,
        (info.srWindow.Bottom - info.srWindow.Top + 1) as u16,
    )
}

pub struct TempDir(pub PathBuf);

impl TempDir {
    pub fn new() -> Self {
        let path = env::temp_dir().join(format!("pty fixture 界 {:016x}", rand::random::<u64>()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }

    pub fn executable(&self, name: &str) -> PathBuf {
        let path = self.0.join(name);
        let executable = env::current_exe().unwrap();
        // Avoid an open executable write descriptor being inherited by another
        // concurrent Unix fork and causing ETXTBSY. Windows has no fork race.
        #[cfg(unix)]
        std::os::unix::fs::symlink(executable, &path).unwrap();
        #[cfg(windows)]
        std::fs::copy(executable, &path).unwrap();
        path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
