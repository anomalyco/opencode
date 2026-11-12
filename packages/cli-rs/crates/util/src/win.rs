//! Win32 calls that std does not cover: whether a process is alive, ending one, pointing stdin at the console, and
//! ignoring Ctrl+C while a child runs; the executable, times and memory of a process, and the OS release; shared
//! libraries; stderr on a pipe; console modes and waits.
//! Windows only.

#![allow(unsafe_code)]

use std::ffi::{CStr, OsStr, OsString, c_void};
use std::io;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::io::{
    AsHandle, AsRawHandle, BorrowedHandle, FromRawHandle, IntoRawHandle, OwnedHandle, RawHandle,
};
use std::path::PathBuf;
use std::ptr::NonNull;
use std::time::Duration;
use windows_sys::Wdk::System::SystemServices::RtlGetVersion;
use windows_sys::Win32::Foundation::{
    ERROR_ACCESS_DENIED, FILETIME, FreeLibrary, STILL_ACTIVE, WAIT_FAILED, WAIT_OBJECT_0,
};
use windows_sys::Win32::System::Console::{
    CONSOLE_SCREEN_BUFFER_INFO, CTRL_BREAK_EVENT, CTRL_C_EVENT, ENABLE_ECHO_INPUT, ENABLE_LINE_INPUT,
    ENABLE_MOUSE_INPUT, ENABLE_PROCESSED_INPUT, ENABLE_PROCESSED_OUTPUT, ENABLE_VIRTUAL_TERMINAL_INPUT,
    ENABLE_VIRTUAL_TERMINAL_PROCESSING, ENABLE_WINDOW_INPUT, GetConsoleMode, GetConsoleScreenBufferInfo, GetStdHandle,
    STD_ERROR_HANDLE, STD_INPUT_HANDLE, SetConsoleCtrlHandler, SetConsoleMode, SetStdHandle,
};
use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows_sys::Win32::System::Pipes::{CreatePipe, PeekNamedPipe};
use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
use windows_sys::Win32::System::SystemInformation::{GetSystemTimeAsFileTime, OSVERSIONINFOW};
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, GetExitCodeProcess, GetProcessTimes, INFINITE, OpenProcess, PROCESS_ACCESS_RIGHTS,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, QueryFullProcessImageNameW,
    TerminateProcess, WaitForSingleObject,
};
use windows_sys::core::BOOL;

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

/// The executable process `pid` runs, as a Win32 path (`QueryFullProcessImageNameW`).
pub fn process_image(pid: u32) -> io::Result<PathBuf> {
    let process = open(pid, PROCESS_QUERY_LIMITED_INFORMATION)?;
    // The longest path Win32 allows.
    let mut buffer = vec![0u16; 32_768];
    let mut size = buffer.len() as u32;
    // SAFETY: `process` has query access, and `size` is the length of `buffer`, which outlives the call.
    let ok = unsafe {
        QueryFullProcessImageNameW(process.as_raw_handle(), PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut size)
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(PathBuf::from(OsString::from_wide(&buffer[..size as usize])))
}

/// This process's CPU time and age, from `GetProcessTimes`.
pub struct ProcessTimes {
    /// User plus kernel time in seconds, as libuv's `uv_getrusage` adds them for `process.cpuUsage()`.
    pub cpu_seconds: f64,
    /// Milliseconds since the process was created.
    pub age_ms: f64,
}

pub fn process_times() -> Option<ProcessTimes> {
    let [mut created, mut exited, mut kernel, mut user, mut now] = [FILETIME::default(); 5];
    // SAFETY: the current process's pseudo handle needs no closing; the out-parameters outlive the call.
    let ok = unsafe { GetProcessTimes(GetCurrentProcess(), &mut created, &mut exited, &mut kernel, &mut user) };
    if ok == 0 {
        return None;
    }
    // SAFETY: `now` outlives the call.
    unsafe { GetSystemTimeAsFileTime(&mut now) };
    // A FILETIME counts 100 ns intervals.
    let ticks = |time: FILETIME| ((u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)) as f64;
    Some(ProcessTimes { cpu_seconds: (ticks(kernel) + ticks(user)) / 1e7, age_ms: (ticks(now) - ticks(created)) / 1e4 })
}

/// This process's working set in bytes, which libuv's `uv_resident_set_memory` reports as the RSS.
pub fn resident_memory() -> Option<usize> {
    let mut counters =
        PROCESS_MEMORY_COUNTERS { cb: size_of::<PROCESS_MEMORY_COUNTERS>() as u32, ..Default::default() };
    // SAFETY: the pseudo handle needs no closing; `counters` is as large as `cb` says and outlives the call.
    let ok = unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) };
    (ok != 0).then_some(counters.WorkingSetSize)
}

