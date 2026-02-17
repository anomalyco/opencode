{-# LANGUAGE OverloadedStrings #-}

module Property.LspProps where

import Data.Aeson (Value(..), object, (.=))
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Lsp.Store qualified as LspStore
import Storage.Storage qualified as Storage
import System.Directory (removeDirectoryRecursive)
import System.IO.Temp (createTempDirectory)
import Test.Tasty
import Test.Tasty.Hedgehog

withStore :: (Storage.StorageConfig -> IO a) -> IO a
withStore action = do
  tmpDir <- createTempDirectory "/tmp" "lsp-test"
  result <- Storage.withStorage tmpDir action
  removeDirectoryRecursive tmpDir
  pure result

prop_setGetDiagnostics :: Property
prop_setGetDiagnostics = property $ do
  values <- forAll $ Gen.list (Range.linear 0 5) genValue
  result <- evalIO $ withStore $ \store -> do
    LspStore.setDiagnostics store values
    LspStore.getDiagnostics store
  result === values

genValue :: Gen Value
genValue = do
  line <- Gen.int (Range.linear 1 200)
  pure $ object ["line" .= line]

tests :: TestTree
tests =
  testGroup
    "LSP Property Tests"
    [ testProperty "set/get diagnostics" prop_setGetDiagnostics
    ]
