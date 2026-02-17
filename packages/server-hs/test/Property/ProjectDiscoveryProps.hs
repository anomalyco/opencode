{-# LANGUAGE OverloadedStrings #-}

module Property.ProjectDiscoveryProps where

import Data.Text (Text)
import Data.Text qualified as T
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Project.Discovery qualified as Discovery
import System.Directory (createDirectoryIfMissing, removeDirectoryRecursive)
import System.FilePath ((</>))
import System.IO.Temp (createTempDirectory)
import Test.Tasty
import Test.Tasty.Hedgehog

prop_discoverProjects :: Property
prop_discoverProjects = property $ do
    name <- forAll genText
    result <- evalIO $ do
        tmpDir <- createTempDirectory "/tmp" "project-discovery"
        let subDir = tmpDir </> T.unpack name
        createDirectoryIfMissing True subDir
        writeFile (subDir </> "weapon.json") "{}"
        projects <- Discovery.discoverProjects tmpDir
        removeDirectoryRecursive tmpDir
        pure projects
    assert $ length result >= 2

genText :: Gen Text
genText = Gen.text (Range.linear 3 10) Gen.alphaNum

tests :: TestTree
tests =
    testGroup
        "Project Discovery Property Tests"
        [ testProperty "discover projects includes subdir" prop_discoverProjects
        ]
