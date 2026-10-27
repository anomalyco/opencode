use std::env;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};

use nix::sys::termios::{SetArg, cfmakeraw, tcgetattr, tcsetattr};
use opencode_pty::service::{CreateTerminal, TerminalId, TerminalService};

const CHILD: &str = "OPENCODE_PTY_RESIZE_TEST_CHILD";

pub struct ResizeFixture {
    pub service: TerminalService,
    pub id: TerminalId,
    received: TcpStream,
}

impl ResizeFixture {
    pub fn new(test: &str) -> Self {
        if let Ok(address) = env::var(CHILD) {
            child(&address);
            // Do not let the test harness print completion into the PTY.
            std::process::exit(0);
        }

        // A side channel observes child stdin without generating more PTY output,
        // which would accidentally drain the replies and hide the regression.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let service = TerminalService::default();
        let terminal = service
            .create(CreateTerminal {
                program: env::current_exe().unwrap().to_string_lossy().into_owned(),
                args: vec![
                    "--exact".into(),
                    test.into(),
                    "--nocapture".into(),
                    "--test-threads=1".into(),
                ],
                cwd: env::current_dir().unwrap(),
                title: "resize-fixture".into(),
                group_id: "resize-fixture".into(),
                env: [(CHILD.into(), listener.local_addr().unwrap().to_string())].into(),
                cols: 80,
                rows: 24,
            })
            .unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut received = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "resize fixture did not connect");
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("resize fixture connection failed: {error}"),
            }
        };
        received.set_nonblocking(false).unwrap();
        received
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut ready = [0];
        received.read_exact(&mut ready).unwrap();
        assert_eq!(ready, *b"R");
        Self {
            service,
            id: terminal.id,
            received,
        }
    }

    pub fn expect_input(&mut self, expected: &[u8]) {
        for (index, expected_byte) in expected.iter().enumerate() {
            let mut byte = [0];
            self.received.read_exact(&mut byte).unwrap_or_else(|error| {
                panic!("missing PTY input byte {index} of {expected:?}: {error}")
            });
            assert_eq!(
                byte[0], *expected_byte,
                "out-of-order PTY input at byte {index} of {expected:?}"
            );
        }
    }
}

impl Drop for ResizeFixture {
    fn drop(&mut self) {
        let _ = self.service.terminate(self.id);
    }
}

fn child(address: &str) {
    let mut received = TcpStream::connect(address).unwrap();
    received.set_nodelay(true).unwrap();
    let stdin = io::stdin();
    let mut attributes = tcgetattr(&stdin).unwrap();
    cfmakeraw(&mut attributes);
    tcsetattr(&stdin, SetArg::TCSANOW, &attributes).unwrap();
    // SAFETY: only this dedicated child changes its handler. OS resize signals
    // must not make it print anything and conceal a missing in-band notification.
    assert_ne!(
        unsafe { libc::signal(libc::SIGWINCH, libc::SIG_IGN) },
        libc::SIG_ERR
    );

    let mut stdin = stdin.lock();
    let mut stdout = io::stdout().lock();
    stdout.write_all(b"\x1b[?2048h\x1b[5n").unwrap();
    stdout.flush().unwrap();
    let mut initial = Vec::new();
    while !initial.ends_with(b"\x1b[0n") {
        let mut byte = [0];
        stdin.read_exact(&mut byte).unwrap();
        initial.push(byte[0]);
        assert!(initial.len() < 256, "unexpected initial terminal replies");
    }
    // The DSR response proves Ghostty has processed the preceding mode change;
    // any initial size report has also been consumed. Remain silent from here.
    received.write_all(b"R").unwrap();
    let mut buffer = [0; 1024];
    loop {
        let len = stdin.read(&mut buffer).unwrap();
        if len == 0 {
            return;
        }
        received.write_all(&buffer[..len]).unwrap();
        if buffer[..len].contains(&b'!') {
            // An explicit final probe lets the parent check that later output
            // does not cause already-delivered resize replies to be sent again.
            stdout.write_all(b"\x1b[5n").unwrap();
            stdout.flush().unwrap();
        }
    }
}
