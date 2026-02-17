{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

{- | Types for the MITM proxy

"Full take" - capture everything, analyze later
-}
module Proxy.Types (
    -- * Log Entry
    LogEntry (..),
    RequestLog (..),
    ResponseLog (..),
    TokenUsage (..),

    -- * Proxy Config
    ProxyConfig (..),
    defaultProxyConfig,

    -- * Proxy State
    ProxyState (..),
) where

import Control.Concurrent.STM (TVar)
import Data.Aeson (FromJSON (..), ToJSON (..), object, withObject, (.:), (.:?), (.=))
import Data.Map.Strict (Map)
import Data.Text (Text)
import Data.Time (UTCTime)
import Data.Word (Word64)
import GHC.Generics (Generic)

-- | A single logged request/response pair
data LogEntry = LogEntry
    { leTimestamp :: UTCTime
    , leSessionId :: Text
    -- ^ Which PTY session made this request
    , leRequestId :: Text
    -- ^ Unique request ID
    , leMethod :: Text
    , leUrl :: Text
    , leHost :: Text
    , leRequest :: RequestLog
    , leResponse :: Maybe ResponseLog
    -- ^ Nothing if request failed
    , leTokens :: Maybe TokenUsage
    -- ^ Parsed from LLM responses
    , leDuration :: Double
    -- ^ Response time in ms
    }
    deriving (Eq, Show, Generic)

instance ToJSON LogEntry where
    toJSON LogEntry{..} =
        object
            [ "ts" .= leTimestamp
            , "session" .= leSessionId
            , "request_id" .= leRequestId
            , "method" .= leMethod
            , "url" .= leUrl
            , "host" .= leHost
            , "request" .= leRequest
            , "response" .= leResponse
            , "tokens" .= leTokens
            , "duration" .= leDuration
            ]

instance FromJSON LogEntry where
    parseJSON = withObject "LogEntry" $ \v ->
        LogEntry
            <$> v .: "ts"
            <*> v .: "session"
            <*> v .: "request_id"
            <*> v .: "method"
            <*> v .: "url"
            <*> v .: "host"
            <*> v .: "request"
            <*> v .:? "response"
            <*> v .:? "tokens"
            <*> v .: "duration"

-- | Logged request details
data RequestLog = RequestLog
    { rlHeaders :: Map Text Text
    , rlBody :: Maybe Text
    -- ^ JSON body if present (truncated if huge)
    , rlSize :: Int
    -- ^ Original body size
    }
    deriving (Eq, Show, Generic)

instance ToJSON RequestLog where
    toJSON RequestLog{..} =
        object
            [ "headers" .= rlHeaders
            , "body" .= rlBody
            , "size" .= rlSize
            ]

instance FromJSON RequestLog where
    parseJSON = withObject "RequestLog" $ \v ->
        RequestLog
            <$> v .: "headers"
            <*> v .:? "body"
            <*> v .: "size"

-- | Logged response details
data ResponseLog = ResponseLog
    { rsStatus :: Int
    , rsHeaders :: Map Text Text
    , rsBody :: Maybe Text
    -- ^ JSON body or SSE events
    , rsSize :: Int
    , rsStream :: Bool
    -- ^ Was this a streaming response?
    }
    deriving (Eq, Show, Generic)

instance ToJSON ResponseLog where
    toJSON ResponseLog{..} =
        object
            [ "status" .= rsStatus
            , "headers" .= rsHeaders
            , "body" .= rsBody
            , "size" .= rsSize
            , "stream" .= rsStream
            ]

instance FromJSON ResponseLog where
    parseJSON = withObject "ResponseLog" $ \v ->
        ResponseLog
            <$> v .: "status"
            <*> v .: "headers"
            <*> v .:? "body"
            <*> v .: "size"
            <*> v .: "stream"

-- | Token usage from LLM API responses
data TokenUsage = TokenUsage
    { tuProvider :: Text
    -- ^ "anthropic", "openai", "openrouter"
    , tuModel :: Text
    , tuInputTokens :: Int
    , tuOutputTokens :: Int
    , tuCacheRead :: Maybe Int
    -- ^ Anthropic cache_read_input_tokens
    , tuCacheWrite :: Maybe Int
    -- ^ Anthropic cache_creation_input_tokens
    }
    deriving (Eq, Show, Generic)

instance ToJSON TokenUsage where
    toJSON TokenUsage{..} =
        object
            [ "provider" .= tuProvider
            , "model" .= tuModel
            , "input_tokens" .= tuInputTokens
            , "output_tokens" .= tuOutputTokens
            , "cache_read" .= tuCacheRead
            , "cache_write" .= tuCacheWrite
            ]

instance FromJSON TokenUsage where
    parseJSON = withObject "TokenUsage" $ \v ->
        TokenUsage
            <$> v .: "provider"
            <*> v .: "model"
            <*> v .: "input_tokens"
            <*> v .: "output_tokens"
            <*> v .:? "cache_read"
            <*> v .:? "cache_write"

-- | Proxy configuration
data ProxyConfig = ProxyConfig
    { pcPort :: Int
    -- ^ Listen port (default 8888)
    , pcLogDir :: FilePath
    -- ^ Directory for JSONL logs
    , pcCaKeyPath :: FilePath
    -- ^ CA private key for MITM
    , pcCaCertPath :: FilePath
    -- ^ CA certificate
    , pcMaxBodyLog :: Int
    -- ^ Max body size to log (default 1MB)
    , pcAllowedHosts :: Maybe [Text]
    -- ^ Nothing = allow all
    }
    deriving (Eq, Show)

defaultProxyConfig :: FilePath -> ProxyConfig
defaultProxyConfig logDir =
    ProxyConfig
        { pcPort = 8888
        , pcLogDir = logDir
        , pcCaKeyPath = logDir <> "/ca.key"
        , pcCaCertPath = logDir <> "/ca.crt"
        , pcMaxBodyLog = 1024 * 1024 -- 1MB
        , pcAllowedHosts = Nothing
        }

-- | Runtime proxy state
data ProxyState = ProxyState
    { psConfig :: ProxyConfig
    , psRequestCount :: TVar Word64
    , psTokenTotals :: TVar (Map Text TokenUsage)
    -- ^ Per-session totals
    }
