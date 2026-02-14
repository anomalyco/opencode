{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

-- | Sandbox execution via bwrap (bubblewrap)
--
-- Architecture:
--
--   Host                          Sandbox (namespaced)
--   ────                          ────────────────────
--   opencode-server               
--        │                        
--        │ fork+exec bwrap        
--        └──────────────────────▶ bwrap
--                                    │
--                                    │ unshare(CLONE_NEWUSER|NEWPID|NEWNS|...)
--                                    │ pivot_root to overlayfs
--                                    │ seccomp-bpf
--                                    │
--                                    └──▶ /bin/sh (or specified shell)
--                                              │
--                                              │ PTY master/slave
--                                              ▼
--                                         user shell session
--
-- Filesystem layout (overlayfs):
--
--   /tmp/opencode-sandbox-{id}/
--   ├── upper/     ← tmpfs, COW writes go here
--   ├── work/      ← overlayfs workdir
--   └── merged/    ← union mount (lower=/, upper=upper, workdir=work)
--
-- This gives us:
-- - Zero-cost COW: reads go to host /, writes go to tmpfs
-- - Instant cleanup: rm -rf the sandbox dir
-- - No persistent state unless explicitly mounted
--
module Sandbox.Sandbox
  ( -- * Sandbox lifecycle
    create
  , destroy
  , buildBwrapArgs
  ) where

import Control.Exception (try, SomeException)
import Control.Monad (void)
import Data.Text (Text)
import System.Directory
import System.FilePath ((</>))
import System.Posix.Signals (signalProcess, sigKILL, sigTERM)
import System.Process
import Control.Concurrent (threadDelay)

import qualified Data.Text as T

import Sandbox.Types

-- | Create sandbox directories and return the bwrap args
-- The actual process spawning is handled by Pty module
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
      let baseDir = "/tmp/opencode-sandbox-" <> T.unpack sandboxId
      void $ try @SomeException $ removeDirectoryRecursive baseDir
      pure $ Left $ T.pack $ "Failed to create sandbox: " <> show e
    Right r -> pure $ Right r

-- | Build bwrap command line arguments
buildBwrapArgs :: SandboxConfig -> [String]
buildBwrapArgs SandboxConfig{..} =
  concat
    [ -- User namespace (required for unprivileged)
      ["--unshare-user"]
      
      -- PID namespace
    , ["--unshare-pid"]
    
      -- Mount namespace
    , ["--unshare-uts"]
    , ["--unshare-ipc"]
    
      -- Network namespace (conditional)
    , case scNetwork of
        NetworkNone  -> ["--unshare-net"]
        NetworkHost  -> []  -- Share host network
        NetworkSlirp -> ["--unshare-net"]  -- TODO: add slirp4netns
    
      -- Die when parent dies
    , ["--die-with-parent"]
    
      -- Setup filesystem
    , ["--dev", "/dev"]
    , ["--proc", "/proc"]
    
      -- Bind-mount the host root read-only
    , ["--ro-bind", "/", "/"]
    
      -- Make specific paths writable via tmpfs overlay
    , ["--tmpfs", "/tmp"]
    , ["--tmpfs", "/home"]
    , ["--tmpfs", "/root"]
    , ["--tmpfs", "/var/tmp"]
    , ["--tmpfs", "/run"]
    
      -- Additional user-specified mounts
    , concatMap mountToArgs scMounts
    
      -- Working directory
    , ["--chdir", scWorkdir]
    
      -- Environment
    , ["--clearenv"]
    , concatMap envToArgs scEnv
    , defaultEnv
    
      -- Session (helps with signal handling)
    , if scSeccomp then ["--new-session"] else []
    
      -- No new privileges / drop caps
    , if rlNoNewPrivs scLimits then ["--cap-drop", "ALL"] else []
    
      -- The command to run (shell)
    , ["--", "/bin/sh", "-l"]
    ]

-- | Default environment variables
defaultEnv :: [String]
defaultEnv =
  [ "--setenv", "HOME", "/root"
  , "--setenv", "USER", "root"
  , "--setenv", "SHELL", "/bin/sh"
  , "--setenv", "PATH", "/nix/var/nix/profiles/default/bin:/usr/local/bin:/usr/bin:/bin"
  , "--setenv", "TERM", "xterm-256color"
  , "--setenv", "OPENCODE_SANDBOX", "1"
  , "--setenv", "LANG", "C.UTF-8"
  , "--setenv", "LC_ALL", "C.UTF-8"
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
  threadDelay 100000  -- 100ms
  void $ try @SomeException $ terminateProcess ph
  
  -- Cleanup overlay directory
  void $ try @SomeException $ removeDirectoryRecursive overlayDir
