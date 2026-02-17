{-# LANGUAGE OverloadedStrings #-}

-- | Tool execution property tests
module Property.ToolProps where

import Data.Aeson (object, (.=))
import Data.Text (Text)
import Data.Text qualified as T
import Data.Text.IO qualified as TIO
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import System.Directory (doesFileExist, removeDirectoryRecursive)
import System.FilePath ((</>))
import System.IO.Temp (createTempDirectory)
import Test.Tasty
import Test.Tasty.Hedgehog
import Tool.Exec (execute)
import Tool.Types

-- | Create a temporary directory for testing
withTempDir :: (FilePath -> IO a) -> IO a
withTempDir action = do
    tmpDir <- createTempDirectory "/tmp" "tool-test"
    result <- action tmpDir
    removeDirectoryRecursive tmpDir
    pure result

-- | Create a test context
testContext :: FilePath -> ToolContext
testContext workdir =
    ToolContext
        { tcSessionID = "test_session"
        , tcMessageID = "test_message"
        , tcWorkdir = workdir
        }

-- | Property: read tool returns file content
prop_readTool :: Property
prop_readTool = property $ do
    content <- forAll $ Gen.text (Range.linear 1 500) Gen.unicode
    filename <- forAll $ Gen.text (Range.linear 1 30) Gen.alphaNum

    result <- evalIO $ withTempDir $ \tmpDir -> do
        let path = tmpDir </> T.unpack filename
        TIO.writeFile path content
        let input =
                object
                    [ "filePath" .= path
                    , "offset" .= (1 :: Int)
                    , "limit" .= (1000 :: Int)
                    ]
        execute (testContext tmpDir) "read" input

    assert $ not (toIsError result)
    assert $ T.length (toOutput result) > 0

-- | Property: write tool creates file
prop_writeTool :: Property
prop_writeTool = property $ do
    content <- forAll $ Gen.text (Range.linear 0 500) Gen.unicode
    filename <- forAll $ Gen.text (Range.linear 1 30) Gen.alphaNum

    result <- evalIO $ withTempDir $ \tmpDir -> do
        let path = tmpDir </> T.unpack filename
        let input =
                object
                    [ "filePath" .= path
                    , "content" .= content
                    ]
        output <- execute (testContext tmpDir) "write" input
        exists <- doesFileExist path
        pure (output, exists)

    let (output, exists) = result
    assert $ not (toIsError output)
    assert exists

-- | Property: edit tool modifies file
prop_editTool :: Property
prop_editTool = property $ do
    oldText <- forAll $ Gen.text (Range.linear 1 30) Gen.alphaNum
    newText <- forAll $ Gen.text (Range.linear 1 30) Gen.alphaNum
    prefix <- forAll $ Gen.text (Range.linear 0 50) Gen.alphaNum
    suffix <- forAll $ Gen.text (Range.linear 0 50) Gen.alphaNum

    -- Ensure oldText doesn't appear in prefix or suffix to avoid ambiguity
    let uniqueOldText = "OLDTEXT_" <> oldText
    let originalContent = prefix <> uniqueOldText <> suffix

    result <- evalIO $ withTempDir $ \tmpDir -> do
        let path = tmpDir </> "test.txt"
        TIO.writeFile path originalContent
        let input =
                object
                    [ "filePath" .= path
                    , "oldString" .= uniqueOldText
                    , "newString" .= newText
                    , "replaceAll" .= False
                    ]
        output <- execute (testContext tmpDir) "edit" input
        editedContent <- TIO.readFile path
        pure (output, editedContent)

    let (output, editedContent) = result
    assert $ not (toIsError output)
    assert $ T.isInfixOf newText editedContent
    assert $ not (T.isInfixOf "OLDTEXT_" editedContent)

-- | Property: bash tool executes commands
prop_bashTool :: Property
prop_bashTool = property $ do
    cmd <- forAll $ Gen.element ["echo hello" :: Text, "pwd", "whoami"]

    result <- evalIO $ withTempDir $ \tmpDir -> do
        let input =
                object
                    [ "command" .= (cmd :: Text)
                    , "description" .= ("test command" :: Text)
                    , "timeout" .= (5000 :: Int)
                    ]
        execute (testContext tmpDir) "bash" input

    assert $ not (toIsError result)
    assert $ T.length (toOutput result) > 0

prop_bashToolUsesWorkdir :: Property
prop_bashToolUsesWorkdir = property $ do
    (result, dir) <- evalIO $ withTempDir $ \tmpDir -> do
        let input =
                object
                    [ "command" .= ("pwd" :: Text)
                    , "description" .= ("test workdir" :: Text)
                    , "timeout" .= (5000 :: Int)
                    , "workdir" .= (T.pack tmpDir)
                    ]
        output <- execute (testContext tmpDir) "bash" input
        pure (output, tmpDir)
    assert $ not (toIsError result)
    assert $ T.isInfixOf (T.pack dir) (toOutput result)

-- Generators
genText :: Gen Text
genText = Gen.text (Range.linear 0 100) Gen.alphaNum

-- Test tree
tests :: TestTree
tests =
    testGroup
        "Tool Property Tests"
        [ testProperty "read tool" prop_readTool
        , testProperty "write tool" prop_writeTool
        , testProperty "edit tool" prop_editTool
        , testProperty "bash tool" prop_bashTool
        , testProperty "bash tool uses workdir" prop_bashToolUsesWorkdir
        ]