/// `os.release()`: `major.minor.build` from `RtlGetVersion`, as libuv's `uv_os_uname` reads it. Unlike
/// `GetVersionExW`, it is not capped at 6.2 for an executable without a compatibility manifest.
pub fn os_release() -> Option<String> {
    let mut info = OSVERSIONINFOW { dwOSVersionInfoSize: size_of::<OSVERSIONINFOW>() as u32, ..Default::default() };
    // SAFETY: `info` is as large as its size field says and outlives the call.
    let status = unsafe { RtlGetVersion(&mut info) };
    (status >= 0).then(|| format!("{}.{}.{}", info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber))
}

/// Loads the library at `path`, or by name through the loader's search order when it has no separator
/// (`LoadLibraryW`). Each `/` becomes `\`, as `LoadLibraryW` needs. Errors name the path.
///
/// # Safety
///
/// Loading runs the library's initializers, which may do anything.
pub unsafe fn load_library(path: &OsStr) -> io::Result<NonNull<c_void>> {
    let wide: Vec<u16> = path
        .encode_wide()
        .map(|unit| if unit == u16::from(b'/') { u16::from(b'\\') } else { unit })
        .chain([0])
        .collect();
    // SAFETY: `wide` is NUL-terminated. The caller vouches for the initializers.
    let module = unsafe { LoadLibraryW(wide.as_ptr()) };
    NonNull::new(module).ok_or_else(|| named(path.display(), io::Error::last_os_error()))
}

/// The address of `name` in `module` (`GetProcAddress`). Errors name the symbol.
///
/// # Safety
///
/// `module` must come from [`load_library`] and not be freed yet.
pub unsafe fn library_symbol(module: NonNull<c_void>, name: &CStr) -> io::Result<NonNull<c_void>> {
    // SAFETY: `module` is loaded and `name` is a C string.
    let address = unsafe { GetProcAddress(module.as_ptr(), name.as_ptr().cast()) };
    address
        .and_then(|address| NonNull::new(address as *mut c_void))
        .ok_or_else(|| named(name.to_string_lossy(), io::Error::last_os_error()))
}

/// Unloads `module` (`FreeLibrary`).
///
/// # Safety
///
/// `module` must come from [`load_library`], and nothing may use a symbol from it afterwards.
pub unsafe fn free_library(module: NonNull<c_void>) {
    // SAFETY: as the caller vouches.
    unsafe { FreeLibrary(module.as_ptr()) };
}

fn named(name: impl std::fmt::Display, error: io::Error) -> io::Error {
    io::Error::new(error.kind(), format!("{name}: {error}"))
}

