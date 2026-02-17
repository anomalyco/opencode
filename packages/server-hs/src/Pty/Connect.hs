{-# LANGUAGE OverloadedStrings #-}

module Pty.Connect (
    ptyConnectHandler,
) where

import Data.Text (Text)
import Network.HTTP.Types (status400)
import Network.Wai (Application, responseLBS)
import Pty.Pty qualified as Pty
import Servant (Handler, Tagged (..))
import State

-- | PTY Connect Handler (WebSocket upgrade required)
ptyConnectHandler :: AppState -> Text -> Tagged Handler Application
ptyConnectHandler st ptyId = Tagged $ \_req respond' -> do
    mInfo <- Pty.get (stPtyManager st) ptyId
    case mInfo of
        Nothing ->
            respond' $
                responseLBS
                    status400
                    [("Content-Type", "text/plain")]
                    "PTY not found"
        Just _ -> do
            respond' $
                responseLBS
                    status400
                    [("Content-Type", "text/plain")]
                    "WebSocket upgrade required"
