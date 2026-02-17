{-# LANGUAGE OverloadedStrings #-}

module Property.PathProps where

import Data.Text (Text)
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Path.Build qualified as PathBuild
import Api (PathInfo(..))
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

genText :: Gen Text
genText = Gen.text (Range.linear 1 20) Gen.alphaNum

tests :: TestTree
tests =
  testGroup
    "Path Property Tests"
    [ testProperty "build path" prop_buildPath
    ]
