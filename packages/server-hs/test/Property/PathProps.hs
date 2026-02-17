{-# LANGUAGE OverloadedStrings #-}

module Property.PathProps where

import Api (PathInfo (..))
import Data.Aeson (decode, encode)
import Data.Text (Text)
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Path.Build qualified as PathBuild
import Test.Tasty
import Test.Tasty.Hedgehog

prop_buildPath :: Property
prop_buildPath = property $ do
    home <- forAll genText
    state <- forAll genText
    config <- forAll genText
    worktree <- forAll genText
    directory <- forAll genText
    let PathInfo h s c w d = PathBuild.buildPath home state config worktree directory
    h === home
    s === state
    c === config
    w === worktree
    d === directory

prop_pathJsonRoundtrip :: Property
prop_pathJsonRoundtrip = property $ do
    home <- forAll genText
    state <- forAll genText
    config <- forAll genText
    worktree <- forAll genText
    directory <- forAll genText
    let info = PathBuild.buildPath home state config worktree directory
    case decode (encode info) of
        Nothing -> failure
        Just info' -> info' === info

genText :: Gen Text
genText = Gen.text (Range.linear 1 20) Gen.alphaNum

tests :: TestTree
tests =
    testGroup
        "Path Property Tests"
        [ testProperty "build path" prop_buildPath
        , testProperty "path JSON roundtrip" prop_pathJsonRoundtrip
        ]
