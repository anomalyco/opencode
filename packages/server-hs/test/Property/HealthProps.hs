{-# LANGUAGE OverloadedStrings #-}

module Property.HealthProps where

import Api (Health (..))
import Data.Aeson (decode, encode)
import Data.Text (Text)
import Health.Build qualified as HealthBuild
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Test.Tasty
import Test.Tasty.Hedgehog

prop_buildHealth :: Property
prop_buildHealth = property $ do
    version <- forAll genText
    let Health healthy ver = HealthBuild.buildHealth version
    healthy === True
    ver === version

prop_healthJsonRoundtrip :: Property
prop_healthJsonRoundtrip = property $ do
    version <- forAll genText
    let health = HealthBuild.buildHealth version
    case decode (encode health) of
        Nothing -> failure
        Just health' -> health' === health

genText :: Gen Text
genText = Gen.text (Range.linear 1 20) Gen.alphaNum

tests :: TestTree
tests =
    testGroup
        "Health Property Tests"
        [ testProperty "build health" prop_buildHealth
        , testProperty "health JSON roundtrip" prop_healthJsonRoundtrip
        ]
