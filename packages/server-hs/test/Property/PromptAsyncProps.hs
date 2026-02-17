{-# LANGUAGE OverloadedStrings #-}

module Property.PromptAsyncProps where

import Api (CreateMessageInput (..))
import Data.Aeson (Value (..), object, (.=))
import Data.Aeson.Key qualified as Key
import Data.Aeson.KeyMap qualified as KM
import Data.Text (Text)
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Prompt.Async qualified as PromptAsync
import Test.Tasty
import Test.Tasty.Hedgehog

prop_promptAsyncKey :: Property
prop_promptAsyncKey = property $ do
    sid <- forAll genNonEmptyText
    reqId <- forAll genNonEmptyText
    PromptAsync.promptAsyncKey sid reqId === ["prompt_async", sid, reqId]

prop_queuedPayloadFields :: Property
prop_queuedPayloadFields = property $ do
    sid <- forAll genNonEmptyText
    reqId <- forAll genNonEmptyText
    parts <- forAll $ Gen.list (Range.linear 0 5) genPart
    let payload = PromptAsync.queuedPayload sid reqId (CreateMessageInput Nothing parts)
    case payload of
        Object obj -> do
            lookupText "requestID" obj === Just reqId
            lookupText "sessionID" obj === Just sid
            lookupText "status" obj === Just "queued"
        _ -> failure

prop_completedPayloadIncludesMessage :: Property
prop_completedPayloadIncludesMessage = property $ do
    sid <- forAll genNonEmptyText
    reqId <- forAll genNonEmptyText
    msgId <- forAll genNonEmptyText
    let payload = PromptAsync.completedPayload sid reqId msgId
    case payload of
        Object obj -> do
            lookupText "requestID" obj === Just reqId
            lookupText "sessionID" obj === Just sid
            lookupText "status" obj === Just "completed"
            lookupText "messageID" obj === Just msgId
        _ -> failure

prop_startedPayloadFields :: Property
prop_startedPayloadFields = property $ do
    sid <- forAll genNonEmptyText
    reqId <- forAll genNonEmptyText
    let payload = PromptAsync.startedPayload sid reqId
    case payload of
        Object obj -> do
            lookupText "requestID" obj === Just reqId
            lookupText "sessionID" obj === Just sid
            lookupText "status" obj === Just "started"
        _ -> failure

prop_failedPayloadIncludesError :: Property
prop_failedPayloadIncludesError = property $ do
    sid <- forAll genNonEmptyText
    reqId <- forAll genNonEmptyText
    err <- forAll genNonEmptyText
    let payload = PromptAsync.failedPayload sid reqId err
    case payload of
        Object obj -> do
            lookupText "requestID" obj === Just reqId
            lookupText "sessionID" obj === Just sid
            lookupText "status" obj === Just "failed"
            lookupText "error" obj === Just err
        _ -> failure

prop_statusValuesValid :: Property
prop_statusValuesValid = property $ do
    sid <- forAll genNonEmptyText
    reqId <- forAll genNonEmptyText
    msgId <- forAll genNonEmptyText
    err <- forAll genNonEmptyText
    let payloads =
            [ PromptAsync.queuedPayload sid reqId (CreateMessageInput Nothing [])
            , PromptAsync.startedPayload sid reqId
            , PromptAsync.completedPayload sid reqId msgId
            , PromptAsync.failedPayload sid reqId err
            ]
    let statuses = map extractStatus payloads
    assert $ all (\s -> s `elem` ["queued", "started", "completed", "failed"]) statuses
  where
    extractStatus = promptStatus

prop_lifecycleOrder :: Property
prop_lifecycleOrder = property $ do
    sid <- forAll genNonEmptyText
    reqId <- forAll genNonEmptyText
    msgId <- forAll genNonEmptyText
    let payloads =
            [ PromptAsync.queuedPayload sid reqId (CreateMessageInput Nothing [])
            , PromptAsync.startedPayload sid reqId
            , PromptAsync.completedPayload sid reqId msgId
            ]
    let statuses = map promptStatus payloads
    statuses === ["queued", "started", "completed"]

promptStatus :: Value -> Text
promptStatus payload = case payload of
    Object obj -> case lookupText "status" obj of
        Just txt -> txt
        Nothing -> ""
    _ -> ""

lookupText :: Text -> KM.KeyMap Value -> Maybe Text
lookupText key obj = case KM.lookup (Key.fromText key) obj of
    Just (String txt) -> Just txt
    _ -> Nothing

genPart :: Gen Value
genPart = do
    content <- Gen.text (Range.linear 0 20) Gen.alphaNum
    Gen.element
        [ object ["type" .= ("text" :: Text), "text" .= content]
        , object ["type" .= ("code" :: Text), "code" .= content]
        ]

genNonEmptyText :: Gen Text
genNonEmptyText = Gen.text (Range.linear 1 30) Gen.alphaNum

tests :: TestTree
tests =
    testGroup
        "Prompt Async Property Tests"
        [ testProperty "key includes session/request" prop_promptAsyncKey
        , testProperty "queued payload fields" prop_queuedPayloadFields
        , testProperty "completed payload includes message" prop_completedPayloadIncludesMessage
        , testProperty "started payload fields" prop_startedPayloadFields
        , testProperty "failed payload includes error" prop_failedPayloadIncludesError
        , testProperty "status values valid" prop_statusValuesValid
        , testProperty "lifecycle order" prop_lifecycleOrder
        ]
