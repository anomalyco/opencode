{-# LANGUAGE OverloadedStrings #-}

module Property.FindParseProps where

import Data.Text (Text)
import Data.Text qualified as T
import Find.Parse qualified as Parse
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Test.Tasty
import Test.Tasty.Hedgehog

prop_parseRgLine :: Property
prop_parseRgLine = property $ do
    path <- forAll genPath
    lineNum <- forAll $ Gen.int (Range.linear 1 10000)
    text <- forAll genText
    let line = path <> ":" <> T.pack (show lineNum) <> ":" <> text
    case Parse.parseRgLine line of
        Nothing -> failure
        Just (p, n, t) -> do
            p === path
            n === lineNum
            t === text

prop_parseFdLine :: Property
prop_parseFdLine = property $ do
    path <- forAll genPath
    Parse.parseFdLine path === Just path

prop_parseFdLineEmpty :: Property
prop_parseFdLineEmpty = property $ do
    Parse.parseFdLine "   " === Nothing

prop_parseRgLineInvalid :: Property
prop_parseRgLineInvalid = property $ do
    path <- forAll genPath
    let line = path <> ":" <> "not-a-number" <> ":" <> "text"
    Parse.parseRgLine line === Nothing

prop_parseRgEmptyText :: Property
prop_parseRgEmptyText = property $ do
    path <- forAll genPath
    lineNum <- forAll $ Gen.int (Range.linear 1 10000)
    let line = path <> ":" <> T.pack (show lineNum) <> ":"
    Parse.parseRgLine line === Just (path, lineNum, "")

genPath :: Gen Text
genPath = do
    name <- Gen.text (Range.linear 1 12) Gen.alphaNum
    ext <- Gen.text (Range.linear 1 3) Gen.alphaNum
    pure (name <> "." <> ext)

genText :: Gen Text
genText = Gen.text (Range.linear 0 50) Gen.alphaNum

tests :: TestTree
tests =
    testGroup
        "Find Parse Property Tests"
        [ testProperty "parse rg line" prop_parseRgLine
        , testProperty "parse fd line" prop_parseFdLine
        , testProperty "parse rg invalid" prop_parseRgLineInvalid
        , testProperty "parse fd empty" prop_parseFdLineEmpty
        , testProperty "parse rg empty text" prop_parseRgEmptyText
        ]
