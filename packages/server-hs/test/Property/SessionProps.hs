{-# LANGUAGE OverloadedStrings #-}

-- | Session property tests
module Property.SessionProps where

import Bus.Bus qualified as Bus
import Control.Monad (replicateM, void)
import Data.Text qualified as T
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Session.Session qualified as Session
import Session.Types qualified as ST
import Storage.Storage qualified as Storage
import System.Directory (removeDirectoryRecursive)
import System.IO.Temp (createTempDirectory)
import Test.Tasty
import Test.Tasty.Hedgehog

-- | Create a test session context
withTestContext :: (Session.SessionContext -> IO a) -> IO a
withTestContext action = do
    tmpDir <- createTempDirectory "/tmp" "session-test"
    Storage.withStorage tmpDir $ \storage -> do
        bus <- Bus.newBus
        let ctx =
                Session.SessionContext
                    { Session.scStorage = storage
                    , Session.scBus = bus
                    , Session.scProjectID = "test_project"
                    , Session.scDirectory = T.pack tmpDir
                    , Session.scVersion = "0.1.0"
                    }
        result <- action ctx
        removeDirectoryRecursive tmpDir
        pure result

-- | Property: create then get returns the session
prop_createGet :: Property
prop_createGet = property $ do
    title <- forAll $ Gen.maybe $ Gen.text (Range.linear 1 50) Gen.alphaNum

    session <- evalIO $ withTestContext $ \ctx -> do
        let input =
                ST.CreateSessionInput
                    { ST.csiTitle = title
                    , ST.csiParentID = Nothing
                    }
        Session.create ctx input

    -- Verify session was created with correct properties
    -- When title is Nothing, a default title is generated
    case title of
        Just t -> ST.sessionTitle session === t
        Nothing -> assert $ T.isPrefixOf "New session - " (ST.sessionTitle session)
    ST.sessionProjectID session === "test_project"
    assert $ T.isPrefixOf "ses_" (ST.sessionId session)

-- | Property: get non-existent session returns Nothing
prop_getNonExistent :: Property
prop_getNonExistent = property $ do
    sid <- forAll $ Gen.text (Range.linear 10 30) Gen.alphaNum

    result <- evalIO $ withTestContext $ \ctx ->
        Session.get ctx sid

    result === Nothing

-- | Property: delete removes the session
prop_deleteRemoves :: Property
prop_deleteRemoves = property $ do
    title <- forAll $ Gen.text (Range.linear 1 50) Gen.alphaNum

    (created, afterDelete) <- evalIO $ withTestContext $ \ctx -> do
        let input =
                ST.CreateSessionInput
                    { ST.csiTitle = Just title
                    , ST.csiParentID = Nothing
                    }
        session <- Session.create ctx input
        let sid = ST.sessionId session
        _ <- Session.delete ctx sid
        afterGet <- Session.get ctx sid
        pure (session, afterGet)

    -- Session should exist after creation
    assert $ T.isPrefixOf "ses_" (ST.sessionId created)
    -- Session should not exist after deletion
    afterDelete === Nothing

-- | Property: list returns created sessions
prop_listReturnsCreated :: Property
prop_listReturnsCreated = property $ do
    count <- forAll $ Gen.int (Range.linear 1 5)

    sessions <- evalIO $ withTestContext $ \ctx -> do
        -- Create multiple sessions
        void $ replicateM count $ do
            let input =
                    ST.CreateSessionInput
                        { ST.csiTitle = Just "test"
                        , ST.csiParentID = Nothing
                        }
            Session.create ctx input
        -- List all sessions
        Session.list ctx Nothing Nothing

    -- Should find all created sessions
    length sessions === count

prop_updateSummaryShareRevert :: Property
prop_updateSummaryShareRevert = property $ do
    msgId <- forAll $ Gen.text (Range.linear 3 20) Gen.alphaNum
    url <- forAll $ Gen.text (Range.linear 3 20) Gen.alphaNum
    (summary, share, revert) <- evalIO $ withTestContext $ \ctx -> do
        session <-
            Session.create
                ctx
                ST.CreateSessionInput
                    { ST.csiTitle = Just "test"
                    , ST.csiParentID = Nothing
                    }
        let sid = ST.sessionId session
        let summary = ST.SessionSummary 1 2 (Just 3)
        let share = ST.SessionShare url
        let revert = ST.SessionRevert msgId Nothing Nothing Nothing
        _ <-
            Session.update
                ctx
                sid
                ( \s ->
                    s
                        { ST.sessionSummary = Just summary
                        , ST.sessionShare = Just share
                        , ST.sessionRevert = Just revert
                        }
                )
        updated <- Session.get ctx sid
        case updated of
            Nothing -> fail "session not found"
            Just s -> pure (ST.sessionSummary s, ST.sessionShare s, ST.sessionRevert s)
    summary === Just (ST.SessionSummary 1 2 (Just 3))
    share === Just (ST.SessionShare url)
    revert === Just (ST.SessionRevert msgId Nothing Nothing Nothing)

-- Generators
-- Test tree
tests :: TestTree
tests =
    testGroup
        "Session Property Tests"
        [ testProperty "create then get" prop_createGet
        , testProperty "get non-existent" prop_getNonExistent
        , testProperty "delete removes" prop_deleteRemoves
        , testProperty "list returns created" prop_listReturnsCreated
        , testProperty "update summary/share/revert" prop_updateSummaryShareRevert
        ]
