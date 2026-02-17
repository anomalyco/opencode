{-# LANGUAGE OverloadedStrings #-}

module Global.Event (
    globalEventHandler,
) where

import Control.Concurrent.STM
import Data.Aeson (encode)
import Data.ByteString.Builder (lazyByteString, string8)
import Network.HTTP.Types (status200)
import Network.Wai (Application, responseStream)
import Servant (Handler, Tagged (..))
import State

-- | SSE Handler
globalEventHandler :: AppState -> Tagged Handler Application
globalEventHandler state = Tagged $ \_ respond' -> do
    chan <- atomically $ dupTChan (stEventChan state)

    respond'
        $ responseStream
            status200
            [("Content-Type", "text/event-stream"), ("Cache-Control", "no-cache")]
        $ \send flush -> do
            send $ string8 "data: {\"type\":\"server.connected\",\"properties\":{}}\n\n"
            flush

            let loop = do
                    val <- atomically $ readTChan chan
                    send $ string8 "data: "
                    send $ lazyByteString (encode val)
                    send $ string8 "\n\n"
                    flush
                    loop
            loop
