{-# LANGUAGE OverloadedStrings #-}

module Property.TuiProps where

import Data.Aeson (object, (.=))
import Data.Text (Text)
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Storage.Storage qualified as Storage
import System.Directory (removeDirectoryRecursive)
import System.IO.Temp (createTempDirectory)
import Test.Tasty
import Test.Tasty.Hedgehog
import Tui.Store qualified as TuiStore

withStore :: (Storage.StorageConfig -> IO a) -> IO a
withStore action = do
    tmpDir <- createTempDirectory "/tmp" "tui-test"
    result <- Storage.withStorage tmpDir action
    removeDirectoryRecursive tmpDir
    pure result

prop_appendPrompt :: Property
prop_appendPrompt = property $ do
    a <- forAll genText
    b <- forAll genText
    result <- evalIO $ withStore $ \store -> do
        _ <- TuiStore.appendPrompt store a
        TuiStore.appendPrompt store b
    result === (a <> b)

prop_clearPrompt :: Property
prop_clearPrompt = property $ do
    text <- forAll genText
    result <- evalIO $ withStore $ \store -> do
        _ <- TuiStore.appendPrompt store text
        TuiStore.clearPrompt store
        TuiStore.getPrompt store
    result === ""

prop_submitPrompt :: Property
prop_submitPrompt = property $ do
    text <- forAll genText
    (submitted, remaining) <- evalIO $ withStore $ \store -> do
        _ <- TuiStore.appendPrompt store text
        submitted <- TuiStore.submitPrompt store
        remaining <- TuiStore.getPrompt store
        pure (submitted, remaining)
    submitted === text
    remaining === ""

prop_submitStoresLast :: Property
prop_submitStoresLast = property $ do
    text <- forAll genText
    result <- evalIO $ withStore $ \store -> do
        _ <- TuiStore.appendPrompt store text
        _ <- TuiStore.submitPrompt store
        Storage.read store ["tui", "submitted"]
    result === object ["prompt" .= text]

prop_setLastRoundtrip :: Property
prop_setLastRoundtrip = property $ do
    key <- forAll genText
    val <- forAll genText
    result <- evalIO $ withStore $ \store -> do
        let payload = object ["key" .= key, "value" .= val]
        TuiStore.setLast store payload
        TuiStore.getLast store
    result === Just (object ["key" .= key, "value" .= val])

genText :: Gen Text
genText = Gen.text (Range.linear 0 50) Gen.alphaNum

tests :: TestTree
tests =
    testGroup
        "TUI Property Tests"
        [ testProperty "append prompt" prop_appendPrompt
        , testProperty "clear prompt" prop_clearPrompt
        , testProperty "submit prompt" prop_submitPrompt
        , testProperty "set/get last" prop_setLastRoundtrip
        , testProperty "submit stores last" prop_submitStoresLast
        ]
