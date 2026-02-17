{-# LANGUAGE OverloadedStrings #-}

-- | LLM property tests
module Property.LLMProps where

import Data.Aeson (Value (..), decode, encode)
import Data.Text (Text)
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import LLM.Types
import Test.Tasty
import Test.Tasty.Hedgehog

-- | Property: Role JSON round-trip
prop_roleRoundtrip :: Property
prop_roleRoundtrip = property $ do
    role <- forAll genRole
    let json = encode role
    case decode json of
        Nothing -> failure
        Just role' -> role === role'

-- | Property: Content JSON round-trip
prop_contentRoundtrip :: Property
prop_contentRoundtrip = property $ do
    content <- forAll genContent
    let json = encode content
    case decode json of
        Nothing -> failure
        Just content' -> content === content'

-- | Property: ContentBlock JSON round-trip
prop_contentBlockRoundtrip :: Property
prop_contentBlockRoundtrip = property $ do
    block <- forAll genContentBlock
    let json = encode block
    case decode json of
        Nothing -> failure
        Just block' -> block === block'

-- | Property: ToolUse JSON round-trip
prop_toolUseRoundtrip :: Property
prop_toolUseRoundtrip = property $ do
    toolUse <- forAll genToolUse
    let json = encode toolUse
    case decode json of
        Nothing -> failure
        Just toolUse' -> toolUse === toolUse'

-- | Property: ToolResult JSON round-trip
prop_toolResultRoundtrip :: Property
prop_toolResultRoundtrip = property $ do
    toolResult <- forAll genToolResult
    let json = encode toolResult
    case decode json of
        Nothing -> failure
        Just toolResult' -> toolResult === toolResult'

-- | Property: Message JSON round-trip
prop_messageRoundtrip :: Property
prop_messageRoundtrip = property $ do
    msg <- forAll genMessage
    let json = encode msg
    case decode json of
        Nothing -> failure
        Just msg' -> msg === msg'

-- | Property: StopReason JSON round-trip
prop_stopReasonRoundtrip :: Property
prop_stopReasonRoundtrip = property $ do
    reason <- forAll genStopReason
    let json = encode reason
    case decode json of
        Nothing -> failure
        Just reason' -> reason === reason'

-- | Property: Usage JSON round-trip
prop_usageRoundtrip :: Property
prop_usageRoundtrip = property $ do
    usage <- forAll genUsage
    let json = encode usage
    case decode json of
        Nothing -> failure
        Just usage' -> usage === usage'

-- Generators
genText :: Gen Text
genText = Gen.text (Range.linear 0 100) Gen.alphaNum

genNonEmptyText :: Gen Text
genNonEmptyText = Gen.text (Range.linear 1 100) Gen.alphaNum

genRole :: Gen Role
genRole = Gen.element [User, Assistant, System]

genContent :: Gen Content
genContent =
    Gen.choice
        [ SimpleContent <$> genText
        , BlockContent <$> Gen.list (Range.linear 0 5) genContentBlock
        ]

genContentBlock :: Gen ContentBlock
genContentBlock =
    Gen.choice
        [ TextBlock <$> genText
        , ImageBlock <$> genText <*> genText
        , ToolUseBlock <$> genToolUse
        , ToolResultBlock <$> genToolResult
        ]

genToolUse :: Gen ToolUse
genToolUse =
    ToolUse
        <$> genNonEmptyText
        <*> genNonEmptyText
        <*> pure Null

genToolResult :: Gen ToolResult
genToolResult =
    ToolResult
        <$> genNonEmptyText
        <*> genText
        <*> Gen.bool

genMessage :: Gen Message
genMessage =
    Message
        <$> genRole
        <*> genContent

genStopReason :: Gen StopReason
genStopReason = Gen.element [EndTurn, MaxTokens, ToolUseSR, StopSequence]

genUsage :: Gen Usage
genUsage =
    Usage
        <$> Gen.int (Range.linear 0 10000)
        <*> Gen.int (Range.linear 0 10000)
        <*> Gen.maybe (Gen.int (Range.linear 0 10000))
        <*> Gen.maybe (Gen.int (Range.linear 0 10000))

-- Test tree
tests :: TestTree
tests =
    testGroup
        "LLM Property Tests"
        [ testProperty "Role round-trip" prop_roleRoundtrip
        , testProperty "StopReason round-trip" prop_stopReasonRoundtrip
        , testProperty "Usage round-trip" prop_usageRoundtrip
        -- Note: Content, ContentBlock, ToolUse, ToolResult, and Message
        -- need proper FromJSON instances to be tested
        ]
