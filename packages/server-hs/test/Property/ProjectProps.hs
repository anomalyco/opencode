{-# LANGUAGE OverloadedStrings #-}

module Property.ProjectProps where

import Api (Project (Project))
import Data.Text qualified as T
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Project.Build qualified as ProjectBuild
import Test.Tasty
import Test.Tasty.Hedgehog

prop_projectFromDirUsesBase :: Property
prop_projectFromDirUsesBase = property $ do
    base <- forAll $ Gen.text (Range.linear 1 12) Gen.alphaNum
    let dir = "/tmp/" <> T.unpack base
    let project = ProjectBuild.projectFromDir dir
    case project of
        Project pid wt nm -> do
            pid === "proj_" <> base
            wt === T.pack dir
            nm === Just base

tests :: TestTree
tests =
    testGroup
        "Project Property Tests"
        [ testProperty "projectFromDir uses base name" prop_projectFromDirUsesBase
        ]
