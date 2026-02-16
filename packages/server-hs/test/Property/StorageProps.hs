{-# LANGUAGE OverloadedStrings #-}

-- | Storage property tests
module Property.StorageProps where

import Control.Exception (catch)
import Data.Aeson (Value, object, (.=))
import Data.Text (Text)
import Data.Text qualified as T
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Session.Types
import Storage.Storage qualified as Storage
import System.Directory (removeDirectoryRecursive)
import System.IO.Temp (createTempDirectory)
import Test.Tasty
import Test.Tasty.Hedgehog

-- | Property: write then read returns the same value
prop_writeReadIdentity :: Property
prop_writeReadIdentity = property $ do
  keyParts <- forAll $ Gen.list (Range.linear 1 5) genKeyPart
  val <- forAll genTestValue

  result <- evalIO $ withTempStorage $ \storage -> do
    Storage.write storage keyParts val
    Storage.read storage keyParts

  val === result
  where
    genKeyPart = Gen.text (Range.linear 1 20) Gen.alphaNum
    genTestValue = Gen.text (Range.linear 0 100) Gen.alphaNum

-- | Property: update modifies the value correctly
prop_updateModifies :: Property
prop_updateModifies = property $ do
  keyParts <- forAll $ Gen.list (Range.linear 1 3) genKeyPart
  initial <- forAll genTestValue
  newContent <- forAll genTestValue

  result <- evalIO $ withTempStorage $ \storage -> do
    Storage.write storage keyParts initial
    Storage.update storage keyParts (\_ -> newContent)

  result === newContent
  where
    genKeyPart = Gen.text (Range.linear 1 20) Gen.alphaNum
    genTestValue = Gen.text (Range.linear 0 100) Gen.alphaNum

-- | Property: list returns keys with the given prefix
prop_listWithPrefix :: Property
prop_listWithPrefix = property $ do
  prefix <- forAll $ Gen.text (Range.linear 1 10) Gen.alphaNum
  count <- forAll $ Gen.int (Range.linear 1 10)

  keys <- evalIO $ withTempStorage $ \storage -> do
    -- Write multiple values with the same prefix
    mapM_
      ( \i -> do
          let key = [prefix, T.pack (show i)]
          Storage.write storage key (object ["index" .= i])
      )
      [1 .. count]
    -- List all keys with prefix
    Storage.list storage [prefix]

  -- Should find all the keys we created
  length keys === count

-- | Property: remove deletes the value
prop_removeDeletes :: Property
prop_removeDeletes = property $ do
  keyParts <- forAll $ Gen.list (Range.linear 1 3) genKeyPart
  val <- forAll genTestValue

  (foundBefore, foundAfter) <- evalIO $ withTempStorage $ \storage -> do
    Storage.write storage keyParts (val :: Text)
    before <-
      (Just <$> Storage.read storage keyParts)
        `catch` \(Storage.NotFoundError _) -> pure Nothing
    Storage.remove storage keyParts
    after <-
      (Just <$> Storage.read storage keyParts)
        `catch` \(Storage.NotFoundError _) -> pure Nothing
    pure (before :: Maybe Text, after :: Maybe Text)

  -- Value should exist before removal
  assert $ foundBefore /= Nothing
  -- Value should not exist after removal
  foundAfter === Nothing
  where
    genKeyPart = Gen.text (Range.linear 1 20) Gen.alphaNum
    genTestValue = Gen.text (Range.linear 0 100) Gen.alphaNum

-- Helper functions

withTempStorage :: (Storage.StorageConfig -> IO a) -> IO a
withTempStorage action = do
  tmpDir <- createTempDirectory "/tmp" "storage-test"
  result <- Storage.withStorage tmpDir action
  removeDirectoryRecursive tmpDir
  pure result

-- Test tree
tests :: TestTree
tests =
  testGroup
    "Storage Property Tests"
    [ testProperty "write/read identity" prop_writeReadIdentity,
      testProperty "update modifies value" prop_updateModifies,
      testProperty "list with prefix" prop_listWithPrefix,
      testProperty "remove deletes value" prop_removeDeletes
    ]
