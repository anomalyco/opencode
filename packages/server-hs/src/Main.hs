{-# LANGUAGE OverloadedStrings #-}

module Main where

import Network.Wai.Handler.Warp (run)
import Network.Wai (Middleware, Application, mapResponseHeaders, responseLBS, requestMethod, responseStream)
import Network.HTTP.Types (status200, methodOptions)
import Servant
import Control.Concurrent (forkIO, threadDelay)
import Control.Concurrent.STM
import Data.ByteString.Builder (string8, lazyByteString)
import Data.Aeson (encode, object, Value(..), (.=))
import System.Directory (getCurrentDirectory)
import System.FilePath ((</>))
import qualified Data.Text as T

import Api
import State
import Handlers
import qualified Bus.Bus as Bus

-- | CORS Middleware
enableCors :: Middleware
enableCors app req respond =
  if requestMethod req == methodOptions
    then respond $ responseLBS status200 corsHeaders ""
    else app req $ \res -> respond $ mapResponseHeaders (\h -> h ++ corsHeaders) res
  where
    corsHeaders =
      [ ("Access-Control-Allow-Origin", "*")
      , ("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
      , ("Access-Control-Allow-Headers", "Authorization, Content-Type, x-opencode-directory")
      ]

-- | SSE Handler
globalEventHandler :: AppState -> Application
globalEventHandler state _ respond = do
  chan <- atomically $ dupTChan (stEventChan state)
  
  respond $ responseStream status200 
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

-- | Server Wiring
server :: AppState -> Server OpencodeAPI
server st = 
       healthHandler
  :<|> pathHandler
  :<|> globalConfigHandler
  :<|> projectListHandler
  :<|> projectCurrentHandler
  :<|> providerListHandler st
  :<|> providerAuthHandler st
  :<|> agentHandler
  :<|> configHandler st
  :<|> commandHandler
  :<|> sessionStatusHandler
  :<|> sessionListHandler st
  :<|> sessionCreateHandler st
  :<|> sessionMessageListHandler st
  :<|> sessionMessageCreateHandler st
  :<|> lspHandler
  :<|> vcsHandler
  :<|> permissionHandler
  :<|> questionHandler
  :<|> fileListHandler
  :<|> fileReadHandler
  :<|> globalEventHandler st

-- | Entry Point
main :: IO ()
main = do
  putStrLn "Initializing OpenCode Haskell Server..."
  
  -- Get working directory for project context
  cwd <- getCurrentDirectory
  let storageDir = cwd </> ".opencode" </> "storage"
  let projectID = "proj_default"
  
  state <- initialState storageDir (T.pack projectID) (T.pack cwd)
  
  -- Heartbeat
  _ <- forkIO $ do
    let loop = do
          threadDelay 10000000 -- 10s
          Bus.publish (stBus state) "server.heartbeat" (object [])
          loop
    loop

  putStrLn $ "Storage directory: " <> storageDir
  putStrLn "Listening on port 4096..."
  let app = enableCors (serve api (server state))
  run 4096 app
