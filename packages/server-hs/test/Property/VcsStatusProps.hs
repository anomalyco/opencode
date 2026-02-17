{-# LANGUAGE OverloadedStrings #-}

module Property.VcsStatusProps where

import Data.Text (Text)
import Data.Text qualified as T
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Test.Tasty
import Test.Tasty.Hedgehog
import Vcs.Status qualified as VcsStatus

prop_parseStatusMapping :: Property
prop_parseStatusMapping = property $ do
    status <- forAll genStatus
    path <- forAll genPath
    let line = status <> " " <> path
    let parsed = VcsStatus.parsePorcelain line
    case parsed of
        [s] -> do
            VcsStatus.fsPath s === path
            VcsStatus.fsStatus s === expected status
        _ -> failure
  where
    expected code
        | code == "??" = "untracked"
        | "U" `T.isInfixOf` code = "unmerged"
        | "A" `T.isInfixOf` code = "added"
        | "D" `T.isInfixOf` code = "deleted"
        | "R" `T.isInfixOf` code = "renamed"
        | "C" `T.isInfixOf` code = "copied"
        | "M" `T.isInfixOf` code = "modified"
        | otherwise = "unknown"

prop_parseRenamePath :: Property
prop_parseRenamePath = property $ do
    oldPath <- forAll genPath
    newPath <- forAll genPath
    let line = "R  " <> oldPath <> " -> " <> newPath
    let parsed = VcsStatus.parsePorcelain line
    case parsed of
        [s] -> VcsStatus.fsPath s === newPath
        _ -> failure

genStatus :: Gen Text
genStatus = Gen.element ["??", " M", "M ", "A ", " D", "R ", "C ", "U "]

genPath :: Gen Text
genPath = do
    name <- Gen.text (Range.linear 1 12) Gen.alphaNum
    ext <- Gen.text (Range.linear 1 3) Gen.alphaNum
    pure (name <> "." <> ext)

tests :: TestTree
tests =
    testGroup
        "VCS Status Property Tests"
        [ testProperty "parse status mapping" prop_parseStatusMapping
        , testProperty "parse rename path" prop_parseRenamePath
        ]
