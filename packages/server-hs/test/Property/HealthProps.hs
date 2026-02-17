{-# LANGUAGE OverloadedStrings #-}

module Property.HealthProps where

import Data.Text (Text)
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Health.Build qualified as HealthBuild
import Api (Health(..))
import Test.Tasty
import Test.Tasty.Hedgehog

prop_buildHealth :: Property
prop_buildHealth = property $ do
  version <- forAll genText
  let Health healthy ver = HealthBuild.buildHealth version
  healthy === True
  ver === version

genText :: Gen Text
genText = Gen.text (Range.linear 1 20) Gen.alphaNum

tests :: TestTree
tests =
  testGroup
    "Health Property Tests"
    [ testProperty "build health" prop_buildHealth
    ]
