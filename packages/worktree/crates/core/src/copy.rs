use crate::{Error, Result};
#[cfg(target_os = "linux")]
use filetime::{FileTime, set_file_times};
use std::fs;
#[cfg(target_os = "linux")]
use std::fs::{File, OpenOptions};
use std::path::Path;
#[cfg(any(target_os = "linux", test))]
use walkdir::WalkDir;

pub(crate) trait CopyStrategy {
    fn copy_directory(&self, from: &Path, to: &Path) -> Result<()>;
}

pub(crate) struct CowStrategy;

impl CopyStrategy for CowStrategy {
    fn copy_directory(&self, from: &Path, to: &Path) -> Result<()> {
        #[cfg(target_os = "linux")]
        return copy_directory_linux(from, to);

        #[cfg(target_os = "macos")]
        return copy_directory_macos(from, to);

        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        {
            let _ = (from, to);
            Err(Error::CowUnavailable(
                "no copy-on-write strategy has been implemented for this platform".into(),
            ))
        }
    }
}

#[cfg(target_os = "macos")]
fn copy_directory_macos(from: &Path, to: &Path) -> Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let source = CString::new(from.as_os_str().as_bytes())
        .map_err(|_| Error::Path(format!("path contains a null byte: {}", from.display())))?;
    let destination = CString::new(to.as_os_str().as_bytes())
        .map_err(|_| Error::Path(format!("path contains a null byte: {}", to.display())))?;
    let result = unsafe { libc::clonefile(source.as_ptr(), destination.as_ptr(), 0) };
    if result == 0 {
        return Ok(());
    }
    Err(Error::CowUnavailable(format!(
        "failed to clone {}: {}",
        from.display(),
        std::io::Error::last_os_error()
    )))
}

#[cfg(target_os = "linux")]
fn copy_directory_linux(from: &Path, to: &Path) -> Result<()> {
    fs::create_dir(to)?;
    fs::set_permissions(to, fs::metadata(from)?.permissions())?;

    let entries = WalkDir::new(from)
        .min_depth(1)
        .follow_links(false)
        .into_iter()
        .collect::<std::result::Result<Vec<_>, _>>()?;

    for entry in &entries {
        let relative = entry
            .path()
            .strip_prefix(from)
            .map_err(|error| Error::Path(error.to_string()))?;
        let destination = to.join(relative);
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata.is_dir() {
            fs::create_dir(&destination)?;
            fs::set_permissions(&destination, metadata.permissions())?;
            continue;
        }
        if metadata.is_symlink() {
            copy_symlink(entry.path(), &destination)?;
            continue;
        }
        if !metadata.is_file() {
            return Err(Error::UnsupportedEntry(entry.path().to_path_buf()));
        }
        reflink_file(entry.path(), &destination)?;
        fs::set_permissions(&destination, metadata.permissions())?;
        set_file_times(
            &destination,
            FileTime::from_last_access_time(&metadata),
            FileTime::from_last_modification_time(&metadata),
        )?;
    }

    for entry in entries
        .iter()
        .rev()
        .filter(|entry| entry.file_type().is_dir())
    {
        let destination = to.join(
            entry
                .path()
                .strip_prefix(from)
                .map_err(|error| Error::Path(error.to_string()))?,
        );
        let metadata = fs::metadata(entry.path())?;
        set_file_times(
            &destination,
            FileTime::from_last_access_time(&metadata),
            FileTime::from_last_modification_time(&metadata),
        )?;
    }

    let metadata = fs::metadata(from)?;
    set_file_times(
        to,
        FileTime::from_last_access_time(&metadata),
        FileTime::from_last_modification_time(&metadata),
    )?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn reflink_file(from: &Path, to: &Path) -> Result<()> {
    use std::os::fd::AsRawFd;

    const FICLONE: libc::c_ulong = 0x4004_9409;
    let source = File::open(from)?;
    let destination = OpenOptions::new().write(true).create_new(true).open(to)?;
    let result = unsafe { libc::ioctl(destination.as_raw_fd(), FICLONE, source.as_raw_fd()) };
    if result == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    Err(Error::CowUnavailable(format!(
        "failed to reflink {}: {}",
        from.display(),
        error
    )))
}

#[cfg(unix)]
fn copy_symlink(from: &Path, to: &Path) -> Result<()> {
    std::os::unix::fs::symlink(fs::read_link(from)?, to)?;
    Ok(())
}

#[cfg(windows)]
fn copy_symlink(from: &Path, to: &Path) -> Result<()> {
    let target = fs::read_link(from)?;
    if fs::metadata(from)?.is_dir() {
        std::os::windows::fs::symlink_dir(target, to)?;
        return Ok(());
    }
    std::os::windows::fs::symlink_file(target, to)?;
    Ok(())
}

#[cfg(test)]
pub(crate) struct TestStrategy;

#[cfg(test)]
impl CopyStrategy for TestStrategy {
    fn copy_directory(&self, from: &Path, to: &Path) -> Result<()> {
        fs::create_dir(to)?;
        for entry in WalkDir::new(from).min_depth(1).follow_links(false) {
            let entry = entry?;
            let destination = to.join(
                entry
                    .path()
                    .strip_prefix(from)
                    .map_err(|error| Error::Path(error.to_string()))?,
            );
            if entry.file_type().is_dir() {
                fs::create_dir(&destination)?;
                continue;
            }
            if entry.file_type().is_symlink() {
                copy_symlink(entry.path(), &destination)?;
                continue;
            }
            fs::copy(entry.path(), destination)?;
        }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) struct FailureStrategy;

#[cfg(test)]
impl CopyStrategy for FailureStrategy {
    fn copy_directory(&self, _from: &Path, _to: &Path) -> Result<()> {
        Err(Error::CowUnavailable("test failure".into()))
    }
}
