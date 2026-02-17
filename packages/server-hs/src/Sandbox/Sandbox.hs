{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

{- | Sandbox execution via bwrap (bubblewrap)

Architecture:

  Host                          Sandbox (namespaced)
  ────                          ────────────────────
  opencode-server
       │
       │ fork+exec bwrap
       └──────────────────────▶ bwrap
                                   │
                                   │ unshare(CLONE_NEWUSER|NEWPID|NEWNS|...)
                                   │ pivot_root to overlayfs
                                   │ seccomp-bpf
                                   │
                                   └──▶ /bin/sh (or specified shell)
                                             │
                                             │ PTY master/slave
                                             ▼
                                        user shell session

Filesystem layout (overlayfs):

  /tmp/opencode-sandbox-{id}/
  ├── upper/     ← tmpfs, COW writes go here
  ├── work/      ← overlayfs workdir
  └── merged/    ← union mount (lower=/, upper=upper, workdir=work)

This gives us:
- Zero-cost COW: reads go to host /, writes go to tmpfs
- Instant cleanup: rm -rf the sandbox dir
- No persistent state unless explicitly mounted
-}
module Sandbox.Sandbox (
    -- * Sandbox lifecycle
    create,
    destroy,
    destroyDir,
    buildBwrapArgs,

    -- * Commit / Changes
    commit,
    getChanges,
) where

import Control.Concurrent (threadDelay)
import Control.Exception (SomeException, try)
import Control.Monad (forM, void)
import Data.Text (Text)
import System.Directory
import System.Exit (ExitCode (..))
import System.FilePath ((</>))
import System.Process

import Data.Text qualified as T

import Sandbox.Types

{- | Create sandbox directories and return the bwrap args
The actual process spawning is handled by Pty module
-}
create :: Text -> SandboxConfig -> IO (Either Text (FilePath, [String]))
create sandboxId config = do
    -- Create overlay directory structure
    let baseDir = "/tmp/opencode-sandbox-" <> T.unpack sandboxId
        upperDir = baseDir </> "upper"
        workDir = baseDir </> "work"
        mergedDir = baseDir </> "merged"

    result <- try @SomeException $ do
        -- Setup directories
        createDirectoryIfMissing True upperDir
        createDirectoryIfMissing True workDir
        createDirectoryIfMissing True mergedDir

        -- Build bwrap arguments
        let args = buildBwrapArgs config

        pure (baseDir, args)

    case result of
        Left e -> do
            -- Cleanup on failure
            let baseDir' = "/tmp/opencode-sandbox-" <> T.unpack sandboxId
            void $ try @SomeException $ removeDirectoryRecursive baseDir'
            pure $ Left $ T.pack $ "Failed to create sandbox: " <> show e
        Right r -> pure $ Right r

-- | Build bwrap command line arguments
buildBwrapArgs :: SandboxConfig -> [String]
buildBwrapArgs SandboxConfig{..} =
    concat
        [ -- User namespace (required for unprivileged)
          ["--unshare-user"]
        , -- PID namespace
          ["--unshare-pid"]
        , -- Mount namespace
          ["--unshare-uts"]
        , ["--unshare-ipc"]
        , -- Network namespace (conditional)
          case scNetwork of
            NetworkNone -> ["--unshare-net"]
            NetworkHost -> [] -- Share host network
            NetworkSlirp -> ["--unshare-net"] -- TODO: add slirp4netns
        , -- Die when parent dies
          ["--die-with-parent"]
        , -- Setup filesystem
          ["--dev", "/dev"]
        , ["--proc", "/proc"]
        , -- Bind-mount the host root read-only
          ["--ro-bind", "/", "/"]
        , -- Make specific paths writable via tmpfs overlay
          -- Note: Don't tmpfs /run on NixOS - it contains /run/current-system/sw/bin
          ["--tmpfs", "/tmp"]
        , ["--tmpfs", "/var/tmp"]
        , -- Bind-mount workdir (read-write) AFTER root is set up
          -- This allows access to the project directory
          ["--bind", scWorkdir, scWorkdir]
        , -- Additional user-specified mounts
          concatMap mountToArgs scMounts
        , -- Working directory
          ["--chdir", scWorkdir]
        , -- Environment
          ["--clearenv"]
        , concatMap envToArgs scEnv
        , defaultEnv
        , -- Session (helps with signal handling)
          if scSeccomp then ["--new-session"] else []
        , -- No new privileges / drop caps
          if rlNoNewPrivs scLimits then ["--cap-drop", "ALL"] else []
        , -- The command to run (shell)
          ["--", "/bin/sh", "-l"]
        ]

-- | Default environment variables
defaultEnv :: [String]
defaultEnv =
    [ "--setenv"
    , "HOME"
    , "/root"
    , "--setenv"
    , "USER"
    , "root"
    , "--setenv"
    , "SHELL"
    , "/bin/sh"
    , -- NixOS-compatible PATH (includes /run/current-system/sw/bin)
      "--setenv"
    , "PATH"
    , "/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/usr/local/bin:/usr/bin:/bin"
    , "--setenv"
    , "TERM"
    , "xterm-256color"
    , "--setenv"
    , "OPENCODE_SANDBOX"
    , "1"
    , "--setenv"
    , "LANG"
    , "C.UTF-8"
    , "--setenv"
    , "LC_ALL"
    , "C.UTF-8"
    , -- Route all HTTP traffic through MITM proxy for surveillance
      "--setenv"
    , "HTTP_PROXY"
    , "http://127.0.0.1:8888"
    , "--setenv"
    , "HTTPS_PROXY"
    , "http://127.0.0.1:8888"
    , "--setenv"
    , "http_proxy"
    , "http://127.0.0.1:8888"
    , "--setenv"
    , "https_proxy"
    , "http://127.0.0.1:8888"
    ]

-- | Convert a mount spec to bwrap arguments
mountToArgs :: MountSpec -> [String]
mountToArgs MountSpec{..} =
    if msReadOnly
        then ["--ro-bind", msSource, msDest]
        else ["--bind", msSource, msDest]

-- | Convert environment variable to bwrap arguments
envToArgs :: (Text, Text) -> [String]
envToArgs (k, v) = ["--setenv", T.unpack k, T.unpack v]

-- | Destroy a sandbox (cleanup directories, kill process)
destroy :: FilePath -> ProcessHandle -> IO ()
destroy overlayDir ph = do
    -- Terminate the process
    terminateProcess ph

    -- Wait a bit then force kill
    threadDelay 100000 -- 100ms
    void $ try @SomeException $ terminateProcess ph

    -- Cleanup overlay directory
    void $ try @SomeException $ removeDirectoryRecursive overlayDir

-- | Destroy just the sandbox directory (process already terminated)
destroyDir :: FilePath -> IO ()
destroyDir overlayDir = do
    void $ try @SomeException $ removeDirectoryRecursive overlayDir

{- | Commit sandbox changes to real filesystem
Copies files from overlay upper dir to the original workdir
-}
commit :: FilePath -> FilePath -> IO (Either Text ())
commit overlayDir workdir = do
    let upperDir = overlayDir </> "upper"

    -- Check if upper dir exists and has changes
    exists <- doesDirectoryExist upperDir
    if not exists
        then pure $ Left "Overlay upper dir not found"
        else do
            -- Use rsync to copy changes
            -- -a: archive mode (preserves permissions, etc)
            -- -v: verbose
            -- --delete: remove files in dest that don't exist in source (optional, disabled for safety)
            let rsyncArgs = ["-a", upperDir <> "/", workdir <> "/"]

            result <- try @SomeException $ do
                (_, _, _, ph) <- createProcess (proc "rsync" rsyncArgs)
                exitCode <- waitForProcess ph
                pure exitCode

            case result of
                Left e -> pure $ Left $ "rsync failed: " <> T.pack (show e)
                Right ExitSuccess -> pure $ Right ()
                Right (ExitFailure n) -> pure $ Left $ "rsync exited with code " <> T.pack (show n)

-- | Get list of changed files in sandbox
getChanges :: FilePath -> IO [FilePath]
getChanges overlayDir = do
    let upperDir = overlayDir </> "upper"
    exists <- doesDirectoryExist upperDir
    if not exists
        then pure []
        else listDirectoryRecursive upperDir

-- | List all files recursively in a directory
listDirectoryRecursive :: FilePath -> IO [FilePath]
listDirectoryRecursive dir = do
    entries <- listDirectory dir
    paths <- forM entries $ \entry -> do
        let path = dir </> entry
        isDir <- doesDirectoryExist path
        if isDir
            then listDirectoryRecursive path
            else pure [path]
    pure $ concat paths
