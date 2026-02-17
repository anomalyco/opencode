{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

-- | LLM API types
module LLM.Types (
    -- * Messages
    Message (..),
    Role (..),
    Content (..),
    ContentBlock (..),
    ToolUse (..),
    ToolResult (..),

    -- * Request/Response
    ChatRequest (..),
    ChatResponse (..),
    Usage (..),
    StopReason (..),

    -- * Streaming
    StreamEvent (..),
)
where

import Data.Aeson
import Data.Text (Text)
import GHC.Generics (Generic)

-- | Message role
data Role = User | Assistant | System
    deriving (Eq, Show, Generic)

instance ToJSON Role where
    toJSON User = "user"
    toJSON Assistant = "assistant"
    toJSON System = "system"

instance FromJSON Role where
    parseJSON = withText "Role" $ \case
        "user" -> pure User
        "assistant" -> pure Assistant
        "system" -> pure System
        _ -> fail "Unknown role"

-- | Content block types
data ContentBlock
    = TextBlock Text
    | ImageBlock Text Text -- media_type, base64 data
    | ToolUseBlock ToolUse
    | ToolResultBlock ToolResult
    deriving (Eq, Show, Generic)

instance ToJSON ContentBlock where
    toJSON (TextBlock t) = object ["type" .= ("text" :: Text), "text" .= t]
    toJSON (ImageBlock mediaType b64) =
        object
            [ "type" .= ("image" :: Text)
            , "source"
                .= object
                    [ "type" .= ("base64" :: Text)
                    , "media_type" .= mediaType
                    , "data" .= b64
                    ]
            ]
    toJSON (ToolUseBlock tu) =
        object
            [ "type" .= ("tool_use" :: Text)
            , "id" .= tuId tu
            , "name" .= tuName tu
            , "input" .= tuInput tu
            ]
    toJSON (ToolResultBlock tr) =
        object
            [ "type" .= ("tool_result" :: Text)
            , "tool_use_id" .= trToolUseId tr
            , "content" .= trContent tr
            , "is_error" .= trIsError tr
            ]

instance FromJSON ContentBlock where
    parseJSON = withObject "ContentBlock" $ \v -> do
        typ <- v .: "type"
        case typ :: Text of
            "text" -> TextBlock <$> v .: "text"
            "image" -> do
                source <- v .: "source"
                mediaType <- source .: "media_type"
                b64 <- source .: "data"
                pure $ ImageBlock mediaType b64
            "tool_use" -> ToolUseBlock <$> parseJSON (Object v)
            "tool_result" -> ToolResultBlock <$> parseJSON (Object v)
            _ -> fail "Unknown content block type"

-- | Tool use request from assistant
data ToolUse = ToolUse
    { tuId :: Text
    , tuName :: Text
    , tuInput :: Value
    }
    deriving (Eq, Show, Generic)

instance ToJSON ToolUse where
    toJSON ToolUse{..} =
        object
            [ "id" .= tuId
            , "name" .= tuName
            , "input" .= tuInput
            ]

instance FromJSON ToolUse where
    parseJSON = withObject "ToolUse" $ \v ->
        ToolUse
            <$> v .: "id"
            <*> v .: "name"
            <*> v .: "input"

-- | Tool result from user
data ToolResult = ToolResult
    { trToolUseId :: Text
    , trContent :: Text
    , trIsError :: Bool
    }
    deriving (Eq, Show, Generic)

instance ToJSON ToolResult where
    toJSON ToolResult{..} =
        object
            [ "tool_use_id" .= trToolUseId
            , "content" .= trContent
            , "is_error" .= trIsError
            ]

instance FromJSON ToolResult where
    parseJSON = withObject "ToolResult" $ \v ->
        ToolResult
            <$> v .: "tool_use_id"
            <*> v .: "content"
            <*> v .:? "is_error" .!= False

-- | Message content - can be string or blocks
data Content
    = SimpleContent Text
    | BlockContent [ContentBlock]
    deriving (Eq, Show, Generic)

instance ToJSON Content where
    toJSON (SimpleContent t) = toJSON t
    toJSON (BlockContent bs) = toJSON bs

instance FromJSON Content where
    parseJSON (String t) = pure $ SimpleContent t
    parseJSON (Array a) = BlockContent <$> mapM parseJSON (toList a)
      where
        toList = foldr (:) []
    parseJSON _ = fail "Content must be string or array"

-- | A chat message
data Message = Message
    { msgRole :: Role
    , msgContent :: Content
    }
    deriving (Eq, Show, Generic)

instance ToJSON Message where
    toJSON Message{..} =
        object
            [ "role" .= msgRole
            , "content" .= msgContent
            ]

instance FromJSON Message where
    parseJSON = withObject "Message" $ \v ->
        Message
            <$> v .: "role"
            <*> v .: "content"

-- | Chat completion request
data ChatRequest = ChatRequest
    { crModel :: Text
    , crMessages :: [Message]
    , crMaxTokens :: Int
    , crSystem :: Maybe Text
    , crTemperature :: Maybe Double
    , crTools :: Maybe [Value] -- Tool definitions
    , crStream :: Bool
    }
    deriving (Eq, Show, Generic)

instance ToJSON ChatRequest where
    toJSON ChatRequest{..} =
        object $
            filter
                ((/= Null) . snd)
                [ "model" .= crModel
                , "messages" .= crMessages
                , "max_tokens" .= crMaxTokens
                , "system" .= crSystem
                , "temperature" .= crTemperature
                , "tools" .= crTools
                , "stream" .= crStream
                ]

-- | Stop reason
data StopReason = EndTurn | MaxTokens | ToolUseSR | StopSequence
    deriving (Eq, Show, Generic)

instance FromJSON StopReason where
    parseJSON = withText "StopReason" $ \case
        "end_turn" -> pure EndTurn
        "max_tokens" -> pure MaxTokens
        "tool_use" -> pure ToolUseSR
        "stop_sequence" -> pure StopSequence
        _ -> pure EndTurn

instance ToJSON StopReason where
    toJSON EndTurn = "end_turn"
    toJSON MaxTokens = "max_tokens"
    toJSON ToolUseSR = "tool_use"
    toJSON StopSequence = "stop_sequence"

-- | Token usage
data Usage = Usage
    { usageInputTokens :: Int
    , usageOutputTokens :: Int
    , usageCacheRead :: Maybe Int
    , usageCacheWrite :: Maybe Int
    }
    deriving (Eq, Show, Generic)

instance FromJSON Usage where
    parseJSON = withObject "Usage" $ \v ->
        Usage
            <$> v .: "input_tokens"
            <*> v .: "output_tokens"
            <*> v .:? "cache_read_input_tokens"
            <*> v .:? "cache_creation_input_tokens"

instance ToJSON Usage where
    toJSON Usage{..} =
        object
            [ "input_tokens" .= usageInputTokens
            , "output_tokens" .= usageOutputTokens
            , "cache_read_input_tokens" .= usageCacheRead
            , "cache_creation_input_tokens" .= usageCacheWrite
            ]

-- | Chat completion response
data ChatResponse = ChatResponse
    { respId :: Text
    , respModel :: Text
    , respRole :: Role
    , respContent :: [ContentBlock]
    , respStopReason :: Maybe StopReason
    , respUsage :: Usage
    }
    deriving (Eq, Show, Generic)

instance FromJSON ChatResponse where
    parseJSON = withObject "ChatResponse" $ \v ->
        ChatResponse
            <$> v .: "id"
            <*> v .: "model"
            <*> v .: "role"
            <*> v .: "content"
            <*> v .:? "stop_reason"
            <*> v .: "usage"

-- | Streaming event types
data StreamEvent
    = MessageStart ChatResponse
    | ContentBlockStart Int ContentBlock
    | ContentBlockDelta Int Text -- index, delta text
    | ContentBlockStop Int
    | MessageDelta StopReason Usage
    | MessageStop
    | Ping
    deriving (Eq, Show, Generic)
