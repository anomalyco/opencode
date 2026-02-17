{-# LANGUAGE OverloadedStrings #-}

module Property.PtyProps where

import Data.Aeson (object, (.=))
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Pty.Parse qualified as PtyParse
import Pty.Types qualified as PtyT
import Test.Tasty
import Test.Tasty.Hedgehog

prop_parseInputPreserves :: Property
prop_parseInputPreserves = property $ do
    cwd <- forAll $ Gen.text (Range.linear 1 20) Gen.alphaNum
    title <- forAll $ Gen.text (Range.linear 1 20) Gen.alphaNum
    sandbox <- forAll Gen.bool
    let input =
            object
                [ "cwd" .= cwd
                , "title" .= title
                , "sandbox" .= sandbox
                ]
    let parsed = PtyParse.parseInput input
    PtyT.cpiCwd parsed === Just cwd
    PtyT.cpiTitle parsed === Just title
    PtyT.cpiSandbox parsed === Just sandbox

prop_parseInputDefaults :: Property
prop_parseInputDefaults = property $ do
    let parsed = PtyParse.parseInput (object [])
    PtyT.cpiCommand parsed === Nothing
    PtyT.cpiArgs parsed === Nothing
    PtyT.cpiCwd parsed === Nothing
    PtyT.cpiTitle parsed === Nothing
    PtyT.cpiEnv parsed === Nothing
    PtyT.cpiSandbox parsed === Nothing
    PtyT.cpiNetwork parsed === Nothing
    PtyT.cpiMounts parsed === Nothing
    PtyT.cpiSessionId parsed === Nothing

tests :: TestTree
tests =
    testGroup
        "PTY Property Tests"
        [ testProperty "parse input preserves fields" prop_parseInputPreserves
        , testProperty "parse input defaults" prop_parseInputDefaults
        ]
