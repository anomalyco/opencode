{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

-- | PTY types for sandboxed shell sessions
module Pty.Types (
    -- * PTY Info
    PtyInfo (..),
    PtyStatus (..),

    -- * PTY Input
    CreatePtyInput (..),
    UpdatePtyInput (..),
    ResizeInput (..),

    -- * PTY State
    PtyBuffer (..),
    emptyBuffer,

    -- * Constants
    bufferLimit,
    bufferChunk,
) where

import Data.Aeson
import Data.ByteString (ByteString)
import Data.Text (Text)
import Data.Word (Word64)
import GHC.Generics (Generic)

-- | PTY status
data PtyStatus
    = PtyRunning
    | PtyExited Int
    deriving (Eq, Show, Generic)

instance ToJSON PtyStatus where
    toJSON PtyRunning = "running"
    toJSON (PtyExited c) = object ["exited" .= c]

-- | Public PTY info (for API responses)
data PtyInfo = PtyInfo
    { piId :: Text
    , piTitle :: Text
    , piCommand :: Text
    , piArgs :: [Text]
    , piCwd :: Text
    , piStatus :: PtyStatus
    , piPid :: Int
    , piSandbox :: Bool
    -- ^ Is this a sandboxed PTY?
    }
    deriving (Eq, Show, Generic)

instance ToJSON PtyInfo where
    toJSON PtyInfo{..} =
        object
            [ "id" .= piId
            , "title" .= piTitle
            , "command" .= piCommand
            , "args" .= piArgs
            , "cwd" .= piCwd
            , "status" .= piStatus
            , "pid" .= piPid
            , "sandbox" .= piSandbox
            ]

-- | Input for creating a new PTY
data CreatePtyInput = CreatePtyInput
    { cpiCommand :: Maybe Text
    -- ^ Command (default: shell)
    , cpiArgs :: Maybe [Text]
    -- ^ Arguments
    , cpiCwd :: Maybe Text
    -- ^ Working directory
    , cpiTitle :: Maybe Text
    -- ^ Display title
    , cpiEnv :: Maybe [(Text, Text)]
    -- ^ Environment variables
    , cpiSandbox :: Maybe Bool
    -- ^ Enable sandboxing (default: true)
    , cpiNetwork :: Maybe Bool
    -- ^ Allow network in sandbox (default: false)
    , cpiMounts :: Maybe [(Text, Text, Bool)]
    -- ^ (src, dest, readonly)
    , cpiSessionId :: Maybe Text
    -- ^ Session ID for proxy correlation
    }
    deriving (Eq, Show, Generic)

instance FromJSON CreatePtyInput where
    parseJSON = withObject "CreatePtyInput" $ \v ->
        CreatePtyInput
            <$> v .:? "command"
            <*> v .:? "args"
            <*> v .:? "cwd"
            <*> v .:? "title"
            <*> v .:? "env"
            <*> v .:? "sandbox"
            <*> v .:? "network"
            <*> v .:? "mounts"
            <*> v .:? "sessionId"

-- | Input for updating a PTY
data UpdatePtyInput = UpdatePtyInput
    { upiTitle :: Maybe Text
    , upiSize :: Maybe ResizeInput
    }
    deriving (Eq, Show, Generic)

instance FromJSON UpdatePtyInput where
    parseJSON = withObject "UpdatePtyInput" $ \v ->
        UpdatePtyInput
            <$> v .:? "title"
            <*> v .:? "size"

-- | Terminal resize input
data ResizeInput = ResizeInput
    { riRows :: Int
    , riCols :: Int
    }
    deriving (Eq, Show, Generic)

instance FromJSON ResizeInput where
    parseJSON = withObject "ResizeInput" $ \v ->
        ResizeInput
            <$> v .: "rows"
            <*> v .: "cols"

-- | Output buffer with cursor tracking (for reconnection replay)
data PtyBuffer = PtyBuffer
    { pbData :: ByteString
    -- ^ Circular buffer content
    , pbCursor :: Word64
    -- ^ Global cursor (total bytes written)
    , pbBufferCursor :: Word64
    -- ^ Start cursor of current buffer window
    }
    deriving (Eq, Show)

-- | Empty buffer
emptyBuffer :: PtyBuffer
emptyBuffer =
    PtyBuffer
        { pbData = mempty
        , pbCursor = 0
        , pbBufferCursor = 0
        }

-- | Buffer size limit (2MB)
bufferLimit :: Int
bufferLimit = 2 * 1024 * 1024

-- | Chunk size for sending data
bufferChunk :: Int
bufferChunk = 64 * 1024
