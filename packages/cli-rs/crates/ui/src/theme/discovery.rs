//! Custom themes: `themes/*.json` in the config directories (`packages/tui/src/theme/discovery.ts`).

use std::io;
use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use serde_json::Value;

/// The config directory, then `.opencode` in every directory from the root down to `cwd`, without repeats
/// (`configDirectories` in `packages/tui/src/util/config-directories.ts`). `cwd` must be absolute.
pub fn config_directories(config: &Path, cwd: &Path) -> Vec<PathBuf> {
    let mut ancestors: Vec<&Path> = cwd.ancestors().collect();
    ancestors.reverse();
    let mut result = vec![config.to_path_buf()];
    for directory in ancestors
        .into_iter()
        .map(|directory| directory.join(".opencode"))
    {
        if !result.contains(&directory) {
            result.push(directory);
        }
    }
    result
}

/// Reads every `themes/*.json` under `directories`, in order and sorted by path within a directory. A later file
/// with the same name replaces an earlier one but keeps its place. A missing `themes` directory is skipped; any other
/// read or JSON error fails the whole discovery, as in TypeScript. Blocking: run it off the UI thread.
pub fn discover(directories: &[PathBuf]) -> io::Result<IndexMap<String, Value>> {
    let mut result = IndexMap::new();
    for directory in directories {
        let entries = match std::fs::read_dir(directory.join("themes")) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        let mut files = Vec::new();
        for entry in entries {
            let entry = entry?;
            let kind = entry.file_type()?;
            let path = entry.path();
            if (kind.is_file() || kind.is_symlink())
                && path
                    .extension()
                    .is_some_and(|extension| extension == "json")
            {
                files.push(path);
            }
        }
        files.sort();
        for file in files {
            let value =
                serde_json::from_str(&std::fs::read_to_string(&file)?).map_err(|error| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("{}: {error}", file.display()),
                    )
                })?;
            let name = file
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_default();
            result.insert(name, value);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_directories_lists_config_then_each_ancestor() {
        let directories = config_directories(
            Path::new("/home/u/.config/opencode"),
            Path::new("/home/u/project"),
        );
        let expected = [
            "/home/u/.config/opencode",
            "/.opencode",
            "/home/.opencode",
            "/home/u/.opencode",
            "/home/u/project/.opencode",
        ];
        assert_eq!(directories, expected.map(PathBuf::from));
        let repeated = config_directories(Path::new("/a/.opencode"), Path::new("/a"));
        assert_eq!(repeated, ["/a/.opencode", "/.opencode"].map(PathBuf::from));
    }

    #[test]
    fn discover_reads_sorted_json_files_and_later_directories_override() {
        let root = tempfile::tempdir().unwrap();
        let (first, second) = (root.path().join("one"), root.path().join("two"));
        for (directory, files) in [
            (&first, ["b.json", "a.json", "notes.txt"]),
            (&second, ["b.json", "c.json", "skip.md"]),
        ] {
            std::fs::create_dir_all(directory.join("themes")).unwrap();
            for file in files {
                let content = format!("{{\"from\":\"{}\"}}", directory.display());
                std::fs::write(directory.join("themes").join(file), content).unwrap();
            }
        }
        let missing = root.path().join("missing");
        let themes = discover(&[first.clone(), missing, second.clone()]).unwrap();
        assert_eq!(themes.keys().collect::<Vec<_>>(), ["a", "b", "c"]);
        assert_eq!(themes["b"]["from"], second.display().to_string());
        assert_eq!(themes["a"]["from"], first.display().to_string());

        std::fs::write(second.join("themes").join("broken.json"), "{").unwrap();
        assert_eq!(
            discover(&[second]).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }
}
