{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

{- | Message type definitions
Mirrors the TypeScript MessageV2 namespace
-}
module Message.Types (
    -- * Message types
    Message (..),
    MessageInfo (..),
    MessageRole (..),
    MessageTime (..),

    -- * Part types
    Part (..),
    PartBase (..),
    TextPart (..),
    ToolPart (..),
    ToolState (..),
    FilePart (..),
    ReasoningPart (..),
    StepStartPart (..),
    StepFinishPart (..),
    SnapshotPart (..),

    -- * Input types
    CreateMessageInput (..),
    TextPartInput (..),
    FilePartInput (..),
) where

import Data.Aeson
import Data.Map.Strict qualified as Map
import Data.Text (Text)
import GHC.Generics (Generic)

-- | Message role
data MessageRole = User | Assistant
    deriving (Show, Eq, Generic)

instance ToJSON MessageRole where
    toJSON User = String "user"
    toJSON Assistant = String "assistant"

instance FromJSON MessageRole where
    parseJSON = withText "MessageRole" $ \case
        "user" -> pure User
        "assistant" -> pure Assistant
        _ -> fail "Invalid message role"

-- | Message time info
data MessageTime = MessageTime
    { mtCreated :: Double
    }
    deriving (Show, Eq, Generic)

instance ToJSON MessageTime where
    toJSON mt = object ["created" .= mtCreated mt]

instance FromJSON MessageTime where
    parseJSON = withObject "MessageTime" $ \v ->
        MessageTime
            <$> v .: "created"

-- | Message info (metadata)
data MessageInfo = MessageInfo
    { miId :: Text
    , miSessionID :: Text
    , miRole :: MessageRole
    , miParentID :: Maybe Text
    , miTime :: MessageTime
    }
    deriving (Show, Eq, Generic)

instance ToJSON MessageInfo where
    toJSON mi =
        object
            [ "id" .= miId mi
            , "sessionID" .= miSessionID mi
            , "role" .= miRole mi
            , "parentID" .= miParentID mi
            , "time" .= miTime mi
            ]

instance FromJSON MessageInfo where
    parseJSON = withObject "MessageInfo" $ \v ->
        MessageInfo
            <$> v .: "id"
            <*> v .: "sessionID"
            <*> v .: "role"
            <*> v .:? "parentID"
            <*> v .: "time"

-- | Base fields for all parts
data PartBase = PartBase
    { pbId :: Text
    , pbSessionID :: Text
    , pbMessageID :: Text
    }
    deriving (Show, Eq, Generic)

-- | Text part
data TextPart = TextPart
    { tpBase :: PartBase
    , tpText :: Text
    , tpSynthetic :: Maybe Bool
    , tpIgnored :: Maybe Bool
    }
    deriving (Show, Eq, Generic)

-- | Tool state
data ToolState
    = ToolPending {tsInput :: Map.Map Text Value, tsRaw :: Text}
    | ToolRunning {tsrInput :: Map.Map Text Value, tsrTitle :: Maybe Text}
    | ToolCompleted {tscInput :: Map.Map Text Value, tscOutput :: Text, tscTitle :: Text}
    | ToolError {tseInput :: Map.Map Text Value, tseError :: Text}
    deriving (Show, Eq, Generic)

instance ToJSON ToolState where
    toJSON (ToolPending inp raw) =
        object
            [ "status" .= String "pending"
            , "input" .= inp
            , "raw" .= raw
            ]
    toJSON (ToolRunning inp title) =
        object
            [ "status" .= String "running"
            , "input" .= inp
            , "title" .= title
            ]
    toJSON (ToolCompleted inp out title) =
        object
            [ "status" .= String "completed"
            , "input" .= inp
            , "output" .= out
            , "title" .= title
            ]
    toJSON (ToolError inp err) =
        object
            [ "status" .= String "error"
            , "input" .= inp
            , "error" .= err
            ]

-- | Tool part
data ToolPart = ToolPart
    { toolBase :: PartBase
    , toolCallID :: Text
    , toolName :: Text
    , toolState :: ToolState
    }
    deriving (Show, Eq, Generic)

-- | File part
data FilePart = FilePart
    { fpBase :: PartBase
    , fpMime :: Text
    , fpFilename :: Maybe Text
    , fpUrl :: Text
    }
    deriving (Show, Eq, Generic)

-- | Reasoning part
data ReasoningPart = ReasoningPart
    { rpBase :: PartBase
    , rpText :: Text
    }
    deriving (Show, Eq, Generic)

-- | Step start part
data StepStartPart = StepStartPart
    { sspBase :: PartBase
    , sspSnapshot :: Maybe Text
    }
    deriving (Show, Eq, Generic)

-- | Step finish part
data StepFinishPart = StepFinishPart
    { sfpBase :: PartBase
    , sfpReason :: Text
    , sfpCost :: Double
    }
    deriving (Show, Eq, Generic)

-- | Snapshot part
data SnapshotPart = SnapshotPart
    { snpBase :: PartBase
    , snpSnapshot :: Text
    }
    deriving (Show, Eq, Generic)

-- | Union of all part types
data Part
    = PartText TextPart
    | PartTool ToolPart
    | PartFile FilePart
    | PartReasoning ReasoningPart
    | PartStepStart StepStartPart
    | PartStepFinish StepFinishPart
    | PartSnapshot SnapshotPart
    deriving (Show, Eq, Generic)

instance ToJSON Part where
    toJSON (PartText tp) =
        object
            [ "type" .= String "text"
            , "id" .= pbId (tpBase tp)
            , "sessionID" .= pbSessionID (tpBase tp)
            , "messageID" .= pbMessageID (tpBase tp)
            , "text" .= tpText tp
            , "synthetic" .= tpSynthetic tp
            , "ignored" .= tpIgnored tp
            ]
    toJSON (PartTool tp) =
        object
            [ "type" .= String "tool"
            , "id" .= pbId (toolBase tp)
            , "sessionID" .= pbSessionID (toolBase tp)
            , "messageID" .= pbMessageID (toolBase tp)
            , "callID" .= toolCallID tp
            , "tool" .= toolName tp
            , "state" .= toolState tp
            ]
    toJSON (PartFile fp) =
        object
            [ "type" .= String "file"
            , "id" .= pbId (fpBase fp)
            , "sessionID" .= pbSessionID (fpBase fp)
            , "messageID" .= pbMessageID (fpBase fp)
            , "mime" .= fpMime fp
            , "filename" .= fpFilename fp
            , "url" .= fpUrl fp
            ]
    toJSON (PartReasoning rp) =
        object
            [ "type" .= String "reasoning"
            , "id" .= pbId (rpBase rp)
            , "sessionID" .= pbSessionID (rpBase rp)
            , "messageID" .= pbMessageID (rpBase rp)
            , "text" .= rpText rp
            ]
    toJSON (PartStepStart ssp) =
        object
            [ "type" .= String "step-start"
            , "id" .= pbId (sspBase ssp)
            , "sessionID" .= pbSessionID (sspBase ssp)
            , "messageID" .= pbMessageID (sspBase ssp)
            , "snapshot" .= sspSnapshot ssp
            ]
    toJSON (PartStepFinish sfp) =
        object
            [ "type" .= String "step-finish"
            , "id" .= pbId (sfpBase sfp)
            , "sessionID" .= pbSessionID (sfpBase sfp)
            , "messageID" .= pbMessageID (sfpBase sfp)
            , "reason" .= sfpReason sfp
            , "cost" .= sfpCost sfp
            ]
    toJSON (PartSnapshot snp) =
        object
            [ "type" .= String "snapshot"
            , "id" .= pbId (snpBase snp)
            , "sessionID" .= pbSessionID (snpBase snp)
            , "messageID" .= pbMessageID (snpBase snp)
            , "snapshot" .= snpSnapshot snp
            ]

-- | Full message with parts
data Message = Message
    { msgInfo :: MessageInfo
    , msgParts :: [Part]
    }
    deriving (Show, Eq, Generic)

instance ToJSON Message where
    toJSON m =
        object
            [ "info" .= msgInfo m
            , "parts" .= msgParts m
            ]

-- | Input for text part
data TextPartInput = TextPartInput
    { tpiType :: Text -- "text"
    , tpiText :: Text
    }
    deriving (Show, Eq, Generic)

instance FromJSON TextPartInput where
    parseJSON = withObject "TextPartInput" $ \v ->
        TextPartInput
            <$> v .: "type"
            <*> v .: "text"

-- | Input for file part
data FilePartInput = FilePartInput
    { fpiType :: Text -- "file"
    , fpiMime :: Text
    , fpiUrl :: Text
    , fpiFilename :: Maybe Text
    }
    deriving (Show, Eq, Generic)

instance FromJSON FilePartInput where
    parseJSON = withObject "FilePartInput" $ \v ->
        FilePartInput
            <$> v .: "type"
            <*> v .: "mime"
            <*> v .: "url"
            <*> v .:? "filename"

-- | Input for creating a message
data CreateMessageInput = CreateMessageInput
    { cmiMessageID :: Maybe Text
    , cmiParts :: [Value] -- Generic parts, validated at runtime
    }
    deriving (Show, Eq, Generic)

instance FromJSON CreateMessageInput where
    parseJSON = withObject "CreateMessageInput" $ \v ->
        CreateMessageInput
            <$> v .:? "messageID"
            <*> v .: "parts"
