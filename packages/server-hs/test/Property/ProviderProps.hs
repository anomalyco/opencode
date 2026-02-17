{-# LANGUAGE OverloadedStrings #-}

-- | Provider property tests
module Property.ProviderProps where

import Data.Aeson (Value (..), decode, encode, object, (.=))
import Data.Map.Strict (Map)
import qualified Data.Map.Strict as Map
import Data.Text (Text)
import qualified Data.Text as T
import Hedgehog
import qualified Hedgehog.Gen as Gen
import qualified Hedgehog.Range as Range
import Provider.Types
import Provider.Provider qualified as Provider
import Storage.Storage qualified as Storage
import System.IO.Temp (createTempDirectory)
import System.Directory (removeDirectoryRecursive)
import Test.Tasty
import Test.Tasty.Hedgehog

-- | Property: ModelCost JSON round-trip
prop_modelCostRoundtrip :: Property
prop_modelCostRoundtrip = property $ do
  cost <- forAll genModelCost
  let json = encode cost
  case decode json of
    Nothing -> failure
    Just cost' -> cost === cost'

-- | Property: Model JSON round-trip
prop_modelRoundtrip :: Property
prop_modelRoundtrip = property $ do
  model <- forAll genModel
  let json = encode model
  case decode json of
    Nothing -> failure
    Just model' -> model === model'

-- | Property: AuthMethod JSON round-trip
prop_authMethodRoundtrip :: Property
prop_authMethodRoundtrip = property $ do
  auth <- forAll genAuthMethod
  let json = encode auth
  case decode json of
    Nothing -> failure
    Just auth' -> auth === auth'

-- | Property: ProviderAuth JSON round-trip
prop_providerAuthRoundtrip :: Property
prop_providerAuthRoundtrip = property $ do
  pa <- forAll genProviderAuth
  let json = encode pa
  case decode json of
    Nothing -> failure
    Just pa' -> pa === pa'

prop_authPersistence :: Property
prop_authPersistence = property $ do
  token <- forAll genNonEmptyText
  result <- evalIO $ do
    tmpDir <- createTempDirectory "/tmp" "provider-auth"
    Storage.withStorage tmpDir $ \storage -> do
      Provider.setAuth storage "openai" token
      auths <- Provider.authStatus storage
      Provider.removeAuth storage "openai"
      authsAfter <- Provider.authStatus storage
      removeDirectoryRecursive tmpDir
      pure (auths, authsAfter)
  let (before, after) = result
  assert $ any (\a -> paProviderID a == "openai" && paAuthenticated a) before
  assert $ any (\a -> paProviderID a == "openai" && not (paAuthenticated a)) after

-- Generators
genText :: Gen Text
genText = Gen.text (Range.linear 0 100) Gen.alphaNum

genNonEmptyText :: Gen Text
genNonEmptyText = Gen.text (Range.linear 1 100) Gen.alphaNum

genDouble :: Gen Double
genDouble = Gen.double (Range.linearFrac 0 1000)

genMaybeDouble :: Gen (Maybe Double)
genMaybeDouble = Gen.maybe genDouble

genModelCost :: Gen ModelCost
genModelCost =
  ModelCost
    <$> genDouble
    <*> genDouble
    <*> genMaybeDouble
    <*> genMaybeDouble

genModel :: Gen Model
genModel =
  Model
    <$> genNonEmptyText
    <*> genText
    <*> genNonEmptyText
    <*> Gen.maybe (Gen.int (Range.linear 0 100000))
    <*> Gen.maybe (Gen.int (Range.linear 0 100000))
    <*> genModelCost
    <*> pure Map.empty
    <*> Gen.maybe (Gen.list (Range.linear 0 3) genNonEmptyText)
    <*> Gen.maybe (pure Map.empty)

genAuthMethod :: Gen AuthMethod
genAuthMethod =
  AuthMethod
    <$> genNonEmptyText
    <*> Gen.list (Range.linear 0 3) genNonEmptyText
    <*> Gen.maybe genNonEmptyText

genProviderAuth :: Gen ProviderAuth
genProviderAuth =
  ProviderAuth
    <$> genNonEmptyText
    <*> Gen.bool
    <*> Gen.maybe genNonEmptyText

-- Test tree
tests :: TestTree
tests =
  testGroup
    "Provider Property Tests"
    [ testProperty "ModelCost round-trip" prop_modelCostRoundtrip,
      testProperty "Model round-trip" prop_modelRoundtrip,
      testProperty "AuthMethod round-trip" prop_authMethodRoundtrip,
      testProperty "ProviderAuth round-trip" prop_providerAuthRoundtrip,
      testProperty "Auth persistence" prop_authPersistence
    ]
