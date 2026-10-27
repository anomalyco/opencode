use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::thread::{self, JoinHandle};

use anyhow::{Context, Result, anyhow};
use fs2::FileExt;
use sha2::{Digest, Sha256};

use super::{LOCK_FILE, Registration, read_registration, registration_path};
use crate::protocol::PROTOCOL_VERSION;
use crate::transport::Listener;

pub(super) struct Runtime {
    pub registration: Registration,
    pub cleanup: Cleanup,
    sweeper: JoinHandle<()>,
    // Held until the shared server has joined its handlers and removed registration.
    lock: File,
}

impl Runtime {
    pub fn bind(directory: &Path) -> Result<(Self, Listener)> {
        let directory = directory.to_path_buf();
        fs::create_dir_all(&directory)?;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.join(LOCK_FILE))?;
        lock.try_lock_exclusive()
            .context("another opencode-pty process already owns the service lock")?;

        let socket_path = socket_path(&directory)?;
        if socket_path.exists() {
            fs::remove_file(&socket_path)?;
        }
        let listener = Listener::bind(&socket_path)?;
        fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600))?;
        let socket = SocketFile::bound(socket_path)?;
        let registration = Registration {
            instance_id: random_id(),
            pid: std::process::id(),
            protocol: PROTOCOL_VERSION,
            socket: socket.path.clone(),
            token: random_id(),
        };
        write_registration(&directory, &registration)?;
        let sweeper = {
            let directory = directory.clone();
            thread::spawn(move || super::sweep::stale_runtimes(&directory))
        };
        Ok((
            Self {
                cleanup: Cleanup {
                    directory,
                    registration: registration.clone(),
                    socket,
                },
                registration,
                sweeper,
                lock,
            },
            listener,
        ))
    }

    /// Removes this daemon's runtime state after the server has joined its handlers.
    pub fn finish(self) -> Result<()> {
        let _ = self.sweeper.join();
        let result = self.cleanup.run();
        drop(self.lock);
        result
    }
}

/// Removes only state that still belongs to this daemon instance.
#[derive(Clone)]
pub(super) struct Cleanup {
    directory: PathBuf,
    registration: Registration,
    socket: SocketFile,
}

impl Cleanup {
    pub fn run(&self) -> Result<()> {
        let result = remove_if_current(&self.directory, &self.registration);
        self.socket.remove_if_current();
        // Remove the lock file before releasing it: a daemon that already opened it
        // fails to lock it, and a later one creates a new lock file.
        let _ = fs::remove_file(self.directory.join(LOCK_FILE));
        let _ = fs::remove_dir(&self.directory);
        result
    }
}

/// The bound socket's inode, so cleanup never unlinks a successor's socket.
#[derive(Clone)]
struct SocketFile {
    path: PathBuf,
    device: u64,
    inode: u64,
}

impl SocketFile {
    fn bound(path: PathBuf) -> Result<Self> {
        let metadata = fs::symlink_metadata(&path)?;
        Ok(Self {
            path,
            device: metadata.dev(),
            inode: metadata.ino(),
        })
    }

    fn remove_if_current(&self) {
        if fs::symlink_metadata(&self.path)
            .is_ok_and(|metadata| metadata.dev() == self.device && metadata.ino() == self.inode)
        {
            let _ = fs::remove_file(&self.path);
        }
    }
}

pub(super) fn process_exists(pid: u32) -> bool {
    let Ok(pid) = i32::try_from(pid) else {
        return false;
    };
    // SAFETY: signal zero only checks whether the PID exists.
    let exists = unsafe { libc::kill(pid, 0) } == 0;
    exists || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// Removes the socket of an abandoned runtime found by the shared sweep.
pub(super) fn remove_stale_endpoint(canonical_directory: &Path) -> Result<()> {
    let socket = socket_file(&socket_root(), canonical_directory);
    if fs::symlink_metadata(&socket).is_ok_and(|metadata| metadata.file_type().is_socket()) {
        fs::remove_file(&socket)?;
    }
    Ok(())
}

fn socket_path(directory: &Path) -> Result<PathBuf> {
    let directory =
        fs::canonicalize(directory).context("failed to resolve PTY runtime directory")?;
    let root = socket_root();
    ensure_private_directory(&root)?;
    Ok(socket_file(&root, &directory))
}

// Sockets stay in /tmp so their paths fit sun_path; temp cleaners skip sockets.
fn socket_root() -> PathBuf {
    PathBuf::from("/tmp").join(format!(
        "opencode-pty-{}",
        nix::unistd::Uid::effective().as_raw()
    ))
}

fn socket_file(root: &Path, canonical_directory: &Path) -> PathBuf {
    let digest = Sha256::digest(canonical_directory.as_os_str().as_bytes());
    let name = digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    root.join(format!("{name}.sock"))
}

fn ensure_private_directory(directory: &Path) -> Result<()> {
    fs::create_dir_all(directory)?;
    let metadata = fs::symlink_metadata(directory)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(anyhow!(
            "PTY socket directory is not a real directory: {}",
            directory.display()
        ));
    }
    let uid = nix::unistd::Uid::effective().as_raw();
    if metadata.uid() != uid {
        return Err(anyhow!(
            "PTY socket directory {} is owned by uid {}, expected {uid}",
            directory.display(),
            metadata.uid()
        ));
    }
    fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn write_registration(directory: &Path, registration: &Registration) -> Result<()> {
    let temporary = directory.join(format!("service.{}.tmp", registration.instance_id));
    let data = serde_json::to_vec_pretty(registration)?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)?;
    file.write_all(&data)?;
    file.sync_all()?;
    fs::rename(&temporary, registration_path(directory))?;
    Ok(())
}

fn remove_if_current(directory: &Path, registration: &Registration) -> Result<()> {
    if read_registration(directory)
        .is_ok_and(|current| current.instance_id == registration.instance_id)
    {
        fs::remove_file(registration_path(directory))?;
    }
    Ok(())
}

fn random_id() -> String {
    format!("{:032x}", rand::random::<u128>())
}

#[cfg(test)]
mod tests {
    use std::os::unix::net::UnixListener;

    use super::*;

    #[test]
    fn socket_paths_are_short_and_runtime_specific() {
        let base = std::env::temp_dir().join(format!("opencode-pty-socket-test-{}", random_id()));
        let first = base.join("a".repeat(120)).join("database-a");
        let second = base.join("b".repeat(120)).join("database-b");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();

        let first_socket = socket_path(&first).unwrap();
        let second_socket = socket_path(&second).unwrap();

        assert_ne!(first_socket, second_socket);
        assert!(first_socket.as_os_str().as_bytes().len() < 104);
        assert_eq!(first_socket.parent(), second_socket.parent());

        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn sweep_removes_abandoned_socket() {
        let root = std::env::temp_dir().join(format!("opencode-pty-sweep-test-{}", random_id()));
        let abandoned = root.join(random_id());
        fs::create_dir_all(&abandoned).unwrap();
        fs::write(abandoned.join(LOCK_FILE), b"").unwrap();
        let socket = socket_path(&abandoned).unwrap();
        drop(UnixListener::bind(&socket).unwrap());

        let later = std::time::SystemTime::now()
            + super::super::sweep::STALE_RUNTIME_AGE
            + std::time::Duration::from_secs(1);
        super::super::sweep::runtime(&abandoned, later).unwrap();

        assert!(!abandoned.exists());
        assert!(!socket.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
