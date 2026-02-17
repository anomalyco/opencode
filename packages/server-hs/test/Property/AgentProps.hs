{-# LANGUAGE OverloadedStrings #-}

-- | Agent property tests
module Property.AgentProps where

import Agent.Types
import Data.Aeson (Value (..), decode, encode, object, (.=))
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Text (Text)
import qualified Data.Text as T
import Hedgehog
import qualified Hedgehog.Gen as Gen
import qualified Hedgehog.Range as Range
import Test.Tasty
import Test.Tasty.Hedgehog

-- | Property: PermissionAction JSON round-trip
prop_permissionActionRoundtrip :: Property
prop_permissionActionRoundtrip = property $ do
    action <- forAll genPermissionAction
    let json = encode action
    case decode json of
        Nothing -> failure
        Just action' -> action === action'

-- | Property: PermissionRule JSON round-trip
prop_permissionRuleRoundtrip :: Property
prop_permissionRuleRoundtrip = property $ do
    rule <- forAll genPermissionRule
    let json = encode rule
    case decode json of
        Nothing -> failure
        Just rule' -> rule === rule'

-- | Property: PermissionRuleset JSON round-trip
prop_permissionRulesetRoundtrip :: Property
prop_permissionRulesetRoundtrip = property $ do
    ruleset <- forAll genPermissionRuleset
    let json = encode ruleset
    case decode json of
        Nothing -> failure
        Just ruleset' -> ruleset === ruleset'

-- | Property: AgentMode JSON round-trip
prop_agentModeRoundtrip :: Property
prop_agentModeRoundtrip = property $ do
    mode <- forAll genAgentMode
    let json = encode mode
    case decode json of
        Nothing -> failure
        Just mode' -> mode === mode'

-- | Property: Agent JSON round-trip
prop_agentRoundtrip :: Property
prop_agentRoundtrip = property $ do
    agent <- forAll genAgent
    let json = encode agent
    case decode json of
        Nothing -> failure
        Just agent' -> agent === agent'

-- Generators
genText :: Gen Text
genText = Gen.text (Range.linear 0 100) Gen.alphaNum

genNonEmptyText :: Gen Text
genNonEmptyText = Gen.text (Range.linear 1 100) Gen.alphaNum

genMaybeText :: Gen (Maybe Text)
genMaybeText = Gen.maybe genText

genDouble :: Gen Double
genDouble = Gen.double (Range.linearFrac 0 100)

genMaybeDouble :: Gen (Maybe Double)
genMaybeDouble = Gen.maybe genDouble

genMaybeBool :: Gen (Maybe Bool)
genMaybeBool = Gen.maybe Gen.bool

genPermissionAction :: Gen PermissionAction
genPermissionAction = Gen.element [Allow, Deny, Ask]

genPermissionRule :: Gen PermissionRule
genPermissionRule =
    PermissionRule
        <$> genPermissionAction
        <*> genMaybeText

genPermissionRuleset :: Gen PermissionRuleset
genPermissionRuleset =
    PermissionRuleset . Map.fromList
        <$> Gen.list (Range.linear 0 5) ((,) <$> genText <*> Gen.list (Range.linear 0 3) genPermissionRule)

genAgentMode :: Gen AgentMode
genAgentMode = Gen.element [Subagent, Primary, AllModes]

genAgent :: Gen Agent
genAgent =
    Agent
        <$> genNonEmptyText
        <*> genMaybeText
        <*> genAgentMode
        <*> genMaybeBool
        <*> genMaybeBool
        <*> genMaybeDouble
        <*> genMaybeDouble
        <*> genMaybeText
        <*> genPermissionRuleset
        <*> Gen.maybe ((,) <$> genText <*> genText)
        <*> genMaybeText
        <*> genMaybeText
        <*> pure Map.empty
        <*> Gen.maybe (Gen.int (Range.linear 1 100))

-- Test tree
tests :: TestTree
tests =
    testGroup
        "Agent Property Tests"
        [ testProperty "PermissionAction round-trip" prop_permissionActionRoundtrip
        , testProperty "PermissionRule round-trip" prop_permissionRuleRoundtrip
        , testProperty "PermissionRuleset round-trip" prop_permissionRulesetRoundtrip
        , testProperty "AgentMode round-trip" prop_agentModeRoundtrip
        , testProperty "Agent round-trip" prop_agentRoundtrip
        ]
