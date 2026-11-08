//! Temporary directories for tests and examples, as `tempfile`'s `tempdir()` and `TempDir` make them. A name is
//! unique without a random source: the process ID, a process-wide count and the time, retried if it exists.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// A new directory under `std::env::temp_dir()`, readable only by its owner on Unix, removed with its contents when
/// the value drops.
#[derive(Debug)]
pub struct TempDir {
    path: PathBuf,
}

impl TempDir {
    pub fn new() -> io::Result<Self> {
        Self::new_in(&std::env::temp_dir())
    }

    /// Made absolute first, as `tempfile` does, so a later `chdir` cannot redirect the removal.
    fn new_in(base: &Path) -> io::Result<Self> {
        let base = std::path::absolute(base)?;
        static COUNT: AtomicU64 = AtomicU64::new(0);
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
        loop {
            let count = COUNT.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |time| time.as_nanos());
            let path = base.join(format!(".tmp-{}-{count}-{nanos:x}", std::process::id()));
            match builder.create(&path) {
                Ok(()) => return Ok(Self { path }),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl AsRef<Path> for TempDir {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

pub fn tempdir() -> io::Result<TempDir> {
    TempDir::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directories_are_new_and_removed_on_drop() {
        let dirs = (0..64).map(|_| tempdir().unwrap()).collect::<Vec<_>>();
        let paths = dirs.iter().map(|dir| dir.path().to_owned()).collect::<std::collections::HashSet<_>>();
        assert_eq!(paths.len(), dirs.len());
        let dir = &dirs[0];
        assert!(dir.path().starts_with(std::env::temp_dir()) && dir.path().is_dir());
        assert_eq!(std::fs::read_dir(dir).unwrap().count(), 0);
        std::fs::create_dir_all(dir.path().join("a/b")).unwrap();
        std::fs::write(dir.path().join("a/b/c"), "c").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(dir).unwrap().permissions().mode() & 0o777, 0o700);
        }
        drop(dirs);
        assert!(paths.iter().all(|path| !path.exists()));
    }

    #[test]
    fn a_relative_base_is_made_absolute() {
        let base = tempdir().unwrap();
        let relative = pathdiff(base.path());
        let dir = TempDir::new_in(&relative).unwrap();
        assert!(dir.path().is_absolute());
        let canonical = |path: &Path| path.canonicalize().unwrap();
        assert_eq!(canonical(dir.path()).parent(), Some(canonical(base.path()).as_path()));
    }

    /// `target` relative to the working directory, through `..` up to the root.
    fn pathdiff(target: &Path) -> PathBuf {
        let cwd = std::env::current_dir().unwrap();
        let ups = cwd.components().count() - 1;
        std::iter::repeat_n(Path::new(".."), ups).collect::<PathBuf>().join(target.strip_prefix("/").unwrap())
    }
}
