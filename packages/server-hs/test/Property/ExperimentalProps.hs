{-# LANGUAGE OverloadedStrings #-}

module Property.ExperimentalProps where

import Data.Aeson (Value (..), object, (.=))
import Data.Aeson.Key qualified as K
import Data.Aeson.KeyMap qualified as KM
import Data.Text (Text)
import Experimental.Worktree qualified as Worktree
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Storage.Storage qualified as Storage
import System.Directory (removeDirectoryRecursive)
import System.IO.Temp (createTempDirectory)
import Test.Tasty
import Test.Tasty.Hedgehog

withStore :: (Storage.StorageConfig -> IO a) -> IO a
withStore action = do
    tmpDir <- createTempDirectory "/tmp" "experimental-test"
    result <- Storage.withStorage tmpDir action
    removeDirectoryRecursive tmpDir
    pure result

prop_worktreeSetGet :: Property
prop_worktreeSetGet = property $ do
    root <- forAll genText
    value <- forAll genValue
    result <- evalIO $ withStore $ \store -> do
        _ <- Worktree.setInfo store value
        Worktree.getInfo store root
    result === value

prop_worktreeReset :: Property
prop_worktreeReset = property $ do
    root <- forAll genText
    result <- evalIO $ withStore $ \store -> Worktree.resetInfo store root
    case result of
        Object obj -> case KM.lookup (K.fromText "root") obj of
            Just (String value) -> value === root
            _ -> failure
        _ -> failure

genText :: Gen Text
genText = Gen.text (Range.linear 1 20) Gen.alphaNum

genValue :: Gen Value
genValue = do
    text <- genText
    pure $ object ["root" .= text, "ready" .= True]

tests :: TestTree
tests =
    testGroup
        "Experimental Property Tests"
        [ testProperty "worktree set/get" prop_worktreeSetGet
        , testProperty "worktree reset" prop_worktreeReset
        ]