/// An anonymous pipe: the read end, then the write end. Child processes inherit neither.
pub fn pipe() -> io::Result<(OwnedHandle, OwnedHandle)> {
    let (mut read, mut write) = (std::ptr::null_mut(), std::ptr::null_mut());
    // SAFETY: the out-parameters outlive the call; without attributes the handles are not inheritable.
    if unsafe { CreatePipe(&mut read, &mut write, std::ptr::null(), 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: both handles are open and owned by nothing else.
    Ok(unsafe { (OwnedHandle::from_raw_handle(read), OwnedHandle::from_raw_handle(write)) })
}

/// A handle put in place of the standard error by [`redirect_stderr`], until [`StderrRedirect::restore`].
pub struct StderrRedirect {
    /// The standard error before, open and owned by nobody here.
    previous: RawHandle,
    /// The handle in its place, open while it is the standard error.
    _handle: OwnedHandle,
}

// SAFETY: `previous` is only passed back to `SetStdHandle`, which accepts it from any thread.
unsafe impl Send for StderrRedirect {}

/// Makes `handle` this process's standard error. std looks the standard handle up on each write, so `eprintln!`
/// follows it.
pub fn redirect_stderr(handle: OwnedHandle) -> io::Result<StderrRedirect> {
    // SAFETY: plain calls; the redirect keeps `handle` open while it is the standard error.
    unsafe {
        let previous = GetStdHandle(STD_ERROR_HANDLE);
        if SetStdHandle(STD_ERROR_HANDLE, handle.as_raw_handle()) == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(StderrRedirect { previous, _handle: handle })
    }
}

impl StderrRedirect {
    /// Gives the previous standard error back, then closes the handle that stood in for it.
    pub fn restore(self) {
        // SAFETY: `previous` was the standard error and is still open; it is not ours to close.
        unsafe { SetStdHandle(STD_ERROR_HANDLE, self.previous) };
    }
}

/// How many bytes wait in the pipe `read`, without reading them (`PeekNamedPipe`). An error once every write end is
/// closed and nothing waits (`ERROR_BROKEN_PIPE`).
pub fn pipe_available(read: BorrowedHandle<'_>) -> io::Result<u32> {
    let mut available = 0;
    let null = std::ptr::null_mut();
    // SAFETY: `read` is open, no bytes are copied, and `available` outlives the call.
    if unsafe { PeekNamedPipe(read.as_raw_handle(), null, 0, null.cast(), &mut available, null.cast()) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(available)
}

/// From now on Ctrl+C and Ctrl+Break do nothing in this process, for a parent that waits for a child on the same
/// console: the child gets them too, and the parent exits with the child's code. Other console events reach the
/// handlers registered before. Unlike `SetConsoleCtrlHandler(NULL, TRUE)`, children do not inherit it.
pub fn ignore_interrupts() -> io::Result<()> {
    // SAFETY: `interrupted` is a valid handler for the life of the process.
    if unsafe { SetConsoleCtrlHandler(Some(interrupted), 1) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

// The last handler registered runs first; `TRUE` stops the event there.
unsafe extern "system" fn interrupted(event: u32) -> BOOL {
    BOOL::from(event == CTRL_C_EVENT || event == CTRL_BREAK_EVENT)
}

/// The console mode of `handle`, or `None` when it is not a console (libuv's test for a TTY).
pub fn console_mode(handle: impl AsHandle) -> Option<u32> {
    let mut mode = 0;
    // SAFETY: plain call; an invalid or non-console handle makes it fail.
    (unsafe { GetConsoleMode(handle.as_handle().as_raw_handle(), &mut mode) } != 0).then_some(mode)
}

/// The visible columns and rows of the console `handle` draws on, or `None` when it is not a console. OpenTUI's
/// `term::size` asks stdout only.
pub fn console_size(handle: impl AsHandle) -> Option<(u16, u16)> {
    // SAFETY: an all-zero `CONSOLE_SCREEN_BUFFER_INFO` is valid plain data.
    let mut info: CONSOLE_SCREEN_BUFFER_INFO = unsafe { std::mem::zeroed() };
    // SAFETY: plain call; an invalid or non-console handle makes it fail.
    if unsafe { GetConsoleScreenBufferInfo(handle.as_handle().as_raw_handle(), &mut info) } == 0 {
        return None;
    }
    let window = info.srWindow;
    let width = u16::try_from(i32::from(window.Right) - i32::from(window.Left) + 1).unwrap_or(0);
    let height = u16::try_from(i32::from(window.Bottom) - i32::from(window.Top) + 1).unwrap_or(0);
    Some((if width == 0 { 80 } else { width }, if height == 0 { 24 } else { height }))
}

pub fn set_console_mode(handle: impl AsHandle, mode: u32) -> io::Result<()> {
    // SAFETY: plain call; an invalid or non-console handle makes it fail.
    if unsafe { SetConsoleMode(handle.as_handle().as_raw_handle(), mode) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// The raw input mode from a saved one, as libuv's `UV_TTY_MODE_RAW` takes it but with the console turning keys
/// into escape sequences: no line editing, echo, Ctrl+C handling or mouse records; window size records on. Quick
/// Edit and insert mode stay as they were.
pub fn raw_input_mode(saved: u32) -> u32 {
    (saved & !(ENABLE_LINE_INPUT | ENABLE_ECHO_INPUT | ENABLE_PROCESSED_INPUT | ENABLE_MOUSE_INPUT))
        | ENABLE_WINDOW_INPUT
        | ENABLE_VIRTUAL_TERMINAL_INPUT
}

/// The output mode with escape sequences interpreted, as libuv sets it on a console it writes to. `\n` keeps its
/// carriage return: there is no `DISABLE_NEWLINE_AUTO_RETURN`.
pub fn vt_output_mode(saved: u32) -> u32 {
    saved | ENABLE_PROCESSED_OUTPUT | ENABLE_VIRTUAL_TERMINAL_PROCESSING
}

/// Waits up to `timeout` (forever with `None`) for `handle` to be signaled, as console input is while it holds
/// records. Consumes nothing.
pub fn wait_handle(handle: impl AsHandle, timeout: Option<Duration>) -> io::Result<bool> {
    let millis =
        timeout.map_or(INFINITE, |timeout| timeout.as_nanos().div_ceil(1_000_000).min(u128::from(INFINITE - 1)) as u32);
    // SAFETY: plain call; an invalid handle makes it fail.
    match unsafe { WaitForSingleObject(handle.as_handle().as_raw_handle(), millis) } {
        WAIT_FAILED => Err(io::Error::last_os_error()),
        result => Ok(result == WAIT_OBJECT_0),
    }
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
    fn only_interrupts_are_ignored() {
        use windows_sys::Win32::System::Console::CTRL_CLOSE_EVENT;
        // SAFETY: the handler only compares its argument.
        let handled = |event| unsafe { interrupted(event) };
        assert_eq!([CTRL_C_EVENT, CTRL_BREAK_EVENT, CTRL_CLOSE_EVENT].map(handled), [1, 1, 0]);
        ignore_interrupts().unwrap();
    }

    #[test]
    fn console_modes() {
        let cooked = ENABLE_PROCESSED_INPUT | ENABLE_LINE_INPUT | ENABLE_ECHO_INPUT | ENABLE_MOUSE_INPUT | 0x40 | 0x80;
        // Quick Edit (0x40) and extended flags (0x80) stay as they were.
        assert_eq!(raw_input_mode(cooked), ENABLE_WINDOW_INPUT | ENABLE_VIRTUAL_TERMINAL_INPUT | 0x40 | 0x80);
        assert_eq!(vt_output_mode(0), ENABLE_PROCESSED_OUTPUT | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
        let file = std::fs::File::open(std::env::current_exe().unwrap()).unwrap();
        assert_eq!(console_mode(&file), None);
        assert!(set_console_mode(&file, 0).is_err());
    }

    #[test]
    fn wait_handle_times_out_and_sees_a_signal() {
        let mut child = Command::new("ping").args(["-n", "60", "127.0.0.1"]).stdout(Stdio::null()).spawn().unwrap();
        // A process handle is signaled once the process exits.
        assert!(!wait_handle(&child, Some(Duration::from_millis(10))).unwrap());
        child.kill().unwrap();
        assert!(wait_handle(&child, None).unwrap());
        child.wait().unwrap();
    }

    #[test]
    fn a_missing_process_is_gone() {
        // Process IDs are multiples of 4, so this one never exists; 0 is the idle process, which cannot be opened.
        assert!(!process_alive(u32::MAX - 2));
        assert!(!process_alive(0));
        assert!(terminate(u32::MAX - 2).is_err());
    }

    #[test]
    fn process_image_is_this_executable() {
        let image = process_image(std::process::id()).unwrap();
        assert_eq!(
            std::fs::canonicalize(image).unwrap(),
            std::fs::canonicalize(std::env::current_exe().unwrap()).unwrap()
        );
    }

    #[test]
    fn this_process_has_times_memory_and_a_release() {
        // Both clocks advance in ticks of about 15.6 ms, so they may read 0 until the first one.
        let times = process_times().unwrap();
        assert!(times.cpu_seconds >= 0.0 && times.age_ms >= 0.0);
        let started = std::time::Instant::now();
        let later = std::iter::repeat_with(|| process_times().unwrap())
            .find(|later| later.cpu_seconds > times.cpu_seconds || started.elapsed() > Duration::from_secs(5))
            .unwrap();
        assert!(later.cpu_seconds > times.cpu_seconds && later.age_ms > times.age_ms);
        assert!(resident_memory().unwrap() > 0);
        let release = os_release().unwrap();
        let parts: Vec<u32> = release.split('.').map(|part| part.parse().unwrap()).collect();
        assert!(parts.len() == 3 && parts[0] >= 10, "{release}");
    }

    #[test]
    fn a_console_size_is_asked_of_the_handle_given() {
        // A redirected stdout does not hide the size of a stderr console.
        let (read, _write) = pipe().unwrap();
        assert_eq!(console_size(read.as_handle()), None);
        if console_mode(std::io::stderr()).is_some() {
            assert!(console_size(std::io::stderr()).is_some_and(|(columns, rows)| columns > 0 && rows > 0));
        }
    }

    #[test]
    fn a_pipe_reports_what_waits_and_its_closed_writer() {
        use std::io::{Read, Write};
        use std::os::windows::io::AsHandle;
        let (read, write) = pipe().unwrap();
        assert_eq!(pipe_available(read.as_handle()).unwrap(), 0);
        std::fs::File::from(write).write_all(b"line\n").unwrap();
        assert_eq!(pipe_available(read.as_handle()).unwrap(), 5);
        let mut text = String::new();
        std::fs::File::from(read.try_clone().unwrap()).read_to_string(&mut text).unwrap();
        assert_eq!(text, "line\n");
        assert!(pipe_available(read.as_handle()).is_err());
    }
}
