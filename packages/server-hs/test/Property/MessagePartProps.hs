{-# LANGUAGE OverloadedStrings #-}

module Property.MessagePartProps where

import Data.Aeson (Value (..), object, (.=))
import Data.Aeson.KeyMap qualified as KM
import Data.Text (Text)
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Message.Parts qualified as Parts
import Test.Tasty
import Test.Tasty.Hedgehog

prop_updatePart :: Property
prop_updatePart = property $ do
    pid <- forAll genNonEmptyText
    part <- forAll (genPart pid)
    patch <- forAll genPatch
    parts <- forAll $ Gen.list (Range.linear 0 5) genPartAny
    let allParts = part : parts
    case Parts.updatePart pid patch allParts of
        Nothing -> failure
        Just updated -> do
            let mpart = Parts.findPart pid updated
            case mpart of
                Nothing -> failure
                Just value -> do
                    value === mergeExpected part patch

prop_deletePart :: Property
prop_deletePart = property $ do
    pid <- forAll genNonEmptyText
    part <- forAll (genPart pid)
    parts <- forAll $ Gen.list (Range.linear 0 5) genPartAny
    let allParts = part : parts
    case Parts.deletePart pid allParts of
        Nothing -> failure
        Just updated -> do
            Parts.findPart pid updated === Nothing

prop_findPart :: Property
prop_findPart = property $ do
    pid <- forAll genNonEmptyText
    part <- forAll (genPart pid)
    parts <- forAll $ Gen.list (Range.linear 0 5) genPartAny
    let allParts = part : parts
    Parts.findPart pid allParts === Just part

prop_updateMissingPart :: Property
prop_updateMissingPart = property $ do
    pid <- forAll genNonEmptyText
    otherPid <- forAll genNonEmptyText
    part <- forAll (genPart otherPid)
    patch <- forAll genPatch
    Parts.updatePart pid patch [part] === Nothing

prop_deleteMissingPart :: Property
prop_deleteMissingPart = property $ do
    pid <- forAll genNonEmptyText
    otherPid <- forAll genNonEmptyText
    part <- forAll (genPart otherPid)
    Parts.deletePart pid [part] === Nothing

prop_updatePreservesOtherParts :: Property
prop_updatePreservesOtherParts = property $ do
    pid <- forAll genNonEmptyText
    otherPid <- forAll (Gen.filter (/= pid) genNonEmptyText)
    part <- forAll (genPart pid)
    other <- forAll (genPart otherPid)
    patch <- forAll genPatch
    case Parts.updatePart pid patch [part, other] of
        Nothing -> failure
        Just updated -> do
            Parts.findPart otherPid updated === Just other

genText :: Gen Text
genText = Gen.text (Range.linear 0 50) Gen.alphaNum

genNonEmptyText :: Gen Text
genNonEmptyText = Gen.text (Range.linear 1 50) Gen.alphaNum

genPart :: Text -> Gen Value
genPart pid = do
    content <- genText
    pure $ object ["id" .= pid, "type" .= ("text" :: Text), "text" .= content]

genPartAny :: Gen Value
genPartAny = do
    pid <- genNonEmptyText
    genPart pid

genPatch :: Gen Value
genPatch = do
    content <- genNonEmptyText
    pure $ object ["text" .= content]

mergeExpected :: Value -> Value -> Value
mergeExpected (Object old) (Object new) = Object (KM.union new old)
mergeExpected _ new = new

tests :: TestTree
tests =
    testGroup
        "Message Part Property Tests"
        [ testProperty "updatePart merges patch" prop_updatePart
        , testProperty "deletePart removes part" prop_deletePart
        , testProperty "findPart locates part" prop_findPart
        , testProperty "update missing part" prop_updateMissingPart
        , testProperty "delete missing part" prop_deleteMissingPart
        , testProperty "update preserves other parts" prop_updatePreservesOtherParts
        ]
