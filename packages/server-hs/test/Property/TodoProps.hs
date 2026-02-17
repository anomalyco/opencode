{-# LANGUAGE OverloadedStrings #-}

module Property.TodoProps where

import Data.Aeson (Value (..), object, (.=))
import Data.Text (Text)
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Message.Todo qualified as Todo
import Test.Tasty
import Test.Tasty.Hedgehog

prop_extractTodos :: Property
prop_extractTodos = property $ do
    items <- forAll $ Gen.list (Range.linear 0 10) genItem
    parts <- forAll $ Gen.list (Range.linear 0 5) genPart
    let todo = object ["type" .= ("todo" :: Text), "items" .= items]
    let allParts = todo : parts
    let extracted = Todo.extractTodos allParts
    extracted === items

genItem :: Gen Value
genItem = do
    text <- Gen.text (Range.linear 1 30) Gen.alphaNum
    pure $ object ["text" .= text, "done" .= False]

genPart :: Gen Value
genPart = do
    text <- Gen.text (Range.linear 1 30) Gen.alphaNum
    Gen.element
        [ object ["type" .= ("text" :: Text), "text" .= text]
        , object ["type" .= ("code" :: Text), "text" .= text]
        ]

tests :: TestTree
tests =
    testGroup
        "Todo Property Tests"
        [ testProperty "extract todos" prop_extractTodos
        ]
