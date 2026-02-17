{-# LANGUAGE OverloadedStrings #-}

module Property.SessionStatusProps where

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

tests :: TestTree
tests =
    testGroup
        "Session Status Property Tests"
        [ testProperty "build status" prop_buildStatus
        ]
