mod copy;
mod git;

use copy::{CopyStrategy, CowStrategy};
use rusqlite::{Connection, OptionalExtension, params};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;
use ulid::Ulid;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Database(#[from] rusqlite::Error),
    #[error("{0}")]
    Walk(#[from] walkdir::Error),
    #[error("invalid path: {0}")]
    Path(String),
    #[error("copy-on-write cloning unavailable: {0}")]
    CowUnavailable(String),
    #[error("unsupported filesystem entry: {0}")]
    UnsupportedEntry(PathBuf),
    #[error("unsafe Git source: {0}")]
    UnsafeGit(String),
    #[error("worktree is not managed: {0}")]
    NotManaged(PathBuf),
    #[error("worktree marker does not match the registry at: {0}")]
    MarkerMismatch(PathBuf),
    #[error("worktree marker belongs to an unknown registry entry at: {0}")]
    UnknownMarker(PathBuf),
    #[error("worktree already exists: {0}")]
    AlreadyExists(PathBuf),
    #[error("cannot remove the original registered workspace: {0}")]
    CannotRemoveRoot(PathBuf),
    #[error("cannot reparent the original registered workspace: {0}")]
    CannotLinkRoot(PathBuf),
    #[error("cannot remove subtree while a recorded worktree path is missing: {0}")]
    MissingWorktree(PathBuf),
    #[error("cannot link a worktree to itself or its descendant")]
    Cycle,
    #[error("cannot copy a workspace into itself: {0}")]
    InsideSource(PathBuf),
}

pub struct Create {
    pub from: PathBuf,
    pub name: Option<String>,
    pub into: Option<PathBuf>,
}

pub struct Link {
    pub at: PathBuf,
    pub to: Option<PathBuf>,
}

#[derive(Clone)]
struct Record {
    id: String,
    parent_id: Option<String>,
    path: PathBuf,
}

pub struct Manager {
    database: Connection,
    copier: Box<dyn CopyStrategy>,
}

impl Manager {
    pub fn open_default() -> Result<Self> {
        let path = default_database_path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        Self::open(path)
    }

    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        Self::with_copier(path, Box::new(CowStrategy))
    }

    fn with_copier(path: impl AsRef<Path>, copier: Box<dyn CopyStrategy>) -> Result<Self> {
        let database = Connection::open(path)?;
        database.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS worktree (
               id TEXT PRIMARY KEY,
               parent_id TEXT REFERENCES worktree(id) ON DELETE CASCADE,
               path TEXT NOT NULL UNIQUE,
               created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS worktree_parent_id_idx ON worktree(parent_id);",
        )?;
        Ok(Self { database, copier })
    }

    pub fn create(&mut self, input: Create) -> Result<PathBuf> {
        let from = existing_directory(&input.from)?;
        let git = git::check_source(&from)?;
        let (source, register_source) = self.source(&from)?;
        let root = self.root(&source)?;
        let id = Ulid::new().to_string();
        let destination_parent = match input.into {
            Some(path) => absolute_path(&path)?,
            None => default_storage(&root.path)?,
        };
        let name = destination_name(input.name, &id)?;
        if destination_parent.join(&name).starts_with(&from) {
            return Err(Error::InsideSource(destination_parent.join(name)));
        }
        fs::create_dir_all(&destination_parent)?;
        let destination_parent = fs::canonicalize(destination_parent)?;
        let destination = destination_parent.join(name);
        if destination.starts_with(&from) {
            return Err(Error::InsideSource(destination));
        }
        if destination.exists() {
            return Err(Error::AlreadyExists(destination));
        }

        if let Err(error) = self.copier.copy_directory(&from, &destination) {
            let _ = fs::remove_dir_all(&destination);
            return Err(error);
        }

        let result = (|| {
            write_marker(&destination, &id)?;
            if git {
                git::hide_marker(&destination)?;
                git::detach_destination(&destination)?;
            }
            if register_source {
                write_marker(&from, &source.id)?;
                self.database.execute(
                    "INSERT INTO worktree (id, parent_id, path, created_at) VALUES (?1, NULL, ?2, ?3)",
                    params![source.id, path_text(&from)?, timestamp()],
                )?;
            }
            if git {
                git::hide_marker(&from)?;
            }
            self.database.execute(
                "INSERT INTO worktree (id, parent_id, path, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![id, source.id, path_text(&destination)?, timestamp()],
            )?;
            Ok(destination.clone())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&destination);
        }
        result
    }

    pub fn remove(&mut self, at: impl AsRef<Path>) -> Result<()> {
        let at = existing_directory(at.as_ref())?;
        let record = self.record_at(&at)?;
        if record.parent_id.is_none() {
            return Err(Error::CannotRemoveRoot(at));
        }
        verify_marker(&record)?;
        let mut statement = self.database.prepare(
            "WITH RECURSIVE subtree(id, path, depth) AS (
               SELECT id, path, 0 FROM worktree WHERE id = ?1
               UNION ALL
               SELECT worktree.id, worktree.path, subtree.depth + 1
               FROM worktree JOIN subtree ON worktree.parent_id = subtree.id
             ) SELECT id, path, depth FROM subtree ORDER BY depth DESC",
        )?;
        let rows = statement
            .query_map([&record.id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    PathBuf::from(row.get::<_, String>(1)?),
                    row.get::<_, i64>(2)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(statement);
        for (id, path, _) in &rows {
            if !path.exists() {
                return Err(Error::MissingWorktree(path.clone()));
            }
            verify_marker(&Record {
                id: id.clone(),
                parent_id: None,
                path: path.clone(),
            })?;
        }
        for (id, path, _) in &rows {
            fs::remove_dir_all(path)?;
            self.database
                .execute("DELETE FROM worktree WHERE id = ?1", [id])?;
        }
        Ok(())
    }

    pub fn link(&mut self, input: Link) -> Result<()> {
        let at = existing_directory(&input.at)?;
        let record = match read_marker(&at)? {
            Some(id) => {
                let record = self
                    .record_id(&id)?
                    .ok_or_else(|| Error::UnknownMarker(at.clone()))?;
                if record.path != at {
                    if record.path.exists() {
                        return Err(Error::MarkerMismatch(at));
                    }
                    self.database.execute(
                        "UPDATE worktree SET path = ?1 WHERE id = ?2",
                        params![path_text(&at)?, record.id],
                    )?;
                }
                Record {
                    path: at.clone(),
                    ..record
                }
            }
            None => {
                let record = self.record_at(&at)?;
                write_marker(&at, &record.id)?;
                record
            }
        };
        if at.join(".git").is_dir() {
            git::hide_marker(&at)?;
        }
        let Some(to) = input.to else {
            return Ok(());
        };
        if record.parent_id.is_none() {
            return Err(Error::CannotLinkRoot(at));
        }
        let parent = self.record_at(&existing_directory(&to)?)?;
        if parent.id == record.id || self.is_descendant(&parent.id, &record.id)? {
            return Err(Error::Cycle);
        }
        self.database.execute(
            "UPDATE worktree SET parent_id = ?1 WHERE id = ?2",
            params![parent.id, record.id],
        )?;
        Ok(())
    }

    pub fn children(&self, of: impl AsRef<Path>) -> Result<Vec<PathBuf>> {
        let record = self.record_at(&existing_directory(of.as_ref())?)?;
        let mut statement = self
            .database
            .prepare("SELECT path FROM worktree WHERE parent_id = ?1 ORDER BY created_at, id")?;
        Ok(statement
            .query_map([record.id], |row| {
                Ok(PathBuf::from(row.get::<_, String>(0)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn ancestors(&self, of: impl AsRef<Path>) -> Result<Vec<PathBuf>> {
        let record = self.record_at(&existing_directory(of.as_ref())?)?;
        let mut paths = Vec::new();
        let mut parent_id = record.parent_id;
        while let Some(id) = parent_id {
            let parent = self
                .record_id(&id)?
                .ok_or_else(|| Error::NotManaged(record.path.clone()))?;
            paths.push(parent.path);
            parent_id = parent.parent_id;
        }
        Ok(paths)
    }

    fn source(&self, path: &Path) -> Result<(Record, bool)> {
        if let Some(id) = read_marker(path)? {
            let record = self
                .record_id(&id)?
                .ok_or_else(|| Error::UnknownMarker(path.to_path_buf()))?;
            if record.path != path {
                return Err(Error::MarkerMismatch(path.to_path_buf()));
            }
            return Ok((record, false));
        }
        if self.record_at_optional(path)?.is_some() {
            return Err(Error::MarkerMismatch(path.to_path_buf()));
        }
        let id = Ulid::new().to_string();
        Ok((
            Record {
                id,
                parent_id: None,
                path: path.to_path_buf(),
            },
            true,
        ))
    }

    fn root(&self, record: &Record) -> Result<Record> {
        let mut current = record.clone();
        while let Some(id) = current.parent_id.clone() {
            current = self
                .record_id(&id)?
                .ok_or_else(|| Error::NotManaged(record.path.clone()))?;
        }
        Ok(current)
    }

    fn record_at(&self, path: &Path) -> Result<Record> {
        self.record_at_optional(path)?
            .ok_or_else(|| Error::NotManaged(path.to_path_buf()))
    }

    fn record_at_optional(&self, path: &Path) -> Result<Option<Record>> {
        self.database
            .query_row(
                "SELECT id, parent_id, path FROM worktree WHERE path = ?1",
                [path_text(path)?],
                |row| {
                    Ok(Record {
                        id: row.get(0)?,
                        parent_id: row.get(1)?,
                        path: PathBuf::from(row.get::<_, String>(2)?),
                    })
                },
            )
            .optional()
            .map_err(Error::from)
    }

    fn record_id(&self, id: &str) -> Result<Option<Record>> {
        self.database
            .query_row(
                "SELECT id, parent_id, path FROM worktree WHERE id = ?1",
                [id],
                |row| {
                    Ok(Record {
                        id: row.get(0)?,
                        parent_id: row.get(1)?,
                        path: PathBuf::from(row.get::<_, String>(2)?),
                    })
                },
            )
            .optional()
            .map_err(Error::from)
    }

    fn is_descendant(&self, candidate: &str, of: &str) -> Result<bool> {
        Ok(self.database.query_row(
            "WITH RECURSIVE descendants(id) AS (
               SELECT id FROM worktree WHERE parent_id = ?1
               UNION ALL
               SELECT worktree.id FROM worktree JOIN descendants ON worktree.parent_id = descendants.id
             ) SELECT EXISTS(SELECT 1 FROM descendants WHERE id = ?2)",
            params![of, candidate],
            |row| row.get(0),
        )?)
    }
}

fn default_database_path() -> Result<PathBuf> {
    let base = dirs::data_local_dir()
        .ok_or_else(|| Error::Path("user data directory is unavailable".into()))?;
    Ok(base.join("worktree").join("worktree.sqlite"))
}

fn existing_directory(path: &Path) -> Result<PathBuf> {
    let path = fs::canonicalize(path)?;
    if !path.is_dir() {
        return Err(Error::Path(format!("not a directory: {}", path.display())));
    }
    Ok(path)
}

fn absolute_path(path: &Path) -> Result<PathBuf> {
    if path.is_absolute() {
        return Ok(path.to_path_buf());
    }
    Ok(std::env::current_dir()?.join(path))
}

fn default_storage(root: &Path) -> Result<PathBuf> {
    let parent = root
        .parent()
        .ok_or_else(|| Error::Path(format!("workspace has no parent: {}", root.display())))?;
    let name = root
        .file_name()
        .ok_or_else(|| Error::Path(format!("workspace has no name: {}", root.display())))?;
    Ok(parent.join(".worktrees").join(name))
}

fn destination_name(name: Option<String>, id: &str) -> Result<String> {
    let name = name.unwrap_or_else(|| id.to_owned());
    if name.is_empty() || name == "." || name == ".." || Path::new(&name).components().count() != 1
    {
        return Err(Error::Path(format!("invalid worktree name: {name}")));
    }
    Ok(name)
}

fn marker(path: &Path) -> PathBuf {
    path.join(".worktree")
}

fn write_marker(path: &Path, id: &str) -> Result<()> {
    fs::write(marker(path), format!("{id}\n"))?;
    Ok(())
}

fn read_marker(path: &Path) -> Result<Option<String>> {
    let marker = marker(path);
    if !marker.exists() {
        return Ok(None);
    }
    Ok(Some(fs::read_to_string(marker)?.trim().to_owned()))
}

fn verify_marker(record: &Record) -> Result<()> {
    if read_marker(&record.path)?.as_deref() == Some(&record.id) {
        return Ok(());
    }
    Err(Error::MarkerMismatch(record.path.clone()))
}

fn path_text(path: &Path) -> Result<String> {
    path.to_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| Error::Path(format!("path is not valid UTF-8: {}", path.display())))
}

fn timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::copy::{FailureStrategy, TestStrategy};
    use std::process::Command;
    use tempfile::TempDir;

    fn manager(temp: &TempDir) -> Manager {
        Manager::with_copier(temp.path().join("registry.sqlite"), Box::new(TestStrategy)).unwrap()
    }

    fn source(temp: &TempDir) -> PathBuf {
        let source = temp.path().join("app");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("file.txt"), "hello").unwrap();
        source
    }

    #[test]
    fn create_tracks_parentage_and_default_storage() {
        let temp = TempDir::new().unwrap();
        let source = source(&temp);
        let mut manager = manager(&temp);
        let first = manager
            .create(Create {
                from: source.clone(),
                name: Some("first".into()),
                into: None,
            })
            .unwrap();
        let second = manager
            .create(Create {
                from: first.clone(),
                name: Some("second".into()),
                into: None,
            })
            .unwrap();

        assert_eq!(first, temp.path().join(".worktrees/app/first"));
        assert_eq!(second, temp.path().join(".worktrees/app/second"));
        assert_ne!(
            fs::read_to_string(source.join(".worktree")).unwrap(),
            fs::read_to_string(first.join(".worktree")).unwrap()
        );
        assert_eq!(manager.children(&source).unwrap(), vec![first.clone()]);
        assert_eq!(manager.ancestors(&second).unwrap(), vec![first, source]);
    }

    #[test]
    fn remove_deletes_a_full_subtree() {
        let temp = TempDir::new().unwrap();
        let source = source(&temp);
        let mut manager = manager(&temp);
        let first = manager
            .create(Create {
                from: source.clone(),
                name: Some("first".into()),
                into: None,
            })
            .unwrap();
        let second = manager
            .create(Create {
                from: first.clone(),
                name: Some("second".into()),
                into: None,
            })
            .unwrap();

        manager.remove(&first).unwrap();

        assert!(!first.exists());
        assert!(!second.exists());
        assert!(manager.children(&source).unwrap().is_empty());
        assert!(matches!(
            manager.remove(&source),
            Err(Error::CannotRemoveRoot(_))
        ));
    }

    #[test]
    fn remove_refuses_a_subtree_with_an_unlinked_move() {
        let temp = TempDir::new().unwrap();
        let source = source(&temp);
        let mut manager = manager(&temp);
        let first = manager
            .create(Create {
                from: source,
                name: Some("first".into()),
                into: None,
            })
            .unwrap();
        let second = manager
            .create(Create {
                from: first.clone(),
                name: Some("second".into()),
                into: None,
            })
            .unwrap();
        fs::rename(&second, temp.path().join("moved")).unwrap();

        assert!(matches!(
            manager.remove(&first),
            Err(Error::MissingWorktree(_))
        ));
        assert!(first.exists());
    }

    #[test]
    fn link_restores_moves_markers_and_reparents() {
        let temp = TempDir::new().unwrap();
        let source = source(&temp);
        let mut manager = manager(&temp);
        let first = manager
            .create(Create {
                from: source.clone(),
                name: Some("first".into()),
                into: None,
            })
            .unwrap();
        let second = manager
            .create(Create {
                from: source.clone(),
                name: Some("second".into()),
                into: None,
            })
            .unwrap();
        let moved = temp.path().join("moved");
        fs::rename(&second, &moved).unwrap();

        manager
            .link(Link {
                at: moved.clone(),
                to: Some(first.clone()),
            })
            .unwrap();
        assert_eq!(
            manager.ancestors(&moved).unwrap(),
            vec![first, source.clone()]
        );

        fs::remove_file(source.join(".worktree")).unwrap();
        manager
            .link(Link {
                at: source.clone(),
                to: None,
            })
            .unwrap();
        assert!(source.join(".worktree").exists());
    }

    #[test]
    fn link_does_not_reparent_a_registered_source() {
        let temp = TempDir::new().unwrap();
        let source = source(&temp);
        let mut manager = manager(&temp);
        let child = manager
            .create(Create {
                from: source.clone(),
                name: Some("child".into()),
                into: None,
            })
            .unwrap();

        assert!(matches!(
            manager.link(Link {
                at: source.clone(),
                to: Some(child),
            }),
            Err(Error::CannotLinkRoot(_))
        ));
        assert!(matches!(
            manager.remove(&source),
            Err(Error::CannotRemoveRoot(_))
        ));
    }

    #[test]
    fn git_copy_detaches_head_and_preserves_dirty_state() {
        let temp = TempDir::new().unwrap();
        let source = source(&temp);
        run(&source, &["init"]);
        run(&source, &["config", "user.email", "test@example.com"]);
        run(&source, &["config", "user.name", "Test"]);
        run(&source, &["add", "file.txt"]);
        run(&source, &["commit", "-m", "initial"]);
        fs::write(source.join("file.txt"), "changed").unwrap();
        run(&source, &["add", "file.txt"]);
        fs::write(source.join("untracked.txt"), "new").unwrap();
        let mut manager = manager(&temp);

        let destination = manager
            .create(Create {
                from: source.clone(),
                name: Some("git".into()),
                into: None,
            })
            .unwrap();

        assert!(
            !Command::new("git")
                .arg("-C")
                .arg(&destination)
                .args(["symbolic-ref", "-q", "HEAD"])
                .status()
                .unwrap()
                .success()
        );
        let staged = Command::new("git")
            .arg("-C")
            .arg(&destination)
            .args(["diff", "--cached", "--name-only"])
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&staged.stdout).contains("file.txt"));
        assert!(destination.join("untracked.txt").exists());
        let status = Command::new("git")
            .arg("-C")
            .arg(&destination)
            .args(["status", "--porcelain", "--", ".worktree"])
            .output()
            .unwrap();
        assert!(status.stdout.is_empty());
    }

    #[test]
    fn unsafe_git_source_is_rejected_without_registering_it() {
        let temp = TempDir::new().unwrap();
        let source = source(&temp);
        run(&source, &["init"]);
        fs::write(source.join(".git/MERGE_HEAD"), "commit").unwrap();
        let mut manager = manager(&temp);

        assert!(matches!(
            manager.create(Create {
                from: source.clone(),
                name: Some("unsafe".into()),
                into: None,
            }),
            Err(Error::UnsafeGit(_))
        ));
        assert!(!source.join(".worktree").exists());
    }

    #[test]
    fn unavailable_cow_does_not_register_the_source() {
        let temp = TempDir::new().unwrap();
        let source = source(&temp);
        let mut manager = Manager::with_copier(
            temp.path().join("registry.sqlite"),
            Box::new(FailureStrategy),
        )
        .unwrap();

        assert!(matches!(
            manager.create(Create {
                from: source.clone(),
                name: Some("failure".into()),
                into: None,
            }),
            Err(Error::CowUnavailable(_))
        ));
        assert!(!source.join(".worktree").exists());
        assert!(manager.record_at_optional(&source).unwrap().is_none());
    }

    fn run(path: &Path, args: &[&str]) {
        assert!(
            Command::new("git")
                .arg("-C")
                .arg(path)
                .args(args)
                .status()
                .unwrap()
                .success()
        );
    }
}
