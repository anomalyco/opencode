use std::ffi::OsString;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use std::ptr::null_mut;
use std::thread::{self, JoinHandle};

use anyhow::{Context, Result, bail};
use fs2::FileExt;
use windows_sys::Win32::Foundation::{
    ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS, GENERIC_READ, GENERIC_WRITE, WAIT_OBJECT_0,
};
use windows_sys::Win32::Storage::FileSystem::{
    BY_HANDLE_FILE_INFORMATION, CREATE_NEW, CreateDirectoryW, CreateFileW, DELETE,
    FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_RENAME_INFO, FILE_RENAME_INFO_0,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TRAVERSE, FileRenameInfoEx,
    GetFileInformationByHandle, GetFinalPathNameByHandleW, OPEN_ALWAYS, OPEN_EXISTING,
    READ_CONTROL, SetFileInformationByHandle, WRITE_DAC,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject,
};
use windows_sys::Win32::System::WindowsProgramming::{
    FILE_RENAME_FLAG_POSIX_SEMANTICS, FILE_RENAME_FLAG_REPLACE_IF_EXISTS,
};

use super::{LOCK_FILE, REGISTRATION_FILE, Registration, registration_path, sweep};
use crate::protocol::PROTOCOL_VERSION;
use crate::transport::Listener;
use crate::transport::windows::{owned_handle, security::PrivateSecurity};

pub(super) fn read_registration(directory: &Path) -> Result<Registration> {
    let security = PrivateSecurity::new()?;
    let mut file = open(
        &registration_path(directory),
        GENERIC_READ | READ_CONTROL,
        OPEN_EXISTING,
        FILE_SHARE_READ | FILE_SHARE_DELETE,
        &security,
    )
    .context("opencode-pty registration is unavailable")?;
    check_kind(&file, false)?;
    security.check_private(file.as_raw_handle())?;
    let mut data = Vec::new();
    // Registration is tiny; do not allocate an unbounded stale/corrupt file.
    Read::by_ref(&mut file)
        .take(16 * 1024 + 1)
        .read_to_end(&mut data)?;
    if data.len() > 16 * 1024 {
        bail!("PTY registration is too large");
    }
    serde_json::from_slice(&data).context("invalid opencode-pty registration")
}

pub(super) struct Runtime {
    pub registration: Registration,
    pub cleanup: Cleanup,
    sweeper: JoinHandle<()>,
    // Neither handle shares delete access, so the private directory and lock
    // cannot be replaced while the daemon runs.
    lock: File,
    directory: File,
}

impl Runtime {
    pub fn bind(directory: &Path) -> Result<(Self, Listener)> {
        if !directory.is_absolute() {
            bail!("PTY runtime directory must be an absolute path");
        }
        let security = PrivateSecurity::new()?;
        if let Some(parent) = directory.parent() {
            fs::create_dir_all(parent)?;
        }
        let wide = wide_path(directory)?;
        // SAFETY: wide path and private descriptor are valid through creation.
        if unsafe { CreateDirectoryW(wide.as_ptr(), &security.attributes()) } == 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(ERROR_ALREADY_EXISTS as i32) {
                return Err(error.into());
            }
        }
        let directory_handle = open(
            directory,
            FILE_READ_ATTRIBUTES | FILE_TRAVERSE | READ_CONTROL | WRITE_DAC,
            OPEN_EXISTING,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &security,
        )?;
        check_kind(&directory_handle, true)?;
        security.make_private(directory_handle.as_raw_handle())?;
        // All later paths come from the held handle, never the caller's path.
        let directory = held_directory_path(&directory_handle)?;
        let lock = open(
            &directory.join(LOCK_FILE),
            GENERIC_READ | GENERIC_WRITE | READ_CONTROL | WRITE_DAC,
            OPEN_ALWAYS,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &security,
        )?;
        check_kind(&lock, false)?;
        security.make_private(lock.as_raw_handle())?;
        lock.try_lock_exclusive()
            .context("another opencode-pty process already owns the service lock")?;

