{-# LANGUAGE OverloadedStrings #-}

-- | Application state
module State
  ( AppState(..)
  , initialState
  ) where

import Control.Concurrent.STM
import Data.Aeson (Value, toJSON)
import Data.Text (Text)

import qualified Data.Text as Text
import qualified Bus.Bus as Bus
import qualified Storage.Storage as Storage
import qualified Pty.Pty as Pty
import qualified Proxy.Proxy as Proxy
import Proxy.Types (ProxyConfig, defaultProxyConfig)

-- | Global Application State
data AppState = AppState
  { stBus :: Bus.Bus
  , stStorage :: Storage.StorageConfig
  , stProjectID :: Text
  , stDirectory :: Text
  , stVersion :: Text
  , stEventChan :: TChan Value  -- Raw SSE channel for backwards compat
  , stPtyManager :: Pty.PtyManager  -- PTY session manager
  , stProxy :: Maybe Proxy.ProxyServer  -- MITM proxy for LLM traffic
  }

-- | Initialize a new state
initialState :: FilePath -> Text -> Text -> IO AppState
initialState storageDir projectID directory = do
  bus <- Bus.newBus
  eventChan <- newBroadcastTChanIO
  ptyManager <- Pty.newManager (Text.unpack directory)
  
  -- Start MITM proxy for LLM traffic surveillance
  let proxyLogDir = storageDir <> "/proxy"
  proxy <- Proxy.start (defaultProxyConfig proxyLogDir)
  
  -- Subscribe bus to also write to event channel for SSE
  _ <- Bus.subscribeAll bus $ \event ->
    atomically $ writeTChan eventChan (toJSON event)
  
  pure $ AppState
    { stBus = bus
    , stStorage = Storage.StorageConfig storageDir
    , stProjectID = projectID
    , stDirectory = directory
    , stVersion = "0.1.0"
    , stEventChan = eventChan
    , stPtyManager = ptyManager
    , stProxy = Just proxy
    }
