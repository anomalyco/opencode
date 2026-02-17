{-# LANGUAGE OverloadedStrings #-}

module Main where

import Api
import Bus.Bus qualified as Bus
import Control.Concurrent (forkIO, threadDelay)
import Control.Exception (SomeException, try)
import Control.Monad (void)
import Data.Aeson (object)
import Data.ByteString qualified as BS
import Data.Text qualified as T
import Data.Text.Encoding qualified as TE
import Global.Event (globalEventHandler)
import Handlers
import Katip qualified
import Log qualified
import Network.HTTP.Types (methodOptions, status200)
import Network.Wai (Middleware, mapResponseHeaders, requestMethod, responseLBS)
import Network.Wai.Handler.Warp (run)
import Network.Wai.Handler.WebSockets (websocketsOr)
import Network.WebSockets (PendingConnection, acceptRequest, defaultConnectionOptions, pendingRequest, receiveData, requestPath, sendBinaryData)
import Pty.Connect (ptyConnectHandler)
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
        [ ("Access-Control-Allow-Origin", "*")
        , ("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
        , ("Access-Control-Allow-Headers", "Authorization, Content-Type, x-opencode-directory")
        ]

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
    healthHandler st
        :<|> pathHandler st
        :<|> globalConfigHandler
        :<|> projectListHandler st
        :<|> projectGetHandler st
        :<|> projectCurrentHandler st
        :<|> providerListHandler st
        :<|> providerAuthHandler st
        :<|> providerHandler
        :<|> providerOauthAuthorizeHandler st
        :<|> providerOauthCallbackHandler st
        :<|> authCreateHandler st
        :<|> authUpdateHandler st
        :<|> authDeleteHandler st
        :<|> agentHandler
        :<|> configHandler st
        :<|> commandHandler
        :<|> sessionStatusHandler st
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
        :<|> lspHandler st
        :<|> vcsHandler st
        :<|> permissionHandler st
        :<|> permissionReplyHandler st
        :<|> questionHandler st
        :<|> questionReplyHandler st
        :<|> questionRejectHandler st
        :<|> findHandler st
        :<|> findFileHandler st
        :<|> findSymbolHandler st
        :<|> fileListHandler
        :<|> fileReadHandler
        :<|> fileStatusHandler st
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
        :<|> tuiAppendPromptHandler st
        :<|> tuiOpenHandler st "open-help"
        :<|> tuiOpenHandler st "open-sessions"
        :<|> tuiOpenHandler st "open-themes"
        :<|> tuiOpenHandler st "open-models"
        :<|> tuiSubmitPromptHandler st
        :<|> tuiClearPromptHandler st
        :<|> tuiExecuteCommandHandler st
        :<|> tuiShowToastHandler st
        :<|> tuiPublishHandler st
        :<|> tuiSelectSessionHandler st
        :<|> tuiControlHandler st "next"
        :<|> tuiControlHandler st "response"
        :<|> instanceDisposeHandler st
        :<|> logHandler st
        :<|> skillHandler st
        :<|> formatterHandler st
        :<|> experimentalToolIdsHandler
        :<|> experimentalToolHandler st
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
    startPromptAsyncWorker state

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
