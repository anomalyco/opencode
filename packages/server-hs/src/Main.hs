{-# LANGUAGE OverloadedStrings #-}

module Main where

import Network.Wai.Handler.Warp (run)
import Network.Wai (Middleware, Application, mapResponseHeaders, responseLBS, requestMethod, responseStream)
import Network.Wai.Handler.WebSockets (websocketsOr)
import Network.HTTP.Types (status200, status400, methodOptions)
import Network.WebSockets (defaultConnectionOptions, acceptRequest, receiveData, sendBinaryData, Connection, PendingConnection, pendingRequest, requestPath)
import Servant
import Servant.Server (Tagged(..))
import Control.Concurrent (forkIO, threadDelay)
import Control.Concurrent.STM
import Control.Exception (try, SomeException)
import Control.Monad (forever, void)
import Data.ByteString.Builder (string8, lazyByteString)
import Data.Aeson (encode, object, Value(..), (.=))
import System.Directory (getCurrentDirectory)
import System.FilePath ((</>))
import System.IO (hFlush, stdout, hSetBuffering, BufferMode(..))
import qualified Data.ByteString as BS
import qualified Data.ByteString.Lazy as LBS
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE

import Api
import State
import Handlers
import qualified Bus.Bus as Bus
import qualified Pty.Pty as Pty
import qualified Log
import qualified Katip

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
globalEventHandler :: AppState -> Tagged Handler Application
globalEventHandler state = Tagged $ \_ respond -> do
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

-- | PTY Connect Handler (WebSocket)
ptyConnectHandler :: AppState -> T.Text -> Tagged Handler Application
ptyConnectHandler st ptyId = Tagged $ \req respond -> do
  -- Check if PTY exists
  mInfo <- Pty.get (stPtyManager st) ptyId
  case mInfo of
    Nothing -> respond $ responseLBS status400 
      [("Content-Type", "text/plain")]
      "PTY not found"
    Just _ -> do
      -- This handler is for non-WebSocket requests to the endpoint
      -- The actual WebSocket handling is done by the middleware
      respond $ responseLBS status400 
        [("Content-Type", "text/plain")]
        "WebSocket upgrade required"

-- | WebSocket application for PTY connections
ptyWebSocketApp :: AppState -> PendingConnection -> IO ()
ptyWebSocketApp st pending = do
  -- Extract PTY ID from request path
  let path = requestPath (pendingRequest pending)
      pathParts = BS.split (fromIntegral (fromEnum '/')) path
      -- Path should be /pty/{ptyId}/connect
      mPtyId = case pathParts of
        [_, "pty", ptyIdBs, "connect"] -> Just (TE.decodeUtf8 ptyIdBs)
        _ -> Nothing
  
  case mPtyId of
    Nothing -> pure ()  -- Invalid path
    Just ptyId -> do
      -- Connect to PTY
      mConn <- Pty.connect (stPtyManager st) ptyId Nothing
      case mConn of
        Nothing -> pure ()  -- PTY not found
        Just ptyConn -> do
          -- Accept WebSocket
          conn <- acceptRequest pending
          
          -- Set up bidirectional bridge
          -- Reader thread: PTY -> WebSocket
          void $ forkIO $ Pty.pcOnData ptyConn $ \bs -> do
            void $ try @SomeException $ sendBinaryData conn bs
          
          -- Writer loop: WebSocket -> PTY
          let loop = do
                result <- try @SomeException $ receiveData conn
                case result of
                  Left _ -> Pty.pcClose ptyConn  -- Connection closed
                  Right bs -> do
                    Pty.pcSend ptyConn bs
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
  -- PTY handlers
  :<|> ptyListHandler st
  :<|> ptyCreateHandler st
  :<|> ptyGetHandler st
  :<|> ptyUpdateHandler st
  :<|> ptyDeleteHandler st
  :<|> ptyConnectHandler st
  :<|> ptyCommitHandler st
  :<|> ptyChangesHandler st
  -- LLM
  :<|> chatHandler st

-- | Entry Point
main :: IO ()
main = Log.withLogger "opencode" $ \logger -> do
  hSetBuffering stdout LineBuffering
  
  let lg = Log.withNS logger "server"
  Log.logMsg lg Katip.InfoS "initializing opencode server"
  
  -- Get working directory for project context
  cwd <- getCurrentDirectory
  let storageDir = cwd </> ".opencode" </> "storage"
  let projectID = "proj_default"
  
  state <- initialState storageDir (T.pack projectID) (T.pack cwd) logger
  
  -- Heartbeat
  _ <- forkIO $ do
    let loop = do
          threadDelay 10000000 -- 10s
          Bus.publish (stBus state) "server.heartbeat" (object [])
          loop
    loop

  Log.logMsg lg Katip.InfoS $ "storage: " <> T.pack storageDir
  Log.logMsg lg Katip.InfoS "listening on port 4096"
  
  -- Wrap the Servant app with WebSocket support
  let servantApp = enableCors (serve api (server state))
      wsApp = websocketsOr defaultConnectionOptions (ptyWebSocketApp state) servantApp
  
  run 4096 wsApp
