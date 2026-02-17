{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

{- | Sandbox types for isolated shell execution

Uses Linux namespaces (via bwrap/unshare) for:
- User namespace (unprivileged isolation)
- PID namespace (process isolation)
- Mount namespace (filesystem isolation with overlayfs COW)
- Network namespace (optional network isolation)
- IPC namespace (System V IPC isolation)

Zero-cost COW: overlayfs upperdir is tmpfs, lowerdir is host readonly
-}
module Sandbox.Types (
    -- * Configuration
    SandboxConfig (..),
    NetworkMode (..),
    MountSpec (..),
    defaultConfig,

    -- * Sandbox State
    SandboxState (..),
    SandboxStatus (..),
    SandboxInfo (..),

    -- * Resource Limits
    ResourceLimits (..),
    defaultLimits,

    -- * Coeffects (for DischargeProof integration)
    Coeffects (..),
    pureCoeffects,
) where

import Data.Aeson
import Data.Text (Text)
import Data.Word (Word64)
import GHC.Generics (Generic)
import System.Posix.Types (ProcessID)

-- | Network isolation mode
data NetworkMode
    = -- | No network access (loopback only)
      NetworkNone
    | -- | Share host network namespace
      NetworkHost
    | -- | User-mode networking via slirp4netns
      NetworkSlirp
    deriving (Eq, Show, Generic)

instance ToJSON NetworkMode where
    toJSON NetworkNone = "none"
    toJSON NetworkHost = "host"
    toJSON NetworkSlirp = "slirp"

instance FromJSON NetworkMode where
    parseJSON = withText "NetworkMode" $ \case
        "none" -> pure NetworkNone
        "host" -> pure NetworkHost
        "slirp" -> pure NetworkSlirp
        _ -> fail "Invalid NetworkMode"

-- | Mount specification for bind mounts
data MountSpec = MountSpec
    { msSource :: FilePath
    -- ^ Host path
    , msDest :: FilePath
    -- ^ Container path
    , msReadOnly :: Bool
    -- ^ Read-only bind
    }
    deriving (Eq, Show, Generic)

instance ToJSON MountSpec
instance FromJSON MountSpec

-- | Resource limits (cgroup v2)
data ResourceLimits = ResourceLimits
    { rlMemoryMax :: Maybe Word64
    -- ^ Memory limit in bytes
    , rlCpuMax :: Maybe Word64
    -- ^ CPU quota (microseconds per period)
    , rlCpuPeriod :: Word64
    -- ^ CPU period (default 100000us = 100ms)
    , rlPidsMax :: Maybe Word64
    -- ^ Max number of processes
    , rlNoNewPrivs :: Bool
    -- ^ PR_SET_NO_NEW_PRIVS
    }
    deriving (Eq, Show, Generic)

instance ToJSON ResourceLimits
instance FromJSON ResourceLimits

-- | Default resource limits (conservative)
defaultLimits :: ResourceLimits
defaultLimits =
    ResourceLimits
        { rlMemoryMax = Just (2 * 1024 * 1024 * 1024) -- 2GB
        , rlCpuMax = Nothing -- No CPU limit
        , rlCpuPeriod = 100000 -- 100ms
        , rlPidsMax = Just 1000 -- 1000 processes
        , rlNoNewPrivs = True -- Always set
        }

{- | Coeffects - what resources the sandbox requires
Maps to sensenet's Resource.dhall
-}
data Coeffects = Coeffects
    { cfNetwork :: Bool
    -- ^ Needs network access
    , cfAuth :: [Text]
    -- ^ Auth providers needed
    , cfFilesystem :: [FilePath]
    -- ^ Filesystem paths needed (beyond sandbox)
    }
    deriving (Eq, Show, Generic)

instance ToJSON Coeffects
instance FromJSON Coeffects

-- | Pure coeffects (sandbox needs nothing external)
pureCoeffects :: Coeffects
pureCoeffects =
    Coeffects
        { cfNetwork = False
        , cfAuth = []
        , cfFilesystem = []
        }

-- | Sandbox configuration
data SandboxConfig = SandboxConfig
    { scRootfs :: Maybe FilePath
    -- ^ Custom rootfs (default: overlay on /)
    , scWorkdir :: FilePath
    -- ^ Working directory inside sandbox
    , scNetwork :: NetworkMode
    -- ^ Network isolation mode
    , scMounts :: [MountSpec]
    -- ^ Additional bind mounts
    , scEnv :: [(Text, Text)]
    -- ^ Environment variables
    , scLimits :: ResourceLimits
    -- ^ Resource limits
    , scCoeffects :: Coeffects
    -- ^ Declared coeffects
    , scSeccomp :: Bool
    -- ^ Enable seccomp-bpf filtering
    , scTmpfsSize :: Word64
    -- ^ Size of tmpfs overlay (bytes)
    }
    deriving (Eq, Show, Generic)

instance ToJSON SandboxConfig
instance FromJSON SandboxConfig

-- | Default sandbox configuration
defaultConfig :: FilePath -> SandboxConfig
defaultConfig workdir =
    SandboxConfig
        { scRootfs = Nothing
        , scWorkdir = workdir
        , scNetwork = NetworkNone
        , scMounts = []
        , scEnv = []
        , scLimits = defaultLimits
        , scCoeffects = pureCoeffects
        , scSeccomp = True
        , scTmpfsSize = 512 * 1024 * 1024 -- 512MB tmpfs
        }

-- | Sandbox status
data SandboxStatus
    = SandboxRunning
    | -- | Exit code
      SandboxExited Int
    | -- | Signal number
      SandboxKilled Int
    deriving (Eq, Show, Generic)

instance ToJSON SandboxStatus where
    toJSON SandboxRunning = object ["status" .= ("running" :: Text)]
    toJSON (SandboxExited c) = object ["status" .= ("exited" :: Text), "code" .= c]
    toJSON (SandboxKilled s) = object ["status" .= ("killed" :: Text), "signal" .= s]

-- | Runtime state of a sandbox
data SandboxState = SandboxState
    { ssConfig :: SandboxConfig
    , ssPid :: ProcessID
    -- ^ PID of the sandbox init process
    , ssOverlayDir :: FilePath
    -- ^ Path to overlay upperdir (for cleanup)
    , ssStatus :: SandboxStatus
    }
    deriving (Eq, Show)

-- | Public info about a sandbox (for API responses)
data SandboxInfo = SandboxInfo
    { siId :: Text
    , siPid :: Int
    , siStatus :: SandboxStatus
    , siWorkdir :: FilePath
    , siNetwork :: NetworkMode
    , siCoeffects :: Coeffects
    }
    deriving (Eq, Show, Generic)

instance ToJSON SandboxInfo
