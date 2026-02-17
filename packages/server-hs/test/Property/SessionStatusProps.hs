{-# LANGUAGE OverloadedStrings #-}

module Property.SessionStatusProps where

import Data.Aeson (Value (..), decode, encode)
import Data.Aeson.Key qualified as Key
import Data.Aeson.KeyMap qualified as KM
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Session.Status qualified as Status
import Test.Tasty
import Test.Tasty.Hedgehog

prop_buildStatus :: Property
prop_buildStatus = property $ do
    sessions <- forAll $ Gen.int (Range.linear 0 100)
    ptys <- forAll $ Gen.int (Range.linear 0 100)
    let status = Status.buildStatus sessions ptys
    Status.ssSessions status === sessions
    Status.ssPtys status === ptys

prop_statusJsonKeys :: Property
prop_statusJsonKeys = property $ do
    sessions <- forAll $ Gen.int (Range.linear 0 100)
    ptys <- forAll $ Gen.int (Range.linear 0 100)
    let status = Status.buildStatus sessions ptys
    case decodeValue (encode status) of
        Object obj -> do
            assert $ KM.member (Key.fromText "sessions") obj
            assert $ KM.member (Key.fromText "ptys") obj
        _ -> failure
  where
    decodeValue bytes = case decode bytes of
        Nothing -> Null
        Just v -> v

tests :: TestTree
tests =
    testGroup
        "Session Status Property Tests"
        [ testProperty "build status" prop_buildStatus
        , testProperty "status JSON keys" prop_statusJsonKeys
        ]
