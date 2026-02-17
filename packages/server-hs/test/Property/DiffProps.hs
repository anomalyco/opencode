{-# LANGUAGE OverloadedStrings #-}

module Property.DiffProps where

import Data.Text qualified as T
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Session.Types qualified as ST
import Test.Tasty
import Test.Tasty.Hedgehog
import Vcs.Diff qualified as Diff

prop_parseNumstatTotals :: Property
prop_parseNumstatTotals = property $ do
    entries <- forAll $ Gen.list (Range.linear 0 20) genEntry
    let text = T.intercalate "\n" (map toLine entries)
    let summary = Diff.parseNumstat text
    let adds = sum (map fst entries)
    let dels = sum (map snd entries)
    ST.ssAdditions summary === adds
    ST.ssDeletions summary === dels
    ST.ssFiles summary === Just (length entries)
  where
    toLine (a, d) = T.pack (show a) <> "\t" <> T.pack (show d) <> "\tfile.txt"

prop_parseNumstatBinary :: Property
prop_parseNumstatBinary = property $ do
    files <- forAll $ Gen.int (Range.linear 1 10)
    let text = T.intercalate "\n" (replicate files "-\t-\tfile.bin")
    let summary = Diff.parseNumstat text
    ST.ssAdditions summary === 0
    ST.ssDeletions summary === 0
    ST.ssFiles summary === Just files

prop_parseNumstatEmpty :: Property
prop_parseNumstatEmpty = property $ do
    let summary = Diff.parseNumstat ""
    ST.ssAdditions summary === 0
    ST.ssDeletions summary === 0
    ST.ssFiles summary === Just 0

genEntry :: Gen (Int, Int)
genEntry = do
    adds <- Gen.int (Range.linear 0 1000)
    dels <- Gen.int (Range.linear 0 1000)
    pure (adds, dels)

tests :: TestTree
tests =
    testGroup
        "Diff Property Tests"
        [ testProperty "parse numstat totals" prop_parseNumstatTotals
        , testProperty "parse numstat binary" prop_parseNumstatBinary
        , testProperty "parse numstat empty" prop_parseNumstatEmpty
        ]