        let instance_id = format!("{:032x}", rand::random::<u128>());
        let registration = Registration {
            socket: PathBuf::from(format!(r"\\.\pipe\opencode-pty-{instance_id}")),
            instance_id,
            pid: std::process::id(),
            protocol: PROTOCOL_VERSION,
            token: format!("{:032x}", rand::random::<u128>()),
        };
        let listener = Listener::bind(&registration.socket)?;
        write_registration(&directory, &directory_handle, &registration, &security)?;
        let sweeper = {
            let directory = directory.clone();
            thread::spawn(move || sweep::stale_runtimes(&directory))
        };
        Ok((
            Self {
                cleanup: Cleanup {
                    directory,
                    instance_id: registration.instance_id.clone(),
                },
                registration,
                sweeper,
                lock,
                directory: directory_handle,
            },
            listener,
        ))
    }

    /// Removes this daemon's runtime state after the server has joined its
    /// handlers. The caller keeps the pipe namespace until this returns.
    pub fn finish(self) -> Result<()> {
        let _ = self.sweeper.join();
        let result = self.cleanup.run();
        let directory = self.cleanup.directory;
        // The protected handles deny deletion; release them first. A daemon that
        // races in and locks a new lock file simply keeps the directory.
        drop(self.lock);
        drop(self.directory);
        let _ = fs::remove_file(directory.join(LOCK_FILE));
        let _ = fs::remove_dir(&directory);
        result
    }
}

/// Removes the registration only while it still belongs to this instance.
#[derive(Clone)]
pub(super) struct Cleanup {
    directory: PathBuf,
    instance_id: String,
}

impl Cleanup {
    pub fn run(&self) -> Result<()> {
        if read_registration(&self.directory)
            .is_ok_and(|current| current.instance_id == self.instance_id)
        {
            fs::remove_file(registration_path(&self.directory))?;
        }
        // A named pipe is not a filesystem entry. Its listener remains held until
        // this registration cleanup has completed, then all handles are closed.
        Ok(())
    }
}

pub(super) fn process_exists(pid: u32) -> bool {
    // SAFETY: a successful handle is adopted immediately; it is only waited on.
    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        // Another user's live process cannot be opened; treat it as live.
        return std::io::Error::last_os_error().raw_os_error() == Some(ERROR_ACCESS_DENIED as i32);
    }
    // SAFETY: OpenProcess returned a new, uniquely owned handle.
    let handle = unsafe { OwnedHandle::from_raw_handle(handle) };
    // A failed wait is treated as live, so the sweep never deletes on doubt.
    // SAFETY: the owned process handle stays valid through this zero-timeout wait.
    unsafe { WaitForSingleObject(handle.as_raw_handle(), 0) != WAIT_OBJECT_0 }
}

/// Named pipes vanish with their server process; there is no endpoint to remove.
pub(super) fn remove_stale_endpoint(_canonical_directory: &Path) -> Result<()> {
    Ok(())
}

