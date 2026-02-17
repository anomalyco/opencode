{-# LANGUAGE DisambiguateRecordFields #-}
{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE OverloadedStrings #-}

module Handlers where

import Control.Concurrent (forkIO)
import Control.Concurrent.STM
import Control.Exception (SomeException, catch)
import Control.Monad (forM)
import Control.Monad.IO.Class (liftIO)
import Data.Aeson (Value (..), object, (.=))
import Data.Aeson qualified
import Data.Aeson.Key qualified as K
import Data.Aeson.KeyMap qualified as KM
import Data.ByteString qualified as BS
import Data.ByteString.Base64 qualified as B64
import Data.Map.Strict qualified as Map
import Data.Maybe (fromMaybe)
import Data.Text (Text, pack, unpack)
import Data.Text qualified as T
import Data.Text.Encoding qualified as TE
import Data.Time.Clock (getCurrentTime)
import Data.Time.Clock.POSIX (utcTimeToPOSIXSeconds)
import Servant
import System.Directory (doesDirectoryExist, doesFileExist, getCurrentDirectory, getHomeDirectory, listDirectory, makeAbsolute)
import System.FilePath ((</>))

import Agent.Agent qualified as Agent
import Agent.Types qualified as AT
import Api
import Bus.Bus qualified as Bus
import Config.Config qualified as Config
import Experimental.Worktree qualified as Worktree
import Find.Search qualified as FindSearch
import Formatter.Status qualified as Formatter
import Health.Build qualified as HealthBuild
import Katip qualified
import LLM.Anthropic qualified as Anthropic
import LLM.OpenRouter qualified as OpenRouter
import LLM.Types qualified as LLMTypes
import Log qualified
import Lsp.Store qualified as LspStore
import Message.Parts qualified as Parts
import Message.Todo qualified as Todo
import Path.Build qualified as PathBuild
import Project.Build qualified as ProjectBuild
import Project.Discovery qualified as ProjectDiscovery
import Prompt.Async qualified as PromptAsync
import Provider.OAuth qualified as OAuth
import Provider.Provider qualified as Provider
import Provider.Types qualified as PT
import Proxy.Proxy qualified as Proxy
import Pty.Parse qualified as PtyParse
import Pty.Pty qualified as Pty
import Pty.Types qualified as PtyT
import Request.Store qualified as RequestStore
import Session.Session qualified as Sess
import Session.Status qualified as SessStatus
import Session.Types qualified as ST
import Skill.Skill qualified as Skill
import State
import Storage.Storage qualified as Storage
import System.Environment (lookupEnv)
import Tool.Defs qualified as Tool
import Tool.Exec qualified as ToolExec
import Tool.Types qualified as ToolT
import Tui.Store qualified as TuiStore
import Vcs.Diff qualified as Diff
import Vcs.Status qualified as VcsStatus

-- Helper to resolve paths
resolvePath :: Maybe Text -> Text -> IO FilePath
resolvePath mDir path = do
    base <- case mDir of
        Just d -> pure (unpack d)
        Nothing -> getCurrentDirectory
    makeAbsolute (base </> unpack path)

findMatches :: Text -> Text -> Maybe Text -> IO [Value]
findMatches _ _ _ = pure []

-- | Get session context from app state
sessionContext :: AppState -> Sess.SessionContext
sessionContext st =
    Sess.SessionContext
        { Sess.scStorage = stStorage st
        , Sess.scBus = stBus st
        , Sess.scProjectID = stProjectID st
        , Sess.scDirectory = stDirectory st
        , Sess.scVersion = stVersion st
        }

-- | Convert internal Session to API Session
toApiSession :: ST.Session -> Session
toApiSession s =
    Session
        { sesId = ST.sessionId s
        , sesSlug = ST.sessionSlug s
        , sesProjectId = ST.sessionProjectID s
        , sesDirectory = ST.sessionDirectory s
        , sesTitle = ST.sessionTitle s
        , sesVersion = ST.sessionVersion s
        , sesTime =
            SessionTime
                (ST.stCreated (ST.sessionTime s))
                (ST.stUpdated (ST.sessionTime s))
                (ST.stArchived (ST.sessionTime s))
        , sesParentId = ST.sessionParentID s
        , sesSummary = toApiSummary <$> ST.sessionSummary s
        , sesShare = toApiShare <$> ST.sessionShare s
        , sesRevert = toApiRevert <$> ST.sessionRevert s
        }

toApiSummary :: ST.SessionSummary -> SessionSummary
toApiSummary s =
    SessionSummary
        { ssAdditions = ST.ssAdditions s
        , ssDeletions = ST.ssDeletions s
        , ssFiles = ST.ssFiles s
        }

toApiShare :: ST.SessionShare -> SessionShare
toApiShare s = SessionShare{shareUrl = ST.shareUrl s}

toApiRevert :: ST.SessionRevert -> SessionRevert
toApiRevert r =
    SessionRevert
        { srMessageId = ST.revertMessageID r
        , srPartId = ST.revertPartID r
        , srSnapshot = ST.revertSnapshot r
        , srDiff = ST.revertDiff r
        }

toInternalSummary :: SessionSummary -> ST.SessionSummary
toInternalSummary s =
    ST.SessionSummary
        { ST.ssAdditions = ssAdditions s
        , ST.ssDeletions = ssDeletions s
        , ST.ssFiles = ssFiles s
        }

toInternalShare :: SessionShare -> ST.SessionShare
toInternalShare s = ST.SessionShare{ST.shareUrl = shareUrl s}

toInternalRevert :: SessionRevert -> ST.SessionRevert
toInternalRevert r =
    ST.SessionRevert
        { ST.revertMessageID = srMessageId r
        , ST.revertPartID = srPartId r
        , ST.revertSnapshot = srSnapshot r
        , ST.revertDiff = srDiff r
        }

-- | Convert API CreateSessionInput to internal
toInternalInput :: CreateSessionInput -> ST.CreateSessionInput
toInternalInput csi =
    ST.CreateSessionInput
        { ST.csiTitle = csiTitle csi
        , ST.csiParentID = csiParentId csi
        }

-- * Global Handlers

healthHandler :: AppState -> Handler Health
healthHandler st = return $ HealthBuild.buildHealth (stVersion st)

pathHandler :: AppState -> Handler PathInfo
pathHandler st = liftIO $ do
    cwd <- getCurrentDirectory
    home <- getHomeDirectory
    cfg <- Config.globalConfigPath
    let workdir = unpack (stDirectory st)
    let stateDir = workdir </> ".opencode" </> "state"
    return $
        PathBuild.buildPath
            (pack home)
            (pack stateDir)
            (pack cfg)
            (pack workdir)
            (pack cwd)

globalConfigHandler :: Handler Value
globalConfigHandler = liftIO $ do
    path <- Config.globalConfigPath
    cfg <- Config.loadFile path
    return $ Data.Aeson.toJSON $ fromMaybe Config.defaultConfig cfg

-- * Project Handlers

projectListHandler :: AppState -> Handler [Project]
projectListHandler st = liftIO $ do
    ProjectDiscovery.discoverProjects (unpack (stDirectory st))

projectCurrentHandler :: AppState -> Maybe Text -> Handler Project
projectCurrentHandler st mDir = liftIO $ do
    let dir = maybe (unpack (stDirectory st)) unpack mDir
    full <- makeAbsolute dir
    return $ ProjectBuild.projectFromDir full

projectGetHandler :: AppState -> Text -> Handler Project
projectGetHandler st pid = do
    let current = ProjectBuild.projectFromDir (unpack (stDirectory st))
    if Api.id current == pid
        then return current
        else throwError err404

-- * Provider/Config Handlers

providerListHandler :: AppState -> Handler ProviderList
providerListHandler _st = liftIO $ do
    providers <- Provider.list
    let providerJson = map toJSON providers
    -- Default model selection (first model of first provider)
    let defaultModel = case providers of
            (p : _) -> case Map.elems (PT.providerModels p) of
                (m : _) -> object ["providerID" .= PT.providerId p, "modelID" .= PT.modelId m]
                [] -> object []
            [] -> object []
    return $ ProviderList providerJson defaultModel
  where
    toJSON = Data.Aeson.toJSON

providerAuthHandler :: AppState -> Handler Value
providerAuthHandler _st = liftIO $ do
    providers <- Provider.list
    let entries = map (\p -> (PT.providerId p, map toMethod (PT.providerAuth p))) providers
    return $ object (map (\(pid, methods) -> K.fromText pid .= methods) entries)
  where
    toMethod method =
        let mtype = if PT.amType method == "oauth" then "oauth" else "api" :: Text
            label = if mtype == "oauth" then "OAuth" else "API key" :: Text
         in object ["type" .= mtype, "label" .= label]

providerHandler :: Handler [Value]
providerHandler = liftIO $ do
    providers <- Provider.list
    return $ map Data.Aeson.toJSON providers

providerOauthAuthorizeHandler :: AppState -> Text -> Value -> Handler Value
providerOauthAuthorizeHandler st pid input = liftIO $ do
    state <- OAuth.generateState
    let redirect = case extractText input "redirectURI" of
            Just r -> Just r
            Nothing -> case extractText input "redirect" of
                Just r -> Just r
                Nothing -> extractText input "redirect_uri"
    let scopes = extractTextList input "scopes"
    let url = OAuth.buildAuthorizeUrl pid state redirect scopes
    let payload = object ["providerID" .= pid, "state" .= state, "url" .= url]
    Storage.write (stStorage st) ["auth", "oauth", pid] (object ["state" .= state, "redirect" .= redirect])
    return payload

providerOauthCallbackHandler :: AppState -> Text -> Value -> Handler Value
providerOauthCallbackHandler st pid input = liftIO $ do
    stored <-
        (Just <$> Storage.read (stStorage st) ["auth", "oauth", pid])
            `catch` \(Storage.NotFoundError _) -> return Nothing
    let provided = extractText input "state"
    let storedState = stored >>= \val -> extractText val "state"
    case (storedState, provided) of
        (Just s, Just p) | s == p -> do
            case extractToken input of
                Nothing -> return $ object ["providerID" .= pid, "authenticated" .= False, "ok" .= True]
                Just token -> do
                    Provider.setAuth (stStorage st) pid token
                    return $ object ["providerID" .= pid, "authenticated" .= True, "ok" .= True]
        _ -> return $ object ["providerID" .= pid, "error" .= ("invalid_state" :: Text), "ok" .= False]

authCreateHandler :: AppState -> Text -> Value -> Handler Value
authCreateHandler st pid input = liftIO $ do
    case extractToken input of
        Nothing -> return $ object ["providerID" .= pid, "authenticated" .= False]
        Just token -> do
            Provider.setAuth (stStorage st) pid token
            return $ object ["providerID" .= pid, "authenticated" .= True]

authUpdateHandler :: AppState -> Text -> Value -> Handler Value
authUpdateHandler = authCreateHandler

authDeleteHandler :: AppState -> Text -> Handler Value
authDeleteHandler st pid = liftIO $ do
    Provider.removeAuth (stStorage st) pid
    return $ object ["providerID" .= pid, "authenticated" .= False]

extractToken :: Value -> Maybe Text
extractToken (Object obj) = case KM.lookup "token" obj of
    Just (String t) -> Just t
    _ -> case KM.lookup "apiKey" obj of
        Just (String t) -> Just t
        _ -> Nothing
extractToken _ = Nothing

extractText :: Value -> Text -> Maybe Text
extractText (Object obj) key = case KM.lookup (K.fromText key) obj of
    Just (String t) -> Just t
    _ -> Nothing
extractText _ _ = Nothing

extractTextList :: Value -> Text -> [Text]
extractTextList (Object obj) key = case KM.lookup (K.fromText key) obj of
    Just (Array xs) -> foldr collect [] xs
    _ -> []
  where
    collect (String t) acc = t : acc
    collect _ acc = acc
extractTextList _ _ = []

configHandler :: AppState -> Handler Value
configHandler st = liftIO $ do
    cfg <- Config.get (unpack (stDirectory st))
    return $ Data.Aeson.toJSON cfg

commandHandler :: Handler [Value]
commandHandler = return Tool.toolDefinitions

agentHandler :: Handler [Value]
agentHandler = liftIO $ do
    agents <- Agent.list
    -- Filter out hidden agents
    let visible = filter (not . maybe False Prelude.id . AT.agentHidden) agents
    return $ map Data.Aeson.toJSON visible

-- * Session Handlers

sessionStatusHandler :: AppState -> Handler Value
sessionStatusHandler st = liftIO $ do
    let ctx = sessionContext st
    sessions <- Sess.list ctx Nothing Nothing
    ptys <- Pty.list (stPtyManager st)
    let status = SessStatus.buildStatus (length sessions) (length ptys)
    return $ Data.Aeson.toJSON status

sessionListHandler :: AppState -> Maybe Text -> Maybe Bool -> Maybe Int -> Handler [Session]
sessionListHandler st _mDir mRoots mLimit = liftIO $ do
    let ctx = sessionContext st
    sessions <- Sess.list ctx mRoots mLimit
    return $ map toApiSession sessions

sessionCreateHandler :: AppState -> Maybe Text -> CreateSessionInput -> Handler Session
sessionCreateHandler st _mDir input = liftIO $ do
    let ctx = sessionContext st
    session <- Sess.create ctx (toInternalInput input)
    return $ toApiSession session

sessionGetHandler :: AppState -> Text -> Handler Session
sessionGetHandler st sid = do
    let ctx = sessionContext st
    msession <- liftIO $ Sess.get ctx sid
    case msession of
        Nothing -> throwError err404
        Just session -> return $ toApiSession session

sessionDeleteHandler :: AppState -> Text -> Handler Bool
sessionDeleteHandler st sid = liftIO $ do
    let ctx = sessionContext st
    Sess.delete ctx sid

sessionUpdateHandler :: AppState -> Text -> UpdateSessionInput -> Handler Session
sessionUpdateHandler st sid input = do
    let ctx = sessionContext st
    msession <- liftIO $ Sess.update ctx sid (applyUpdate input)
    case msession of
        Nothing -> throwError err404
        Just session -> return $ toApiSession session
  where
    applyUpdate usi s =
        let title = case usiTitle usi of
                Just t -> t
                Nothing -> ST.sessionTitle s
            summary = case usiSummary usi of
                Just v -> Just (toInternalSummary v)
                Nothing -> ST.sessionSummary s
            share = case usiShare usi of
                Just v -> Just (toInternalShare v)
                Nothing -> ST.sessionShare s
            revert = case usiRevert usi of
                Just v -> Just (toInternalRevert v)
                Nothing -> ST.sessionRevert s
         in s
                { ST.sessionTitle = title
                , ST.sessionSummary = summary
                , ST.sessionShare = share
                , ST.sessionRevert = revert
                }

sessionChildrenHandler :: AppState -> Text -> Handler [Session]
sessionChildrenHandler st sid = liftIO $ do
    let ctx = sessionContext st
    sessions <- Sess.list ctx Nothing Nothing
    let children = filter (\s -> ST.sessionParentID s == Just sid) sessions
    return $ map toApiSession children

sessionTodoHandler :: AppState -> Text -> Handler [Value]
sessionTodoHandler st sid = liftIO $ do
    let key = ["todo", sid]
    result <-
        (Just <$> Storage.read (stStorage st) key)
            `catch` \(Storage.NotFoundError _) -> return Nothing
    case result of
        Nothing -> return []
        Just todos -> return todos

sessionInitHandler :: AppState -> Text -> Handler Value
sessionInitHandler st sid = liftIO $ do
    Bus.publish (stBus st) "session.initialized" (object ["sessionID" .= sid])
    return $ object ["sessionID" .= sid, "initialized" .= True]

sessionForkHandler :: AppState -> Text -> Handler Session
sessionForkHandler st sid = liftIO $ do
    let ctx = sessionContext st
    parent <- Sess.get ctx sid
    let title = case parent of
            Just p -> Just ("Fork of " <> ST.sessionTitle p)
            Nothing -> Just "Forked session"
    session <-
        Sess.create
            ctx
            ST.CreateSessionInput
                { ST.csiTitle = title
                , ST.csiParentID = Just sid
                }
    return $ toApiSession session

sessionAbortHandler :: AppState -> Text -> Handler Value
sessionAbortHandler st sid = liftIO $ do
    Bus.publish (stBus st) "session.error" (object ["sessionID" .= sid, "aborted" .= True])
    return $ object ["sessionID" .= sid, "aborted" .= True]

sessionShareCreateHandler :: AppState -> Text -> Handler SessionShare
sessionShareCreateHandler st sid = do
    let ctx = sessionContext st
    msession <- liftIO $ Sess.update ctx sid (setShare sid)
    case msession of
        Nothing -> throwError err404
        Just session -> case ST.sessionShare session of
            Nothing -> throwError err500
            Just share -> return $ toApiShare share
  where
    setShare sid' s =
        let url = "https://share.opencode.ai/session/" <> sid'
         in s{ST.sessionShare = Just (ST.SessionShare url)}

sessionShareDeleteHandler :: AppState -> Text -> Handler Bool
sessionShareDeleteHandler st sid = liftIO $ do
    let ctx = sessionContext st
    updated <- Sess.update ctx sid (\s -> s{ST.sessionShare = Nothing})
    return $ case updated of
        Nothing -> False
        Just _ -> True

sessionDiffHandler :: AppState -> Text -> Handler Value
sessionDiffHandler st sid = liftIO $ do
    mresult <- Diff.loadDiff (unpack (stDirectory st))
    case mresult of
        Nothing ->
            return $
                object
                    [ "sessionID" .= sid
                    , "diff" .= ("" :: Text)
                    , "summary" .= toApiSummary (ST.SessionSummary 0 0 (Just 0))
                    ]
        Just (diff, summary) ->
            return $
                object
                    [ "sessionID" .= sid
                    , "diff" .= diff
                    , "summary" .= toApiSummary summary
                    ]

sessionSummarizeHandler :: AppState -> Text -> Handler SessionSummary
sessionSummarizeHandler st sid = do
    let ctx = sessionContext st
    summary <- liftIO $ loadSummary (unpack (stDirectory st))
    msession <- liftIO $ Sess.update ctx sid (\s -> s{ST.sessionSummary = Just summary})
    case msession of
        Nothing -> throwError err404
        Just _ -> return $ toApiSummary summary

loadSummary :: FilePath -> IO ST.SessionSummary
loadSummary root = do
    mresult <- Diff.loadDiff root
    case mresult of
        Nothing -> pure (ST.SessionSummary 0 0 (Just 0))
        Just (_, summary) -> pure summary

sessionCommandHandler :: AppState -> Text -> Value -> Handler Value
sessionCommandHandler st sid input = liftIO $ do
    let ctx =
            ToolT.ToolContext
                { ToolT.tcSessionID = sid
                , ToolT.tcMessageID = "command"
                , ToolT.tcWorkdir = unpack (stDirectory st)
                }
    output <- ToolExec.execute ctx "bash" input
    let payload =
            object
                [ "sessionID" .= sid
                , "output" .= ToolT.toOutput output
                , "error" .= ToolT.toIsError output
                ]
    Bus.publish (stBus st) "command.executed" payload
    return payload

sessionShellHandler :: AppState -> Text -> Value -> Handler Value
sessionShellHandler st sid input = liftIO $ do
    let ptyInput =
            (PtyParse.parseInput input)
                { PtyT.cpiSessionId = Just sid
                }
    result <- Pty.create (stPtyManager st) ptyInput
    case result of
        Left err -> return $ object ["error" .= err]
        Right info -> do
            Bus.publish (stBus st) "pty.created" (object ["info" .= info, "sessionID" .= sid])
            return $ Data.Aeson.toJSON info

sessionRevertHandler :: AppState -> Text -> SessionRevert -> Handler SessionRevert
sessionRevertHandler st sid input = do
    let ctx = sessionContext st
    msession <- liftIO $ Sess.update ctx sid (\s -> s{ST.sessionRevert = Just (toInternalRevert input)})
    case msession of
        Nothing -> throwError err404
        Just _ -> return input

sessionUnrevertHandler :: AppState -> Text -> Handler Bool
sessionUnrevertHandler st sid = liftIO $ do
    let ctx = sessionContext st
    updated <- Sess.update ctx sid (\s -> s{ST.sessionRevert = Nothing})
    return $ case updated of
        Nothing -> False
        Just _ -> True

sessionPermissionHandler :: AppState -> Text -> Text -> Value -> Handler Value
sessionPermissionHandler st sid pid input = liftIO $ do
    Bus.publish (stBus st) "permission.replied" (object ["sessionID" .= sid, "permissionID" .= pid, "response" .= input])
    return $ object ["sessionID" .= sid, "permissionID" .= pid, "ok" .= True]

-- * Message Handlers (still in-memory for now, TODO: port to storage)

sessionMessageListHandler :: AppState -> Text -> Maybe Int -> Handler [Message]
sessionMessageListHandler st sid _mLimit = liftIO $ do
    -- Read messages from storage
    let key = ["message", sid]
    msgs <-
        (Storage.list (stStorage st) key >>= mapM (Storage.read (stStorage st)))
            `catch` \(Storage.NotFoundError _) -> return []
    return msgs

sessionMessageCreateHandler :: AppState -> Text -> CreateMessageInput -> Handler Message
sessionMessageCreateHandler st sid input = liftIO $ do
    createMessageIO st sid input

createMessageIO :: AppState -> Text -> CreateMessageInput -> IO Message
createMessageIO st sid input = do
    let lg = Log.withNS (stLogger st) "message"

    now <- getCurrentTime
    let t = realToFrac (utcTimeToPOSIXSeconds now) * 1000
    let msgTime = SessionTime t t Nothing

    -- Extract user text for logging
    let userText = extractUserText (cmiParts input)
    Log.logMsg lg Katip.InfoS $ "create session=" <> sid <> " text=" <> T.take 50 userText

    -- 1. User Message
    let uMsgId = fromMaybe (pack ("msg_" ++ show (round t :: Integer))) (cmiMessageId input)
    let uMsg =
            Message
                { msgInfo = MessageInfo uMsgId sid "user" msgTime
                , msgParts = cmiParts input
                }

    -- 2. Assistant Message (incomplete initially)
    let aMsgId = pack ("msg_" ++ show (round t + 1 :: Integer))
    let partId = pack ("part_" ++ show (round t :: Integer))
    let aMsg =
            Message
                { msgInfo = MessageInfo aMsgId sid "assistant" msgTime
                , msgParts = []
                }

    -- Write to storage
    Storage.write (stStorage st) ["message", sid, uMsgId] uMsg
    Storage.write (stStorage st) ["message", sid, aMsgId] aMsg

    let todos = Todo.extractTodos (cmiParts input)
    case todos of
        [] -> pure ()
        _ -> Storage.write (stStorage st) ["todo", sid] todos

    -- Publish user message event (send just info, not full message)
    let userInfo =
            object
                [ "id" .= uMsgId
                , "sessionID" .= sid
                , "role" .= ("user" :: Text)
                , "time" .= object ["created" .= t]
                , "parentID" .= (Nothing :: Maybe Text)
                ]
    Bus.publish (stBus st) "message.updated" (object ["info" .= userInfo])

    -- Publish assistant message (incomplete - no time.completed)
    let assistantInfo =
            object
                [ "id" .= aMsgId
                , "sessionID" .= sid
                , "role" .= ("assistant" :: Text)
                , "time" .= object ["created" .= t]
                , "parentID" .= uMsgId
                , "modelID" .= ("anthropic/claude-opus-4.5" :: Text)
                , "providerID" .= ("openrouter" :: Text)
                , "mode" .= ("build" :: Text)
                , "agent" .= ("build" :: Text)
                , "path" .= object ["cwd" .= stDirectory st, "root" .= stDirectory st]
                , "cost" .= (0 :: Double)
                , "tokens"
                    .= object
                        [ "input" .= (0 :: Int)
                        , "output" .= (0 :: Int)
                        , "reasoning" .= (0 :: Int)
                        , "cache" .= object ["read" .= (0 :: Int), "write" .= (0 :: Int)]
                        ]
                ]
    Bus.publish (stBus st) "message.updated" (object ["info" .= assistantInfo])

    -- Spawn LLM streaming task
    _ <-
        forkIO $
            ( do
                apiKey <- lookupEnv "OPENROUTER_API_KEY"
                case apiKey of
                    Nothing -> do
                        -- No API key - send error
                        let errPart =
                                object
                                    [ "id" .= partId
                                    , "sessionID" .= sid
                                    , "messageID" .= aMsgId
                                    , "type" .= ("text" :: Text)
                                    , "text" .= ("Error: OPENROUTER_API_KEY not set" :: Text)
                                    ]
                        Bus.publish (stBus st) "message.part.updated" (object ["part" .= errPart])
                        completeMessage st sid aMsgId t
                    Just key -> do
                        client <- OpenRouter.newClient (pack key)
                        textRef <- newTVarIO ("" :: Text)

                        let req =
                                OpenRouter.ChatRequest
                                    { OpenRouter.crModel = "anthropic/claude-opus-4.5"
                                    , OpenRouter.crMessages = [OpenRouter.Message OpenRouter.User userText]
                                    , OpenRouter.crMaxTokens = Just 4096
                                    , OpenRouter.crTemperature = Nothing
                                    , OpenRouter.crStream = True
                                    }

                        result <- OpenRouter.chatStream client req $ \delta -> do
                            -- Accumulate text
                            atomically $ modifyTVar' textRef (<> delta)
                            fullText <- readTVarIO textRef

                            -- Publish text part update with accumulated text
                            let textPart =
                                    object
                                        [ "id" .= partId
                                        , "sessionID" .= sid
                                        , "messageID" .= aMsgId
                                        , "type" .= ("text" :: Text)
                                        , "text" .= fullText
                                        ]
                            Bus.publish (stBus st) "message.part.updated" (object ["part" .= textPart, "delta" .= delta])

                        case result of
                            Left err -> do
                                -- Publish error as final part
                                fullText <- readTVarIO textRef
                                let errText = fullText <> "\n\n[Error: " <> err <> "]"
                                let textPart =
                                        object
                                            [ "id" .= partId
                                            , "sessionID" .= sid
                                            , "messageID" .= aMsgId
                                            , "type" .= ("text" :: Text)
                                            , "text" .= errText
                                            ]
                                Bus.publish (stBus st) "message.part.updated" (object ["part" .= textPart])
                            Right () -> pure ()

                        completeMessage st sid aMsgId t
            )
                `catch` \(_e :: SomeException) -> pure ()

    return aMsg

sessionMessageGetHandler :: AppState -> Text -> Text -> Handler Message
sessionMessageGetHandler st sid msgId = do
    let key = ["message", sid, msgId]
    result <-
        liftIO $
            (Just <$> Storage.read (stStorage st) key)
                `catch` \(Storage.NotFoundError _) -> return Nothing
    case result of
        Nothing -> throwError err404
        Just msg -> return msg

sessionMessagePartDeleteHandler :: AppState -> Text -> Text -> Text -> Handler Bool
sessionMessagePartDeleteHandler st sid msgId partId = do
    let key = ["message", sid, msgId]
    result <-
        liftIO $
            (Just <$> Storage.read (stStorage st) key)
                `catch` \(Storage.NotFoundError _) -> return Nothing
    case result of
        Nothing -> throwError err404
        Just msg -> do
            let updated = Parts.deletePart partId (msgParts msg)
            case updated of
                Nothing -> throwError err404
                Just parts -> do
                    let next = msg{msgParts = parts}
                    liftIO $ Storage.write (stStorage st) key next
                    liftIO $ Bus.publish (stBus st) "message.part.removed" (object ["sessionID" .= sid, "messageID" .= msgId, "partID" .= partId])
                    return True

sessionMessagePartUpdateHandler :: AppState -> Text -> Text -> Text -> Value -> Handler Value
sessionMessagePartUpdateHandler st sid msgId partId input = do
    let key = ["message", sid, msgId]
    let bodySession = extractText input "sessionID"
    let bodyMessage = extractText input "messageID"
    let bodyPart = extractText input "id"
    case (bodySession, bodyMessage, bodyPart) of
        (Just s, Just m, Just p) -> do
            if s /= sid || m /= msgId || p /= partId
                then throwError err400
                else pure ()
        _ -> throwError err400
    result <-
        liftIO $
            (Just <$> Storage.read (stStorage st) key)
                `catch` \(Storage.NotFoundError _) -> return Nothing
    case result of
        Nothing -> throwError err404
        Just msg -> do
            let updated = replacePart partId input (msgParts msg)
            case updated of
                Nothing -> throwError err404
                Just parts -> do
                    let next = msg{msgParts = parts}
                    liftIO $ Storage.write (stStorage st) key next
                    let mpart = Parts.findPart partId parts
                    case mpart of
                        Nothing -> throwError err404
                        Just part -> do
                            liftIO $ Bus.publish (stBus st) "message.part.updated" (object ["part" .= part])
                            return part
  where
    replacePart pid part parts =
        if any (\p -> partKey p == Just pid) parts
            then Just (map (\p -> if partKey p == Just pid then part else p) parts)
            else Nothing
    partKey (Object obj) = case KM.lookup "id" obj of
        Just (String t) -> Just t
        _ -> case KM.lookup "partID" obj of
            Just (String t) -> Just t
            _ -> Nothing
    partKey _ = Nothing

sessionPromptAsyncHandler :: AppState -> Text -> CreateMessageInput -> Handler Value
sessionPromptAsyncHandler st sid input = liftIO $ do
    reqId <- RequestStore.generateId
    let job = PromptAsync.PromptAsyncJob reqId sid input
    let payload = PromptAsync.queuedPayload sid reqId input
    Storage.write (stStorage st) (PromptAsync.promptAsyncKey sid reqId) payload
    appendPromptAsyncIndex (stStorage st) sid reqId
    atomically $ writeTQueue (stPromptAsyncQueue st) job
    Bus.publish (stBus st) "prompt.async.queued" payload
    return $ object ["requestID" .= reqId, "queued" .= True]

startPromptAsyncWorker :: AppState -> IO ()
startPromptAsyncWorker st = do
    _ <- forkIO $ promptAsyncLoop st
    pure ()

promptAsyncLoop :: AppState -> IO ()
promptAsyncLoop st = do
    job <- atomically $ readTQueue (stPromptAsyncQueue st)
    processPromptAsync st job
    promptAsyncLoop st

processPromptAsync :: AppState -> PromptAsync.PromptAsyncJob -> IO ()
processPromptAsync st job = do
    let sid = PromptAsync.pajSessionId job
    let reqId = PromptAsync.pajRequestId job
    let started = PromptAsync.startedPayload sid reqId
    Storage.write (stStorage st) (PromptAsync.promptAsyncKey sid reqId) started
    Bus.publish (stBus st) "prompt.async.started" started
    result <-
        (Just <$> createMessageIO st sid (PromptAsync.pajInput job))
            `catch` \(err :: SomeException) -> do
                let payload = PromptAsync.failedPayload sid reqId (T.pack (show err))
                Storage.write (stStorage st) (PromptAsync.promptAsyncKey sid reqId) payload
                Bus.publish (stBus st) "prompt.async.failed" payload
                pure Nothing
    case result of
        Nothing -> pure ()
        Just msg -> do
            let mid = msgId (msgInfo msg)
            let payload = PromptAsync.completedPayload sid reqId mid
            Storage.write (stStorage st) (PromptAsync.promptAsyncKey sid reqId) payload
            Bus.publish (stBus st) "prompt.async.completed" payload

appendPromptAsyncIndex :: Storage.StorageConfig -> Text -> Text -> IO ()
appendPromptAsyncIndex storage sid reqId = do
    result <- (Just <$> Storage.read storage (PromptAsync.promptAsyncIndexKey sid)) `catch` \(Storage.NotFoundError _) -> pure Nothing
    let next =
            case result of
                Just ids -> if reqId `elem` ids then ids else ids ++ [reqId]
                Nothing -> [reqId]
    Storage.write storage (PromptAsync.promptAsyncIndexKey sid) next

-- | Extract text content from user message parts
extractUserText :: [Value] -> Text
extractUserText parts = T.intercalate "\n" $ concatMap extractTextPart parts
  where
    extractTextPart (Object obj) = case KM.lookup "type" obj of
        Just (String "text") -> case KM.lookup "text" obj of
            Just (String txt) -> [txt]
            _ -> []
        _ -> []
    extractTextPart _ = []

-- | Mark message as complete and publish idle event
completeMessage :: AppState -> Text -> Text -> Double -> IO ()
completeMessage st sid msgId startTime = do
    let lg = Log.withNS (stLogger st) "message"

    now <- getCurrentTime
    let endTime = realToFrac (utcTimeToPOSIXSeconds now) * 1000 :: Double
    let duration = (endTime - startTime) / 1000 -- seconds
    Log.logMsg lg Katip.InfoS $ "complete session=" <> sid <> " msg=" <> msgId <> " duration=" <> T.pack (show duration) <> "s"

    -- Publish completed message info
    let completedInfo =
            object
                [ "id" .= msgId
                , "sessionID" .= sid
                , "role" .= ("assistant" :: Text)
                , "time" .= object ["created" .= startTime, "completed" .= endTime]
                , "parentID" .= (msgId :: Text) -- TODO: actual parent
                , "modelID" .= ("anthropic/claude-opus-4.5" :: Text)
                , "providerID" .= ("openrouter" :: Text)
                , "mode" .= ("build" :: Text)
                , "agent" .= ("build" :: Text)
                , "path" .= object ["cwd" .= stDirectory st, "root" .= stDirectory st]
                , "cost" .= (0 :: Double)
                , "tokens"
                    .= object
                        [ "input" .= (0 :: Int)
                        , "output" .= (0 :: Int)
                        , "reasoning" .= (0 :: Int)
                        , "cache" .= object ["read" .= (0 :: Int), "write" .= (0 :: Int)]
                        ]
                , "finish" .= ("end_turn" :: Text)
                ]
    Bus.publish (stBus st) "message.updated" (object ["info" .= completedInfo])

    -- Publish session idle
    Bus.publish (stBus st) "session.idle" (object ["sessionID" .= sid])

-- * File Handlers

fileListHandler :: Maybe Text -> Text -> Handler [FileNode]
fileListHandler mDir path = liftIO $ do
    fullPath <- resolvePath mDir path
    exists <- doesDirectoryExist fullPath
    if not exists
        then return []
        else do
            contents <- listDirectory fullPath
            nodes <- forM contents $ \name -> do
                let itemPath = fullPath </> name
                isDir <- doesDirectoryExist itemPath
                let type_ = if isDir then FileTypeDirectory else FileTypeFile
                let relPath =
                        if unpack path == "" || unpack path == "." || unpack path == "/"
                            then name
                            else unpack path </> name
                return $
                    FileNode
                        { fnName = pack name
                        , fnPath = pack relPath
                        , fnAbsolute = pack itemPath
                        , fnType = type_
                        , fnIgnored = False
                        }
            return nodes

fileReadHandler :: Maybe Text -> Text -> Handler FileContent
fileReadHandler mDir path = liftIO $ do
    fullPath <- resolvePath mDir path
    bytes <- BS.readFile fullPath
    case (hasNull bytes, TE.decodeUtf8' bytes) of
        (True, _) -> return $ FileContent ContentTypeBinary (encodeBase64 bytes)
        (False, Left _) -> return $ FileContent ContentTypeBinary (encodeBase64 bytes)
        (False, Right text) -> return $ FileContent ContentTypeText text

hasNull :: BS.ByteString -> Bool
hasNull = BS.any (== 0)

encodeBase64 :: BS.ByteString -> Text
encodeBase64 = TE.decodeUtf8 . B64.encode

-- * Stubs

lspHandler :: AppState -> Handler [Value]
lspHandler st = liftIO $ do
    LspStore.getDiagnostics (stStorage st)

vcsHandler :: AppState -> Handler VcsInfo
vcsHandler st = liftIO $ do
    let root = unpack (stDirectory st)
    branchName <- VcsStatus.loadBranch root
    return $ VcsInfo branchName

permissionHandler :: AppState -> Handler [Value]
permissionHandler st = liftIO $ do
    RequestStore.listRequests (stStorage st) "permission"

questionHandler :: AppState -> Handler [Value]
questionHandler st = liftIO $ do
    RequestStore.listRequests (stStorage st) "question"

questionReplyHandler :: AppState -> Text -> Value -> Handler Value
questionReplyHandler st rid input = liftIO $ do
    let payload = object ["requestID" .= rid, "reply" .= input, "status" .= ("replied" :: Text)]
    RequestStore.writeRequest (stStorage st) "question" rid payload
    Bus.publish (stBus st) "question.replied" payload
    return payload

questionRejectHandler :: AppState -> Text -> Value -> Handler Value
questionRejectHandler st rid input = liftIO $ do
    let payload = object ["requestID" .= rid, "reject" .= input, "status" .= ("rejected" :: Text)]
    RequestStore.writeRequest (stStorage st) "question" rid payload
    Bus.publish (stBus st) "question.rejected" payload
    return payload

permissionReplyHandler :: AppState -> Text -> Value -> Handler Value
permissionReplyHandler st rid input = liftIO $ do
    let payload = object ["requestID" .= rid, "reply" .= input, "status" .= ("replied" :: Text)]
    RequestStore.writeRequest (stStorage st) "permission" rid payload
    Bus.publish (stBus st) "permission.replied" payload
    return payload

findHandler :: AppState -> Maybe Text -> Maybe Text -> Maybe Text -> Handler [Value]
findHandler st mQuery mPattern mDir = liftIO $ do
    let root = maybe (unpack (stDirectory st)) unpack mDir
    case (mQuery, mPattern) of
        (Just q, _) -> FindSearch.findText root q
        (Nothing, Just p) -> FindSearch.findText root p
        (Nothing, Nothing) -> pure []

findFileHandler :: AppState -> Maybe Text -> Maybe Text -> Handler [Value]
findFileHandler st mPattern mDir = liftIO $ do
    let root = maybe (unpack (stDirectory st)) unpack mDir
    case mPattern of
        Nothing -> pure []
        Just p -> FindSearch.findFile root p

findSymbolHandler :: AppState -> Maybe Text -> Maybe Text -> Handler [Value]
findSymbolHandler st mQuery mDir = liftIO $ do
    let root = maybe (unpack (stDirectory st)) unpack mDir
    case mQuery of
        Nothing -> pure []
        Just q -> FindSearch.findSymbol root q

fileStatusHandler :: AppState -> Maybe Text -> Maybe Text -> Handler [Value]
fileStatusHandler st mDir mPath = liftIO $ do
    let base = maybe (unpack (stDirectory st)) unpack mDir
    statuses <- VcsStatus.loadStatus base
    case mPath of
        Nothing -> return $ map Data.Aeson.toJSON statuses
        Just path -> do
            let filtered = filter (\s -> VcsStatus.fsPath s == path) statuses
            case filtered of
                [] -> do
                    fullPath <- resolvePath mDir path
                    exists <- doesFileExist fullPath
                    return [object ["path" .= path, "status" .= ("clean" :: Text), "exists" .= exists]]
                _ -> return $ map Data.Aeson.toJSON filtered

tuiAppendPromptHandler :: AppState -> Value -> Handler Value
tuiAppendPromptHandler st input = liftIO $ do
    let text = case extractText input "text" of
            Just t -> t
            Nothing -> fromMaybe "" (extractText input "prompt")
    prompt <- TuiStore.appendPrompt (stStorage st) text
    let payload = object ["prompt" .= prompt]
    Bus.publish (stBus st) "tui.append-prompt" payload
    return payload

tuiOpenHandler :: AppState -> Text -> Value -> Handler Value
tuiOpenHandler st name input = liftIO $ do
    let payload = object ["panel" .= name, "payload" .= input]
    TuiStore.setLast (stStorage st) payload
    Bus.publish (stBus st) ("tui." <> name) payload
    return $ object ["ok" .= True]

tuiSubmitPromptHandler :: AppState -> Value -> Handler Value
tuiSubmitPromptHandler st _ = liftIO $ do
    prompt <- TuiStore.submitPrompt (stStorage st)
    let payload = object ["prompt" .= prompt]
    Bus.publish (stBus st) "tui.submit-prompt" payload
    return payload

tuiClearPromptHandler :: AppState -> Value -> Handler Value
tuiClearPromptHandler st _ = liftIO $ do
    TuiStore.clearPrompt (stStorage st)
    Bus.publish (stBus st) "tui.clear-prompt" (object [])
    return $ object ["ok" .= True]

tuiExecuteCommandHandler :: AppState -> Value -> Handler Value
tuiExecuteCommandHandler st input = liftIO $ do
    TuiStore.setLast (stStorage st) input
    Bus.publish (stBus st) "tui.execute-command" (object ["payload" .= input])
    return $ object ["ok" .= True]

tuiShowToastHandler :: AppState -> Value -> Handler Value
tuiShowToastHandler st input = liftIO $ do
    TuiStore.setLast (stStorage st) input
    Bus.publish (stBus st) "tui.show-toast" (object ["payload" .= input])
    return $ object ["ok" .= True]

tuiPublishHandler :: AppState -> Value -> Handler Value
tuiPublishHandler st input = liftIO $ do
    TuiStore.setLast (stStorage st) input
    Bus.publish (stBus st) "tui.publish" (object ["payload" .= input])
    return $ object ["ok" .= True]

tuiSelectSessionHandler :: AppState -> Value -> Handler Value
tuiSelectSessionHandler st input = liftIO $ do
    TuiStore.setLast (stStorage st) input
    Bus.publish (stBus st) "tui.select-session" (object ["payload" .= input])
    return $ object ["ok" .= True]

tuiControlHandler :: AppState -> Text -> Value -> Handler Value
tuiControlHandler st name input = liftIO $ do
    let payload = object ["control" .= name, "payload" .= input]
    TuiStore.setLast (stStorage st) payload
    Bus.publish (stBus st) ("tui.control." <> name) payload
    return $ object ["ok" .= True]

instanceDisposeHandler :: AppState -> Handler Value
instanceDisposeHandler st = liftIO $ do
    case stProxy st of
        Nothing -> pure ()
        Just proxy -> Proxy.stop proxy
    Bus.publish (stBus st) "server.instance.disposed" (object [])
    return $ object ["disposed" .= True]

logHandler :: AppState -> Value -> Handler Value
logHandler st input = liftIO $ do
    let lg = Log.withNS (stLogger st) "client"
    Log.logMsg lg Katip.InfoS $ "log " <> T.pack (show input)
    return $ object ["ok" .= True]

skillHandler :: AppState -> Maybe Text -> Handler [Skill.SkillInfo]
skillHandler st mDir = liftIO $ do
    let dir = maybe (unpack (stDirectory st)) unpack mDir
    Skill.listSkills dir

formatterHandler :: AppState -> Maybe Text -> Handler [Formatter.FormatterStatus]
formatterHandler st mDir = liftIO $ do
    let dir = maybe (unpack (stDirectory st)) unpack mDir
    Formatter.statusFor dir

experimentalToolIdsHandler :: Handler [Text]
experimentalToolIdsHandler = return $ map ToolT.tdName Tool.allTools

experimentalToolHandler :: AppState -> Value -> Handler Value
experimentalToolHandler st input = liftIO $ do
    let name = case extractText input "name" of
            Just t -> t
            Nothing -> "unknown"
    let payload = object ["name" .= name, "input" .= input]
    RequestStore.writeRequest (stStorage st) "experimental-tool" name payload
    return payload

experimentalWorktreeGetHandler :: AppState -> Handler Value
experimentalWorktreeGetHandler st = liftIO $ do
    Worktree.getInfo (stStorage st) (stDirectory st)

experimentalWorktreePostHandler :: AppState -> Value -> Handler Value
experimentalWorktreePostHandler st input = liftIO $ do
    Worktree.setInfo (stStorage st) input

experimentalWorktreeResetHandler :: AppState -> Value -> Handler Value
experimentalWorktreeResetHandler st _ = liftIO $ do
    Worktree.resetInfo (stStorage st) (stDirectory st)

-- * PTY Handlers (sandboxed terminals)

ptyListHandler :: AppState -> Handler [Value]
ptyListHandler st = liftIO $ do
    sessions <- Pty.list (stPtyManager st)
    return $ map Data.Aeson.toJSON sessions

ptyCreateHandler :: AppState -> Value -> Handler Value
ptyCreateHandler st input = liftIO $ do
    let ptyInput = PtyParse.parseInput input
    result <- Pty.create (stPtyManager st) ptyInput
    case result of
        Left err -> return $ object ["error" .= err]
        Right info -> do
            -- Publish event
            Bus.publish (stBus st) "pty.created" (object ["info" .= info])
            return $ Data.Aeson.toJSON info

ptyGetHandler :: AppState -> Text -> Handler Value
ptyGetHandler st ptyId = liftIO $ do
    mInfo <- Pty.get (stPtyManager st) ptyId
    case mInfo of
        Nothing -> return $ object ["error" .= ("PTY not found" :: Text)]
        Just info -> return $ Data.Aeson.toJSON info

ptyUpdateHandler :: AppState -> Text -> Value -> Handler Value
ptyUpdateHandler st ptyId input = liftIO $ do
    let parseInput = case Data.Aeson.fromJSON input of
            Data.Aeson.Success i -> Just i
            Data.Aeson.Error _ -> Nothing

    case parseInput of
        Nothing -> return $ object ["error" .= ("Invalid input" :: Text)]
        Just updateInput -> do
            mInfo <- Pty.update (stPtyManager st) ptyId updateInput
            case mInfo of
                Nothing -> return $ object ["error" .= ("PTY not found" :: Text)]
                Just info -> do
                    Bus.publish (stBus st) "pty.updated" (object ["info" .= info])
                    return $ Data.Aeson.toJSON info

ptyDeleteHandler :: AppState -> Text -> Handler Bool
ptyDeleteHandler st ptyId = liftIO $ do
    success <- Pty.remove (stPtyManager st) ptyId
    when success $
        Bus.publish (stBus st) "pty.deleted" (object ["id" .= ptyId])
    return success
  where
    when True action = action
    when False _ = return ()

-- | Commit sandbox changes to real filesystem
ptyCommitHandler :: AppState -> Text -> Handler Value
ptyCommitHandler st ptyId = liftIO $ do
    result <- Pty.commitChanges (stPtyManager st) ptyId
    case result of
        Left err -> return $ object ["error" .= err]
        Right () -> do
            Bus.publish (stBus st) "pty.committed" (object ["id" .= ptyId])
            return $ object ["success" .= True, "id" .= ptyId]

-- | Get list of changed files in sandbox
ptyChangesHandler :: AppState -> Text -> Handler Value
ptyChangesHandler st ptyId = liftIO $ do
    result <- Pty.getChangedFiles (stPtyManager st) ptyId
    case result of
        Left err -> return $ object ["error" .= err]
        Right files -> return $ object ["id" .= ptyId, "changes" .= map pack files]

-- * LLM Handlers

-- | Simple chat completion handler for testing LLM integration
chatHandler :: AppState -> ChatInput -> Handler Value
chatHandler _st input = liftIO $ do
    let model = fromMaybe "anthropic/claude-sonnet-4-20250514" (ciModel input)
    case "anthropic/" `T.isPrefixOf` model of
        True -> do
            apiKey <- lookupEnv "ANTHROPIC_API_KEY"
            case apiKey of
                Nothing -> return $ object ["error" .= ("ANTHROPIC_API_KEY not set" :: Text)]
                Just key -> do
                    client <- Anthropic.newClient (pack key)
                    let request =
                            LLMTypes.ChatRequest
                                { LLMTypes.crModel = dropPrefix "anthropic/" model
                                , LLMTypes.crMessages = [LLMTypes.Message LLMTypes.User (LLMTypes.SimpleContent (ciMessage input))]
                                , LLMTypes.crMaxTokens = 1024
                                , LLMTypes.crSystem = Nothing
                                , LLMTypes.crTemperature = Nothing
                                , LLMTypes.crTools = Nothing
                                , LLMTypes.crStream = False
                                }
                    result <- Anthropic.chat client request
                    case result of
                        Left err -> return $ object ["error" .= err]
                        Right resp -> do
                            let content = case LLMTypes.respContent resp of
                                    (LLMTypes.TextBlock t : _) -> t
                                    _ -> ""
                            return $
                                object
                                    [ "id" .= LLMTypes.respId resp
                                    , "model" .= LLMTypes.respModel resp
                                    , "content" .= content
                                    , "usage" .= LLMTypes.respUsage resp
                                    ]
        False -> do
            apiKey <- lookupEnv "OPENROUTER_API_KEY"
            case apiKey of
                Nothing -> return $ object ["error" .= ("OPENROUTER_API_KEY not set" :: Text)]
                Just key -> do
                    client <- OpenRouter.newClient (pack key)
                    let request =
                            OpenRouter.ChatRequest
                                { OpenRouter.crModel = dropPrefix "openrouter/" model
                                , OpenRouter.crMessages = [OpenRouter.Message OpenRouter.User (ciMessage input)]
                                , OpenRouter.crMaxTokens = Just 1024
                                , OpenRouter.crTemperature = Nothing
                                , OpenRouter.crStream = False
                                }
                    result <- OpenRouter.chat client request
                    case result of
                        Left err -> return $ object ["error" .= err]
                        Right resp -> do
                            let content = case OpenRouter.respChoices resp of
                                    (c : _) -> OpenRouter.msgContent (OpenRouter.choiceMessage c)
                                    [] -> ""
                            return $
                                object
                                    [ "id" .= OpenRouter.respId resp
                                    , "model" .= OpenRouter.respModel resp
                                    , "content" .= content
                                    , "usage" .= OpenRouter.respUsage resp
                                    ]

dropPrefix :: Text -> Text -> Text
dropPrefix prefix value =
    case prefix `T.isPrefixOf` value of
        True -> T.drop (T.length prefix) value
        False -> value
