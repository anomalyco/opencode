//! A program in the terminal's foreground, for a caller that released the terminal to it (a plugin's `foreground`,
//! ABI 1.6). The program gets the terminal's own standard streams and the signals of its keys; the caller gets
//! neither, so a key the user sends the program does not end or stop the caller.
//!
//! - Unix: the program runs in a process group of its own, which becomes the terminal's foreground group while it
//!   runs, so Ctrl+C, Ctrl+\ and Ctrl+Z signal it alone. A program that stops (Ctrl+Z, or reading the terminal before
//!   it was handed over) is continued: the caller holds the job and has no shell to hand a stopped child to. The
//!   caller's group gets the terminal back after, with SIGTTOU blocked for the hand-over, and then the input the
//!   program left unread is dropped, so it does not reach the caller.
//! - Windows: the console sends Ctrl+C and Ctrl+Break to every process attached to it. A handler registered for the
//!   wait, which the console calls before the caller's own, takes them for this process, and the program's handlers
//!   act alone. The console input left unread is dropped after.
//! - Standard error is the terminal (`/dev/tty`, `CONOUT$`), not a descriptor the caller redirected.

#![allow(unsafe_code)]

use std::io;
use std::process::{Command, ExitStatus};

/// Runs `command` as the terminal's foreground program and waits for it to exit.
#[cfg(unix)]
pub fn run(command: &mut Command) -> io::Result<ExitStatus> {
    use std::os::fd::AsRawFd;
    use std::os::unix::process::{CommandExt, ExitStatusExt};

    // Without a controlling terminal the program runs as a plain child.
    let tty = std::fs::OpenOptions::new().read(true).write(true).open("/dev/tty").ok();
    if let Some(tty) = &tty {
        command.stderr(tty.try_clone()?);
    }
    command.process_group(0);
    let child = command.spawn()?;
    let pid = child.id() as libc::pid_t;
    let terminal = tty.as_ref().map(AsRawFd::as_raw_fd);
    // SAFETY: a query on a descriptor this function owns.
    let ours = terminal.map(|fd| unsafe { libc::tcgetpgrp(fd) }).filter(|group| *group > 0);
    if let (Some(fd), Some(_)) = (terminal, ours) {
        hand(fd, pid);
    }
    let status = wait(pid);
    if let (Some(fd), Some(ours)) = (terminal, ours) {
        hand(fd, ours);
        // SAFETY: as above; the caller's group is the terminal's foreground group again.
        unsafe { libc::tcflush(fd, libc::TCIFLUSH) };
    }
    status.map(ExitStatus::from_raw)
}

/// Waits for `pid` to exit, continuing its group each time it stops.
#[cfg(unix)]
fn wait(pid: libc::pid_t) -> io::Result<i32> {
    loop {
        let mut status = 0;
        // SAFETY: `pid` is this process's child, and `status` is a valid out pointer.
        if unsafe { libc::waitpid(pid, &mut status, libc::WUNTRACED) } < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error);
        }
        if !libc::WIFSTOPPED(status) {
            return Ok(status);
        }
        // SAFETY: signals the child's own process group.
        unsafe { libc::kill(-pid, libc::SIGCONT) };
    }
}

/// Makes `group` the foreground process group of terminal `fd`. A process outside the foreground group that does this
/// gets SIGTTOU, which would stop it; with SIGTTOU blocked the terminal allows it.
#[cfg(unix)]
fn hand(fd: libc::c_int, group: libc::pid_t) {
    // SAFETY: plain signal-mask and terminal calls with valid pointers; the mask is restored before returning.
    unsafe {
        let mut block: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut block);
        libc::sigaddset(&mut block, libc::SIGTTOU);
        let mut previous: libc::sigset_t = std::mem::zeroed();
        libc::pthread_sigmask(libc::SIG_BLOCK, &block, &mut previous);
        libc::tcsetpgrp(fd, group);
        libc::pthread_sigmask(libc::SIG_SETMASK, &previous, std::ptr::null_mut());
    }
}

/// Runs `command` as the console's foreground program and waits for it to exit.
#[cfg(windows)]
pub fn run(command: &mut Command) -> io::Result<ExitStatus> {
    use windows_sys::Win32::System::Console::{
        CTRL_BREAK_EVENT, CTRL_C_EVENT, FlushConsoleInputBuffer, GetStdHandle, STD_INPUT_HANDLE, SetConsoleCtrlHandler,
    };
    use windows_sys::core::BOOL;

    /// Takes Ctrl+C and Ctrl+Break for this process while the program runs.
    unsafe extern "system" fn take(event: u32) -> BOOL {
        BOOL::from(event == CTRL_C_EVENT || event == CTRL_BREAK_EVENT)
    }

    if let Ok(console) = std::fs::OpenOptions::new().read(true).write(true).open("CONOUT$") {
        command.stderr(console);
    }
    // SAFETY: registers and removes a handler that only reads its argument.
    unsafe { SetConsoleCtrlHandler(Some(take), 1) };
    let status = command.status();
    // SAFETY: as above; the input handle is this process's own.
    unsafe {
        SetConsoleCtrlHandler(Some(take), 0);
        FlushConsoleInputBuffer(GetStdHandle(STD_INPUT_HANDLE));
    }
    status
}

/// Runs `command` and waits for it to exit.
#[cfg(not(any(unix, windows)))]
pub fn run(command: &mut Command) -> io::Result<ExitStatus> {
    command.status()
}
