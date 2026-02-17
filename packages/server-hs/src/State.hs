{-# LANGUAGE OverloadedStrings #-}

-- | Application state
module State (
    AppState (..),
    initialState,
) where

import Control.Concurrent.STM
import Data.Aeson (Value, toJSON)
import Data.Text (Text)

import Bus.Bus qualified as Bus
import Data.Text qualified as Text
import Log qualified
import Prompt.Async (PromptAsyncJob)
import Proxy.Proxy qualified as Proxy
import Proxy.Types (defaultProxyConfig)
import Pty.Pty qualified as Pty
import Storage.Storage qualified as Storage

-- | Global Application State
data AppState = AppState
    { stBus :: Bus.Bus
    , stStorage :: Storage.StorageConfig
    , stProjectID :: Text
    , stDirectory :: Text
    , stVersion :: Text
    , stEventChan :: TChan Value -- Raw SSE channel for backwards compat
    , stPtyManager :: Pty.PtyManager -- PTY session manager
    , stProxy :: Maybe Proxy.ProxyServer -- MITM proxy for LLM traffic
    , stLogger :: Log.Logger -- Structured logger
    , stPromptAsyncQueue :: TQueue PromptAsyncJob -- prompt_async worker queue
    }

-- | Initialize a new state
initialState :: FilePath -> Text -> Text -> Log.Logger -> IO AppState
initialState storageDir projectID directory logger = do
    bus <- Bus.newBus
    eventChan <- newBroadcastTChanIO
    ptyManager <- Pty.newManager (Text.unpack directory)
    promptQueue <- newTQueueIO

    -- Start MITM proxy for LLM traffic surveillance
    let proxyLogDir = storageDir <> "/proxy"
    proxy <- Proxy.start (defaultProxyConfig proxyLogDir)

    -- Subscribe bus to also write to event channel for SSE
    _ <- Bus.subscribeAll bus $ \event ->
        atomically $ writeTChan eventChan (toJSON event)

    pure $
        AppState
            { stBus = bus
            , stStorage = Storage.StorageConfig storageDir
            , stProjectID = projectID
            , stDirectory = directory
            , stVersion = "0.1.0"
            , stEventChan = eventChan
            , stPtyManager = ptyManager
            , stProxy = Just proxy
            , stLogger = logger
            , stPromptAsyncQueue = promptQueue
            }
