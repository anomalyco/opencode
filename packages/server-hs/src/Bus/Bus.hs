{-# LANGUAGE OverloadedStrings #-}

-- | Bus module - STM-based pub/sub event system
-- Mirrors the TypeScript Bus namespace
module Bus.Bus
  ( Bus
  , newBus
  , publish
  , subscribe
  , subscribeAll
  , BusEvent(..)
  ) where

import Control.Concurrent.STM
import Control.Monad (forever, void)
import Control.Concurrent (forkIO)
import Data.Aeson (ToJSON(..), Value, object, (.=))
import Data.Text (Text)

-- | A bus event with type and properties
data BusEvent = BusEvent
  { beType :: Text
  , beProperties :: Value
  } deriving (Show, Eq)

instance ToJSON BusEvent where
  toJSON e = object
    [ "type" .= beType e
    , "properties" .= beProperties e
    ]

-- | The event bus - a broadcast channel
newtype Bus = Bus { unBus :: TChan BusEvent }

-- | Create a new event bus
newBus :: IO Bus
newBus = Bus <$> newBroadcastTChanIO

-- | Publish an event to the bus
publish :: Bus -> Text -> Value -> IO ()
publish bus typ props = atomically $ writeTChan (unBus bus) (BusEvent typ props)

-- | Subscribe to all events on the bus
-- Returns an unsubscribe action
subscribeAll :: Bus -> (BusEvent -> IO ()) -> IO (IO ())
subscribeAll bus callback = do
  chan <- atomically $ dupTChan (unBus bus)
  tid <- forkIO $ forever $ do
    event <- atomically $ readTChan chan
    callback event
  pure $ void $ forkIO $ atomically $ pure () -- TODO: proper unsubscribe with killThread

-- | Subscribe to events of a specific type
subscribe :: Bus -> Text -> (BusEvent -> IO ()) -> IO (IO ())
subscribe bus eventType callback = subscribeAll bus $ \event ->
  if beType event == eventType
    then callback event
    else pure ()