fn write_registration(
    directory: &Path,
    directory_handle: &File,
    registration: &Registration,
    security: &PrivateSecurity,
) -> Result<()> {
    let temporary = directory.join(format!("service.{}.tmp", registration.instance_id));
    let result = (|| -> Result<()> {
        let mut file = open(
            &temporary,
            GENERIC_WRITE | READ_CONTROL | DELETE,
            CREATE_NEW,
            0,
            security,
        )?;
        file.write_all(&serde_json::to_vec_pretty(registration)?)?;
        file.sync_all()?;
        publish(&file, directory_handle)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn publish(file: &File, directory: &File) -> Result<()> {
    // The Win32 wrapper rejects a non-null RootDirectory, unlike the native
    // NtSetInformationFile interface. Resolve the full destination from the held
    // directory handle, never from the unvalidated caller path.
    let name = held_directory_path(directory)?
        .join(REGISTRATION_FILE)
        .as_os_str()
        .encode_wide()
        .collect::<Vec<_>>();
    let name_bytes = u32::try_from(size_of_val(name.as_slice()))?;
    let bytes = size_of::<FILE_RENAME_INFO>()
        .checked_add(name_bytes as usize)
        .context("registration rename buffer overflow")?;
    let buffer_bytes = u32::try_from(bytes)?;
    // FILE_RENAME_INFO has a variable-length trailing UTF-16 name. usize gives
    // this buffer the struct's alignment on both supported 64-bit architectures.
    const {
        assert!(align_of::<FILE_RENAME_INFO>() <= align_of::<usize>());
    }
    let mut buffer = vec![0_usize; bytes.div_ceil(size_of::<usize>())];
    let allocation = buffer.as_mut_ptr().cast::<u8>();
    let info = allocation.cast::<FILE_RENAME_INFO>();
    // SAFETY: the zeroed, aligned allocation covers the header and complete name.
    // Use raw pointers into the whole allocation, not a borrow of FileName[1]
    // whose extent is smaller than the variable-sized trailing data.
    unsafe {
        (&raw mut (*info).Anonymous).write(FILE_RENAME_INFO_0 {
            Flags: FILE_RENAME_FLAG_REPLACE_IF_EXISTS | FILE_RENAME_FLAG_POSIX_SEMANTICS,
        });
        (&raw mut (*info).RootDirectory).write(null_mut());
        (&raw mut (*info).FileNameLength).write(name_bytes);
        let destination = allocation
            .add(std::mem::offset_of!(FILE_RENAME_INFO, FileName))
            .cast::<u16>();
        std::ptr::copy_nonoverlapping(name.as_ptr(), destination, name.len());
        // Unlike ordinary MoveFileEx replacement, POSIX semantics preserve old
        // reader handles while new opens see the new file, with no missing-name
        // interval. Source and destination directory stay held throughout; the
        // source is never reopened and no inherited ACL/metadata merge occurs.
        if SetFileInformationByHandle(
            file.as_raw_handle(),
            FileRenameInfoEx,
            info.cast(),
            buffer_bytes,
        ) == 0
        {
            return Err(std::io::Error::last_os_error())
                .context("failed to atomically publish PTY registration");
        }
    }
    Ok(())
}

fn held_directory_path(directory: &File) -> Result<PathBuf> {
    // SAFETY: query the normalized DOS path length for a live directory handle.
    let length = unsafe { GetFinalPathNameByHandleW(directory.as_raw_handle(), null_mut(), 0, 0) };
    if length == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let mut path = vec![0_u16; length as usize];
    // SAFETY: the buffer has the requested length and the directory stays held.
    let written = unsafe {
        GetFinalPathNameByHandleW(directory.as_raw_handle(), path.as_mut_ptr(), length, 0)
    };
    if written == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    if written >= length {
        bail!("PTY runtime directory path changed during publication");
    }
    Ok(PathBuf::from(OsString::from_wide(
        &path[..written as usize],
    )))
}

fn open(
    path: &Path,
    access: u32,
    creation: u32,
    sharing: u32,
    security: &PrivateSecurity,
) -> Result<File> {
    let path = wide_path(path)?;
    // SAFETY: all pointers are valid; OPEN_REPARSE_POINT lets check_kind reject
    // links rather than inspecting a different target after following them.
    let handle = unsafe {
        CreateFileW(
            path.as_ptr(),
            access,
            sharing,
            &security.attributes(),
            creation,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            null_mut(),
        )
    };
    Ok(File::from(owned_handle(handle)?))
}

fn check_kind(file: &File, directory: bool) -> Result<()> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: file owns a live handle; info is valid writable output.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        bail!("PTY storage must not be a reparse point");
    }
    if (info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0) != directory {
        bail!("unexpected PTY storage file type");
    }
    Ok(())
}

fn wide_path(path: &Path) -> Result<Vec<u16>> {
    let mut wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
    if wide.contains(&0) {
        bail!("PTY storage path contains NUL");
    }
    wide.push(0);
    Ok(wide)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_is_private_and_atomically_replaceable_with_a_reader_open() {
        let directory =
            std::env::temp_dir().join(format!("pty-registration-{:032x}", rand::random::<u128>()));
        fs::create_dir(&directory).unwrap();
        let security = PrivateSecurity::new().unwrap();
        let directory_handle = open(
            &directory,
            FILE_READ_ATTRIBUTES | FILE_TRAVERSE,
            OPEN_EXISTING,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &security,
        )
        .unwrap();
        let mut registration = Registration {
            instance_id: "first".into(),
            pid: 1,
            protocol: PROTOCOL_VERSION,
            socket: PathBuf::from(r"\\.\pipe\opencode-pty-first"),
            token: "secret".into(),
        };
        write_registration(&directory, &directory_handle, &registration, &security).unwrap();
        let path = directory.join(REGISTRATION_FILE);
        let mut old_reader = open(
            &path,
            GENERIC_READ | READ_CONTROL,
            OPEN_EXISTING,
            FILE_SHARE_READ | FILE_SHARE_DELETE,
            &security,
        )
        .unwrap();
        security.check_private(old_reader.as_raw_handle()).unwrap();
        registration.instance_id = "second".into();
        write_registration(&directory, &directory_handle, &registration, &security).unwrap();
        assert_eq!(read_registration(&directory).unwrap().instance_id, "second");
        let mut old = String::new();
        old_reader.read_to_string(&mut old).unwrap();
        assert_eq!(
            serde_json::from_str::<Registration>(&old)
                .unwrap()
                .instance_id,
            "first"
        );
        drop(old_reader);
        drop(directory_handle);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn process_liveness_uses_the_process_object() {
        assert!(process_exists(std::process::id()));
        let mut child = std::process::Command::new("cmd.exe")
            .args(["/C", "exit 0"])
            .spawn()
            .unwrap();
        let pid = child.id();
        child.wait().unwrap();
        assert!(!process_exists(pid));
    }
}
