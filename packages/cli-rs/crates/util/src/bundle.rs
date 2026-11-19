//! Finds the bundled server beside the real client executable, following symlinks on `PATH`.

use std::path::{Path, PathBuf};

use crate::path::realpath;

/// The bundled TypeScript binary's file name.
pub const SERVER: &str = if cfg!(windows) { "opencode.exe" } else { "opencode" };

/// The TypeScript binary beside this executable, when there is one ([`beside`]).
pub fn server() -> Option<PathBuf> {
    beside(&std::env::current_exe().ok()?)
}

/// Returns the sibling server's real path, without a Windows verbatim prefix. Rejects the client executable itself.
pub fn beside(executable: &Path) -> Option<PathBuf> {
    let real = realpath(executable)?;
    let server = realpath(&real.parent()?.join(SERVER))?;
    (server != real && server.is_file()).then_some(server)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected (bundle-server): the server is the sibling of the client's real path, through a link to the client; a
    // directory, a missing file or the client itself is none.
    #[test]
    fn the_server_is_the_file_beside_the_clients_real_path() {
        let dir = crate::temp::tempdir().unwrap();
        let real = |path: &Path| realpath(path).unwrap();
        let install = dir.path().join("lib");
        std::fs::create_dir_all(&install).unwrap();
        let client = install.join(if cfg!(windows) { "opencode-native.exe" } else { "opencode-native" });
        std::fs::write(&client, "client").unwrap();
        assert_eq!(beside(&client), None, "no server yet");
        std::fs::create_dir(install.join(SERVER)).unwrap();
        assert_eq!(beside(&client), None, "a directory");
        std::fs::remove_dir(install.join(SERVER)).unwrap();
        std::fs::write(install.join(SERVER), "server").unwrap();
        assert_eq!(beside(&client), Some(real(&install.join(SERVER))));
        assert_eq!(beside(&install.join(SERVER)), None, "the client named opencode");
        assert_eq!(beside(&dir.path().join("missing")), None);
        #[cfg(unix)]
        {
            let bin = dir.path().join("bin");
            std::fs::create_dir_all(&bin).unwrap();
            std::os::unix::fs::symlink(&client, bin.join("opencode-native")).unwrap();
            std::fs::write(bin.join(SERVER), "someone else's").unwrap();
            assert_eq!(beside(&bin.join("opencode-native")), Some(real(&install.join(SERVER))), "through the link");
        }
    }
}
