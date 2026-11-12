//! Win32 calls that std does not cover: whether a process is alive, ending one, and pointing stdin at the console.
//! Windows only.

#![allow(unsafe_code)]

use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, IntoRawHandle, OwnedHandle};
use windows_sys::Win32::Foundation::{ERROR_ACCESS_DENIED, STILL_ACTIVE};
use windows_sys::Win32::System::Console::{STD_INPUT_HANDLE, SetStdHandle};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_ACCESS_RIGHTS, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    TerminateProcess,
};

/// Whether process `pid` exists and has not exited. A process this user may not open exists, so it counts as alive.
pub fn process_alive(pid: u32) -> bool {
    let process = match open(pid, PROCESS_QUERY_LIMITED_INFORMATION) {
        Ok(process) => process,
        Err(error) => return error.raw_os_error() == Some(ERROR_ACCESS_DENIED as i32),
    };
    let mut code = 0;
    // SAFETY: `process` is an open handle with query access, and `code` outlives the call.
    let ok = unsafe { GetExitCodeProcess(process.as_raw_handle(), &mut code) };
    // An exited process keeps its handle until the last one closes; its exit code tells it apart.
    ok == 0 || code == STILL_ACTIVE as u32
}

/// Ends process `pid` with exit code 1 (`TerminateProcess`, what libuv does for every signal but 0).
pub fn terminate(pid: u32) -> io::Result<()> {
    let process = open(pid, PROCESS_TERMINATE)?;
    // SAFETY: `process` is an open handle with terminate access.
    if unsafe { TerminateProcess(process.as_raw_handle(), 1) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// Makes the console (`CONIN$`) this process's standard input, for a process whose stdin was a pipe. The handle stays
/// open for the life of the process; std and OpenTUI look the standard handle up on each read.
pub fn set_stdin_console() -> io::Result<()> {
    let console = std::fs::OpenOptions::new().read(true).write(true).open("CONIN$")?.into_raw_handle();
    // SAFETY: `console` is an open handle that is never closed.
    if unsafe { SetStdHandle(STD_INPUT_HANDLE, console) } == 0 {
        let error = io::Error::last_os_error();
        // SAFETY: `SetStdHandle` failed, so nothing else holds `console`.
        drop(unsafe { OwnedHandle::from_raw_handle(console) });
        return Err(error);
    }
    Ok(())
}

fn open(pid: u32, access: PROCESS_ACCESS_RIGHTS) -> io::Result<OwnedHandle> {
    // SAFETY: plain call; a null result is an error.
    let handle = unsafe { OpenProcess(access, 0, pid) };
    if handle.is_null() {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: `handle` is open and owned by nothing else.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    #[test]
    fn terminate_ends_a_live_process() {
        // `ping` waits a second between echoes; `timeout` needs a console on stdin.
        let mut child = Command::new("ping").args(["-n", "60", "127.0.0.1"]).stdout(Stdio::null()).spawn().unwrap();
        assert!(process_alive(child.id()));
        terminate(child.id()).unwrap();
        let status = child.wait().unwrap();
        assert_eq!(status.code(), Some(1));
        assert!(!process_alive(child.id()));
    }

    #[test]
    fn a_missing_process_is_gone() {
        // Process IDs are multiples of 4, so this one never exists; 0 is the idle process, which cannot be opened.
        assert!(!process_alive(u32::MAX - 2));
        assert!(!process_alive(0));
        assert!(terminate(u32::MAX - 2).is_err());
    }
}
