{-# LANGUAGE OverloadedStrings #-}

-- | Bus property tests
module Property.BusProps where

import Bus.Bus qualified as Bus
import Control.Concurrent (threadDelay)
import Control.Concurrent.STM
import Control.Monad (replicateM, void)
import Data.Aeson (Value (..))
import Data.Text (Text)
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Test.Tasty
import Test.Tasty.Hedgehog

-- | Property: published events are received by subscribers
prop_publishSubscribe :: Property
prop_publishSubscribe = property $ do
    eventType <- forAll genEventType
    eventCount <- forAll $ Gen.int (Range.linear 1 20)

    received <- evalIO $ do
        bus <- Bus.newBus
        receivedVar <- newTVarIO []

        -- Subscribe to events
        void $ Bus.subscribe bus eventType $ \event -> do
            atomically $ modifyTVar' receivedVar (Bus.beType event :)

        -- Publish events
        void $ replicateM eventCount $ do
            Bus.publish bus eventType Null
            threadDelay 1000 -- Small delay to ensure ordering

        -- Wait for all events to be processed
        threadDelay 10000

        atomically $ readTVar receivedVar

    -- All events should have been received
    length received === eventCount
    -- All should be the same event type
    all (== eventType) received === True

-- | Property: subscribeAll receives all event types
prop_subscribeAll :: Property
prop_subscribeAll = property $ do
    eventTypes <- forAll $ Gen.list (Range.linear 1 5) genEventType

    received <- evalIO $ do
        bus <- Bus.newBus
        receivedVar <- newTVarIO []

        -- Subscribe to all events
        void $ Bus.subscribeAll bus $ \event -> do
            atomically $ modifyTVar' receivedVar (Bus.beType event :)

        -- Publish different event types
        mapM_ (\et -> Bus.publish bus et Null) eventTypes

        threadDelay 10000
        atomically $ readTVar receivedVar

    -- Should receive all events
    length received === length eventTypes

-- | Property: multiple subscribers receive the same events
prop_multipleSubscribers :: Property
prop_multipleSubscribers = property $ do
    eventType <- forAll genEventType
    subscriberCount <- forAll $ Gen.int (Range.linear 2 5)

    results <- evalIO $ do
        bus <- Bus.newBus
        vars <- replicateM subscriberCount $ newTVarIO []

        -- Subscribe all
        mapM_
            ( \var -> Bus.subscribe bus eventType $ \event ->
                atomically $ modifyTVar' var (Bus.beType event :)
            )
            vars

        -- Publish one event
        Bus.publish bus eventType Null

        waitForAll vars (50 :: Int)

    -- All subscribers should have received the event
    all (\r -> length r == 1) results === True
    all (\r -> case r of [x] -> x == eventType; _ -> False) results === True
  where
    waitForAll vars attempts = do
        results <- mapM (atomically . readTVar) vars
        if all (\r -> length r == 1) results
            then pure results
            else do
                if attempts <= 0
                    then pure results
                    else do
                        threadDelay 1000
                        waitForAll vars (attempts - 1)

prop_subscribeAllOrder :: Property
prop_subscribeAllOrder = property $ do
    eventTypes <- forAll $ Gen.list (Range.linear 1 5) genEventType
    received <- evalIO $ do
        bus <- Bus.newBus
        receivedVar <- newTVarIO []
        void $ Bus.subscribeAll bus $ \event ->
            atomically $ modifyTVar' receivedVar (Bus.beType event :)
        mapM_ (\et -> Bus.publish bus et Null) eventTypes
        threadDelay 10000
        atomically $ readTVar receivedVar
    reverse received === eventTypes

-- Generators
genEventType :: Gen Text
genEventType =
    Gen.element
        [ "session.created"
        , "session.updated"
        , "session.deleted"
        , "message.updated"
        , "message.part.updated"
        , "pty.created"
        , "pty.updated"
        , "pty.deleted"
        ]

-- Test tree
tests :: TestTree
tests =
    testGroup
        "Bus Property Tests"
        [ testProperty "publish/subscribe" prop_publishSubscribe
        , testProperty "subscribeAll receives all" prop_subscribeAll
        , testProperty "multiple subscribers" prop_multipleSubscribers
        , testProperty "subscribeAll order" prop_subscribeAllOrder
        ]
