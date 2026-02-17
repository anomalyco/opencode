{-# LANGUAGE OverloadedStrings #-}

module Prompt.Async (
    PromptAsyncJob (..),
    promptAsyncKey,
    promptAsyncIndexKey,
    queuedPayload,
    startedPayload,
    completedPayload,
    failedPayload,
) where

import Data.Aeson (Value, object, (.=))
import Data.Text (Text)

import Api (CreateMessageInput (..))

data PromptAsyncJob = PromptAsyncJob
    { pajRequestId :: Text
    , pajSessionId :: Text
    , pajInput :: CreateMessageInput
    }

promptAsyncKey :: Text -> Text -> [Text]
promptAsyncKey sid reqId = ["prompt_async", sid, reqId]

promptAsyncIndexKey :: Text -> [Text]
promptAsyncIndexKey sid = ["prompt_async", sid, "index"]

queuedPayload :: Text -> Text -> CreateMessageInput -> Value
queuedPayload sid reqId input =
    object
        [ "requestID" .= reqId
        , "sessionID" .= sid
        , "status" .= ("queued" :: Text)
        , "parts" .= cmiParts input
        ]

startedPayload :: Text -> Text -> Value
startedPayload sid reqId =
    object
        [ "requestID" .= reqId
        , "sessionID" .= sid
        , "status" .= ("started" :: Text)
        ]

completedPayload :: Text -> Text -> Text -> Value
completedPayload sid reqId msgId =
    object
        [ "requestID" .= reqId
        , "sessionID" .= sid
        , "status" .= ("completed" :: Text)
        , "messageID" .= msgId
        ]

failedPayload :: Text -> Text -> Text -> Value
failedPayload sid reqId err =
    object
        [ "requestID" .= reqId
        , "sessionID" .= sid
        , "status" .= ("failed" :: Text)
        , "error" .= err
        ]
