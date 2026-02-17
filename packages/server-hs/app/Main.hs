{-# LANGUAGE OverloadedStrings #-}

module Main where

import Api
import Bus.Bus qualified as Bus
import Control.Concurrent (forkIO, threadDelay)
import Control.Concurrent.STM
import Control.Exception (SomeException, try)
import Control.Monad (void)
import Data.Aeson (encode, object)
import Data.ByteString qualified as BS
import Data.ByteString.Builder (lazyByteString, string8)
import Data.Text qualified as T
import Data.Text.Encoding qualified as TE
import Handlers
import Katip qualified
import Log qualified
import Network.HTTP.Types (methodOptions, status200, status400)
import Network.Wai (Middleware, mapResponseHeaders, requestMethod, responseLBS, responseStream)
import Network.Wai.Handler.Warp (run)
import Network.Wai.Handler.WebSockets (websocketsOr)
import Network.WebSockets (PendingConnection, acceptRequest, defaultConnectionOptions, pendingRequest, receiveData, requestPath, sendBinaryData)
import Pty.Pty qualified as Pty
import Servant
import State
import System.Directory (getCurrentDirectory)
import System.FilePath ((</>))
import System.IO (BufferMode (..), hSetBuffering, stdout)

-- | CORS Middleware
enableCors :: Middleware
enableCors app req respond' =
  if requestMethod req == methodOptions
    then respond' $ responseLBS status200 corsHeaders ""
    else app req $ \res -> respond' $ mapResponseHeaders (\h -> h ++ corsHeaders) res
  where
    corsHeaders =
      [ ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH"),
        ("Access-Control-Allow-Headers", "Authorization, Content-Type, x-opencode-directory")
      ]

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

-- | PTY Connect Handler (WebSocket)
ptyConnectHandler :: AppState -> T.Text -> Tagged Handler Application
ptyConnectHandler st ptyId = Tagged $ \_req respond' -> do
  -- Check if PTY exists
  mInfo <- Pty.get (stPtyManager st) ptyId
  case mInfo of
    Nothing ->
      respond' $
        responseLBS
          status400
          [("Content-Type", "text/plain")]
          "PTY not found"
    Just _ -> do
      -- This handler is for non-WebSocket requests to the endpoint
      -- The actual WebSocket handling is done by the middleware
      respond' $
        responseLBS
          status400
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
    Nothing -> pure () -- Invalid path
    Just ptyId -> do
      -- Connect to PTY
      mConn <- Pty.connect (stPtyManager st) ptyId Nothing
      case mConn of
        Nothing -> pure () -- PTY not found
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
                  Left _ -> Pty.pcClose ptyConn -- Connection closed
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
    :<|> projectGetHandler
    :<|> projectCurrentHandler
    :<|> providerListHandler st
    :<|> providerAuthHandler st
    :<|> providerHandler
    :<|> providerOauthAuthorizeHandler
    :<|> providerOauthCallbackHandler
    :<|> authCreateHandler st
    :<|> authUpdateHandler st
    :<|> authDeleteHandler st
    :<|> agentHandler
    :<|> configHandler st
    :<|> commandHandler
    :<|> sessionStatusHandler
    :<|> sessionListHandler st
    :<|> sessionCreateHandler st
    :<|> sessionGetHandler st
    :<|> sessionDeleteHandler st
    :<|> sessionUpdateHandler st
    :<|> sessionChildrenHandler st
    :<|> sessionTodoHandler st
    :<|> sessionInitHandler st
    :<|> sessionForkHandler st
    :<|> sessionAbortHandler st
    :<|> sessionShareCreateHandler st
    :<|> sessionShareDeleteHandler st
    :<|> sessionDiffHandler st
    :<|> sessionSummarizeHandler st
    :<|> sessionCommandHandler st
    :<|> sessionShellHandler st
    :<|> sessionRevertHandler st
    :<|> sessionUnrevertHandler st
    :<|> sessionPermissionHandler st
    :<|> sessionMessageListHandler st
    :<|> sessionMessageCreateHandler st
    :<|> sessionMessageGetHandler st
    :<|> sessionMessagePartDeleteHandler st
    :<|> sessionMessagePartUpdateHandler st
    :<|> sessionPromptAsyncHandler st
    :<|> lspHandler
    :<|> vcsHandler
    :<|> permissionHandler
    :<|> permissionReplyHandler st
    :<|> questionHandler
    :<|> questionReplyHandler st
    :<|> questionRejectHandler st
    :<|> findHandler
    :<|> findFileHandler
    :<|> findSymbolHandler
    :<|> fileListHandler
    :<|> fileReadHandler
    :<|> fileStatusHandler
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
    -- TUI handlers
    :<|> tuiHandler st "append-prompt"
    :<|> tuiHandler st "open-help"
    :<|> tuiHandler st "open-sessions"
    :<|> tuiHandler st "open-themes"
    :<|> tuiHandler st "open-models"
    :<|> tuiHandler st "submit-prompt"
    :<|> tuiHandler st "clear-prompt"
    :<|> tuiHandler st "execute-command"
    :<|> tuiHandler st "show-toast"
    :<|> tuiHandler st "publish"
    :<|> tuiHandler st "select-session"
    :<|> tuiHandler st "control-next"
    :<|> tuiHandler st "control-response"
    :<|> instanceDisposeHandler st
    :<|> logHandler st
    :<|> skillHandler
    :<|> formatterHandler
    :<|> experimentalToolIdsHandler
    :<|> experimentalToolHandler
    :<|> experimentalWorktreeGetHandler st
    :<|> experimentalWorktreePostHandler st
    :<|> experimentalWorktreeResetHandler st
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
