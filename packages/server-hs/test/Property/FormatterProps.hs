{-# LANGUAGE OverloadedStrings #-}

module Property.FormatterProps where

import Data.List (nub)
import Formatter.Status (FormatterStatus (..), statusFor)
import Hedgehog
import Test.Tasty
import Test.Tasty.Hedgehog

prop_uniqueNames :: Property
prop_uniqueNames = property $ do
    statuses <- evalIO $ statusFor "."
    let names = map fsName statuses
    length names === length (nub names)

prop_extensionsNonEmpty :: Property
prop_extensionsNonEmpty = property $ do
    statuses <- evalIO $ statusFor "."
    assert $ all (not . null) (map fsExtensions statuses)

tests :: TestTree
tests =
    testGroup
        "Formatter Property Tests"
        [ testProperty "unique names" prop_uniqueNames
        , testProperty "extensions non-empty" prop_extensionsNonEmpty
        ]
