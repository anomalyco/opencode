{-# LANGUAGE OverloadedStrings #-}

-- | Message property tests
module Property.MessageProps where

import Api (Message (..), MessageInfo (..), SessionTime (..))
import Data.Aeson (Value (..), decode, encode, object, (.=))
import Data.Aeson.Key qualified as Key
import Data.Aeson.KeyMap qualified as KM
import Data.Text (Text)
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Test.Tasty
import Test.Tasty.Hedgehog

-- | Property: MessageInfo JSON round-trip
prop_messageInfoRoundtrip :: Property
prop_messageInfoRoundtrip = property $ do
    msgInfo <- forAll genMessageInfo
    let json = encode msgInfo
    case decode json of
        Nothing -> failure
        Just msgInfo' -> msgInfo === msgInfo'

-- | Property: Message JSON round-trip
prop_messageRoundtrip :: Property
prop_messageRoundtrip = property $ do
    msg <- forAll genMessage
    let json = encode msg
    case decode json of
        Nothing -> failure
        Just msg' -> msg === msg'

-- | Property: Message with empty parts
prop_messageEmptyParts :: Property
prop_messageEmptyParts = property $ do
    msgInfo <- forAll genMessageInfo
    let msg = Message msgInfo []
    let json = encode msg
    case decode json of
        Nothing -> failure
        Just msg' -> msg === msg'

-- | Property: Message with multiple parts
prop_messageMultipleParts :: Property
prop_messageMultipleParts = property $ do
    msgInfo <- forAll genMessageInfo
    parts <- forAll $ Gen.list (Range.linear 1 10) genMessagePart
    let msg = Message msgInfo parts
    let json = encode msg
    case decode json of
        Nothing -> failure
        Just msg' -> msg === msg'

prop_messageJsonKeys :: Property
prop_messageJsonKeys = property $ do
    msg <- forAll genMessage
    let json = encode msg
    case decode json :: Maybe Value of
        Nothing -> failure
        Just (Object obj) -> do
            assert $ KM.member (Key.fromText "info") obj
            assert $ KM.member (Key.fromText "parts") obj
        _ -> failure

-- Generators
genText :: Gen Text
genText = Gen.text (Range.linear 0 100) Gen.alphaNum

genNonEmptyText :: Gen Text
genNonEmptyText = Gen.text (Range.linear 1 100) Gen.alphaNum

genDouble :: Gen Double
genDouble = Gen.double (Range.linearFrac 0 1000000)

genSessionTime :: Gen SessionTime
genSessionTime =
    SessionTime
        <$> genDouble
        <*> genDouble
        <*> Gen.maybe genDouble

genMessageInfo :: Gen MessageInfo
genMessageInfo =
    MessageInfo
        <$> genNonEmptyText
        <*> genNonEmptyText
        <*> genNonEmptyText
        <*> genSessionTime

genMessagePart :: Gen Value
genMessagePart = do
    content <- genText
    Gen.element
        [ object ["type" .= ("text" :: Text), "text" .= content]
        , object ["type" .= ("code" :: Text), "code" .= content]
        , object ["type" .= ("image" :: Text), "url" .= content]
        ]

genMessage :: Gen Message
genMessage =
    Message
        <$> genMessageInfo
        <*> Gen.list (Range.linear 0 5) genMessagePart

-- Test tree
tests :: TestTree
tests =
    testGroup
        "Message Property Tests"
        [ testProperty "MessageInfo round-trip" prop_messageInfoRoundtrip
        , testProperty "Message round-trip" prop_messageRoundtrip
        , testProperty "Message with empty parts" prop_messageEmptyParts
        , testProperty "Message with multiple parts" prop_messageMultipleParts
        , testProperty "Message JSON keys" prop_messageJsonKeys
        ]
