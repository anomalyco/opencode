{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE DuplicateRecordFields #-}
{-# LANGUAGE DisambiguateRecordFields #-}

module Handlers where

import Servant
import Control.Monad.IO.Class (liftIO)
import Control.Concurrent.STM
import Data.Text (Text, pack, unpack)
import qualified Data.Text as T
import qualified Data.Text.IO as TIO
import Data.Maybe (fromMaybe)
import Data.Time.Clock (getCurrentTime)
import Data.Time.Clock.POSIX (utcTimeToPOSIXSeconds)
import System.Directory (listDirectory, doesDirectoryExist, makeAbsolute, getCurrentDirectory, doesFileExist)
import System.FilePath ((</>), takeFileName)
import Control.Monad (forM)
import Control.Concurrent (forkIO)
import Data.Aeson (Value(..), object, (.=))
import qualified Data.Aeson
import qualified Data.Aeson.KeyMap as KM
import qualified Data.Map.Strict as Map
import Control.Exception (catch, SomeException)

import Api
import State
import qualified Message.Parts as Parts
import qualified Bus.Bus as Bus
import qualified Storage.Storage as Storage
import qualified Session.Session as Sess
import qualified Session.Types as ST
import qualified Provider.Provider as Provider
import qualified Provider.Types as PT
import qualified Agent.Agent as Agent
import qualified Agent.Types as AT
import qualified Config.Config as Config
import qualified Pty.Pty as Pty
import qualified Pty.Types as PtyT
import qualified LLM.OpenRouter as LLM
import qualified Proxy.Proxy as Proxy
import qualified Tool.Defs as Tool
import qualified Tool.Types as ToolT
import System.Environment (lookupEnv)
import qualified Log
import qualified Katip

-- Helper to resolve paths
resolvePath :: Maybe Text -> Text -> IO FilePath
resolvePath mDir path = do
  base <- case mDir of
    Just d -> pure (unpack d)
    Nothing -> getCurrentDirectory
  makeAbsolute (base </> unpack path)

findMatches :: Text -> Text -> Maybe Text -> IO [Value]
findMatches query pattern mDir = do
  base <- case mDir of
    Just d -> pure (unpack d)
    Nothing -> getCurrentDirectory
  exists <- doesDirectoryExist base
  case exists of
    False -> return []
    True -> do
      files <- listDirectoryRecursive base
      let q = T.toLower query
      let p = T.toLower pattern
      let matches = filter (matchesTerm q p) files
      return $ map (\path -> object ["path" .= pack path, "name" .= pack (takeFileName path)]) matches
  where
    matchesTerm q p path =
      let name = T.toLower (pack (takeFileName path))
          qok = if T.null q then True else T.isInfixOf q name
          pok = if T.null p then True else T.isInfixOf p name
      in qok && pok

listDirectoryRecursive :: FilePath -> IO [FilePath]
listDirectoryRecursive dir = do
  entries <- listDirectory dir
  paths <- forM entries $ \name -> do
    let path = dir </> name
    isDir <- doesDirectoryExist path
    if isDir
      then listDirectoryRecursive path
      else pure [path]
  pure (concat paths)

-- | Get session context from app state
sessionContext :: AppState -> Sess.SessionContext
sessionContext st = Sess.SessionContext
  { Sess.scStorage = stStorage st
  , Sess.scBus = stBus st
  , Sess.scProjectID = stProjectID st
  , Sess.scDirectory = stDirectory st
  , Sess.scVersion = stVersion st
  }

-- | Convert internal Session to API Session
toApiSession :: ST.Session -> Session
toApiSession s = Session
  { sesId = ST.sessionId s
  , sesSlug = ST.sessionSlug s
  , sesProjectId = ST.sessionProjectID s
  , sesDirectory = ST.sessionDirectory s
  , sesTitle = ST.sessionTitle s
  , sesVersion = ST.sessionVersion s
  , sesTime = SessionTime
      (ST.stCreated (ST.sessionTime s))
      (ST.stUpdated (ST.sessionTime s))
      (ST.stArchived (ST.sessionTime s))
  , sesParentId = ST.sessionParentID s
  , sesSummary = toApiSummary <$> ST.sessionSummary s
  , sesShare = toApiShare <$> ST.sessionShare s
  , sesRevert = toApiRevert <$> ST.sessionRevert s
  }

toApiSummary :: ST.SessionSummary -> SessionSummary
toApiSummary s = SessionSummary
  { ssAdditions = ST.ssAdditions s
  , ssDeletions = ST.ssDeletions s
  , ssFiles = ST.ssFiles s
  }

toApiShare :: ST.SessionShare -> SessionShare
toApiShare s = SessionShare { shareUrl = ST.shareUrl s }

toApiRevert :: ST.SessionRevert -> SessionRevert
toApiRevert r = SessionRevert
  { srMessageId = ST.revertMessageID r
  , srPartId = ST.revertPartID r
  , srSnapshot = ST.revertSnapshot r
  , srDiff = ST.revertDiff r
  }

toInternalSummary :: SessionSummary -> ST.SessionSummary
toInternalSummary s = ST.SessionSummary
  { ST.ssAdditions = ssAdditions s
  , ST.ssDeletions = ssDeletions s
  , ST.ssFiles = ssFiles s
  }

toInternalShare :: SessionShare -> ST.SessionShare
toInternalShare s = ST.SessionShare { ST.shareUrl = shareUrl s }

toInternalRevert :: SessionRevert -> ST.SessionRevert
toInternalRevert r = ST.SessionRevert
  { ST.revertMessageID = srMessageId r
  , ST.revertPartID = srPartId r
  , ST.revertSnapshot = srSnapshot r
  , ST.revertDiff = srDiff r
  }

-- | Convert API CreateSessionInput to internal
toInternalInput :: CreateSessionInput -> ST.CreateSessionInput
toInternalInput csi = ST.CreateSessionInput
  { ST.csiTitle = csiTitle csi
  , ST.csiParentID = csiParentId csi
  }

-- * Global Handlers

healthHandler :: Handler Health
healthHandler = return $ Health True "0.0.1"

pathHandler :: Handler PathInfo
pathHandler = liftIO $ do
  cwd <- getCurrentDirectory
  return $ PathInfo
    { home = pack cwd
    , state = pack (cwd </> ".opencode/state")
    , config = pack (cwd </> ".opencode/config")
    , worktree = pack cwd
    , directory = pack cwd
    }

globalConfigHandler :: Handler Value
globalConfigHandler = return $ object []

-- * Project Handlers

projectListHandler :: Handler [Project]
projectListHandler = return []

projectCurrentHandler :: Maybe Text -> Handler Project
projectCurrentHandler _ = liftIO $ do
  cwd <- getCurrentDirectory
  return $ Project
    { Api.id = "proj_default"
    , Api.worktree = pack cwd
    , Api.name = Just "Default Project"
    }

projectGetHandler :: Text -> Handler Project
projectGetHandler pid = liftIO $ do
  cwd <- getCurrentDirectory
  return $ Project
    { Api.id = pid
    , Api.worktree = pack cwd
    , Api.name = Just ("Project " <> pid)
    }

-- * Provider/Config Handlers

providerListHandler :: AppState -> Handler ProviderList
providerListHandler _st = liftIO $ do
  providers <- Provider.list
  let providerJson = map toJSON providers
  -- Default model selection (first model of first provider)
  let defaultModel = case providers of
        (p:_) -> case Map.elems (PT.providerModels p) of
          (m:_) -> object ["providerID" .= PT.providerId p, "modelID" .= PT.modelId m]
          [] -> object []
        [] -> object []
  return $ ProviderList providerJson defaultModel
  where
    toJSON = Data.Aeson.toJSON

providerAuthHandler :: AppState -> Handler Value
providerAuthHandler st = liftIO $ do
  auths <- Provider.authStatus (stStorage st)
  return $ Data.Aeson.toJSON auths

providerHandler :: Handler [Value]
providerHandler = liftIO $ do
  providers <- Provider.list
  return $ map Data.Aeson.toJSON providers

providerOauthAuthorizeHandler :: Text -> Value -> Handler Value
providerOauthAuthorizeHandler pid _ = return $ object
  [ "providerID" .= pid
  , "url" .= ("https://auth.opencode.ai/oauth/" <> pid)
  ]

providerOauthCallbackHandler :: Text -> Value -> Handler Value
providerOauthCallbackHandler pid _ = return $ object
  [ "providerID" .= pid
  , "success" .= True
  ]

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

configHandler :: AppState -> Handler Value
configHandler st = liftIO $ do
  cfg <- Config.get (unpack (stDirectory st))
  return $ Data.Aeson.toJSON cfg

commandHandler :: Handler [Value]
commandHandler = return []

agentHandler :: Handler [Value]
agentHandler = liftIO $ do
  agents <- Agent.list
  -- Filter out hidden agents
  let visible = filter (not . maybe False Prelude.id . AT.agentHidden) agents
  return $ map Data.Aeson.toJSON visible

-- * Session Handlers

sessionStatusHandler :: Handler Value
sessionStatusHandler = return $ object []

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
sessionTodoHandler _ _ = return []

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
  session <- Sess.create ctx ST.CreateSessionInput
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
      in s { ST.sessionShare = Just (ST.SessionShare url) }

sessionShareDeleteHandler :: AppState -> Text -> Handler Bool
sessionShareDeleteHandler st sid = liftIO $ do
  let ctx = sessionContext st
  updated <- Sess.update ctx sid (\s -> s { ST.sessionShare = Nothing })
  return $ case updated of
    Nothing -> False
    Just _ -> True

sessionDiffHandler :: AppState -> Text -> Handler Value
sessionDiffHandler st sid = liftIO $ do
  let ctx = sessionContext st
  msession <- Sess.get ctx sid
  case msession of
    Nothing -> return $ object ["sessionID" .= sid, "diff" .= ("" :: Text)]
    Just session -> return $ object
      [ "sessionID" .= sid
      , "summary" .= (toApiSummary <$> ST.sessionSummary session)
      ]

sessionSummarizeHandler :: AppState -> Text -> Handler SessionSummary
sessionSummarizeHandler st sid = do
  let ctx = sessionContext st
  msession <- liftIO $ Sess.update ctx sid (setSummary)
  case msession of
    Nothing -> throwError err404
    Just session -> case ST.sessionSummary session of
      Nothing -> throwError err500
      Just summary -> return $ toApiSummary summary
  where
    setSummary s =
      let summary = ST.SessionSummary 0 0 (Just 0)
      in s { ST.sessionSummary = Just summary }

sessionCommandHandler :: AppState -> Text -> Value -> Handler Value
sessionCommandHandler st sid input = liftIO $ do
  Bus.publish (stBus st) "command.executed" (object ["sessionID" .= sid, "command" .= input])
  return $ object ["sessionID" .= sid, "ok" .= True]

sessionShellHandler :: AppState -> Text -> Value -> Handler Value
sessionShellHandler st sid input = liftIO $ do
  Bus.publish (stBus st) "command.executed" (object ["sessionID" .= sid, "shell" .= input])
  return $ object ["sessionID" .= sid, "ok" .= True]

sessionRevertHandler :: AppState -> Text -> SessionRevert -> Handler SessionRevert
sessionRevertHandler st sid input = do
  let ctx = sessionContext st
  msession <- liftIO $ Sess.update ctx sid (\s -> s { ST.sessionRevert = Just (toInternalRevert input) })
  case msession of
    Nothing -> throwError err404
    Just _ -> return input

sessionUnrevertHandler :: AppState -> Text -> Handler Bool
sessionUnrevertHandler st sid = liftIO $ do
  let ctx = sessionContext st
  updated <- Sess.update ctx sid (\s -> s { ST.sessionRevert = Nothing })
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
  msgs <- (Storage.list (stStorage st) key >>= mapM (Storage.read (stStorage st)))
    `catch` \(Storage.NotFoundError _) -> return []
  return msgs

sessionMessageCreateHandler :: AppState -> Text -> CreateMessageInput -> Handler Message
sessionMessageCreateHandler st sid input = liftIO $ do
  let lg = Log.withNS (stLogger st) "message"
  
  now <- getCurrentTime
  let t = realToFrac (utcTimeToPOSIXSeconds now) * 1000
  let msgTime = SessionTime t t Nothing
  
  -- Extract user text for logging
  let userText = extractUserText (cmiParts input)
  Log.logMsg lg Katip.InfoS $ "create session=" <> sid <> " text=" <> T.take 50 userText
  
  -- 1. User Message
  let uMsgId = fromMaybe (pack ("msg_" ++ show (round t :: Integer))) (cmiMessageId input)
  let uMsg = Message
        { msgInfo = MessageInfo uMsgId sid "user" msgTime
        , msgParts = cmiParts input
        }
  
  -- 2. Assistant Message (incomplete initially)
  let aMsgId = pack ("msg_" ++ show (round t + 1 :: Integer))
  let partId = pack ("part_" ++ show (round t :: Integer))
  let aMsg = Message
        { msgInfo = MessageInfo aMsgId sid "assistant" msgTime
        , msgParts = []
        }
  
  -- Write to storage
  Storage.write (stStorage st) ["message", sid, uMsgId] uMsg
  Storage.write (stStorage st) ["message", sid, aMsgId] aMsg
  
  -- Publish user message event (send just info, not full message)
  let userInfo = object
        [ "id" .= uMsgId
        , "sessionID" .= sid
        , "role" .= ("user" :: Text)
        , "time" .= object ["created" .= t]
        , "parentID" .= (Nothing :: Maybe Text)
        ]
  Bus.publish (stBus st) "message.updated" (object ["info" .= userInfo])
  
  -- Publish assistant message (incomplete - no time.completed)
  let assistantInfo = object
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
        , "tokens" .= object
            [ "input" .= (0 :: Int)
            , "output" .= (0 :: Int)
            , "reasoning" .= (0 :: Int)
            , "cache" .= object ["read" .= (0 :: Int), "write" .= (0 :: Int)]
            ]
        ]
  Bus.publish (stBus st) "message.updated" (object ["info" .= assistantInfo])
  
  -- Extract user text from parts
  let userText = extractUserText (cmiParts input)
  
  -- Spawn LLM streaming task
  _ <- forkIO $ (do
    apiKey <- lookupEnv "OPENROUTER_API_KEY"
    case apiKey of
      Nothing -> do
        -- No API key - send error
        let errPart = object
              [ "id" .= partId
              , "sessionID" .= sid
              , "messageID" .= aMsgId
              , "type" .= ("text" :: Text)
              , "text" .= ("Error: OPENROUTER_API_KEY not set" :: Text)
              ]
        Bus.publish (stBus st) "message.part.updated" (object ["part" .= errPart])
        completeMessage st sid aMsgId t
        
      Just key -> do
        client <- LLM.newClient (pack key)
        textRef <- newTVarIO ("" :: Text)
        
        let req = LLM.ChatRequest
              { LLM.crModel = "anthropic/claude-opus-4.5"
              , LLM.crMessages = [LLM.Message LLM.User userText]
              , LLM.crMaxTokens = Just 4096
              , LLM.crTemperature = Nothing
              , LLM.crStream = True
              }
        
        result <- LLM.chatStream client req $ \delta -> do
          -- Accumulate text
          atomically $ modifyTVar' textRef (<> delta)
          fullText <- readTVarIO textRef
          
          -- Publish text part update with accumulated text
          let textPart = object
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
            let textPart = object
                  [ "id" .= partId
                  , "sessionID" .= sid
                  , "messageID" .= aMsgId
                  , "type" .= ("text" :: Text)
                  , "text" .= errText
                  ]
            Bus.publish (stBus st) "message.part.updated" (object ["part" .= textPart])
          Right () -> pure ()
        
        completeMessage st sid aMsgId t
    ) `catch` \(_e :: SomeException) -> pure ()
        
  return aMsg

sessionMessageGetHandler :: AppState -> Text -> Text -> Handler Message
sessionMessageGetHandler st sid msgId = do
  let key = ["message", sid, msgId]
  result <- liftIO $ (Just <$> Storage.read (stStorage st) key)
    `catch` \(Storage.NotFoundError _) -> return Nothing
  case result of
    Nothing -> throwError err404
    Just msg -> return msg

sessionMessagePartDeleteHandler :: AppState -> Text -> Text -> Text -> Handler Bool
sessionMessagePartDeleteHandler st sid msgId partId = liftIO $ do
  let key = ["message", sid, msgId]
  result <- (Just <$> Storage.read (stStorage st) key)
    `catch` \(Storage.NotFoundError _) -> return Nothing
  case result of
    Nothing -> return False
    Just msg -> do
      let updated = Parts.deletePart partId (msgParts msg)
      case updated of
        Nothing -> return False
        Just parts -> do
          let next = msg { msgParts = parts }
          Storage.write (stStorage st) key next
          Bus.publish (stBus st) "message.part.removed" (object ["sessionID" .= sid, "messageID" .= msgId, "partID" .= partId])
          return True

sessionMessagePartUpdateHandler :: AppState -> Text -> Text -> Text -> Value -> Handler Value
sessionMessagePartUpdateHandler st sid msgId partId input = do
  let key = ["message", sid, msgId]
  result <- liftIO $ (Just <$> Storage.read (stStorage st) key)
    `catch` \(Storage.NotFoundError _) -> return Nothing
  case result of
    Nothing -> throwError err404
    Just msg -> do
      let updated = Parts.updatePart partId input (msgParts msg)
      case updated of
        Nothing -> throwError err404
        Just parts -> do
          let next = msg { msgParts = parts }
          liftIO $ Storage.write (stStorage st) key next
          let mpart = Parts.findPart partId parts
          case mpart of
            Nothing -> throwError err404
            Just part -> do
              liftIO $ Bus.publish (stBus st) "message.part.updated" (object ["sessionID" .= sid, "messageID" .= msgId, "part" .= part])
              return part

sessionPromptAsyncHandler :: AppState -> Text -> CreateMessageInput -> Handler Value
sessionPromptAsyncHandler st sid input = liftIO $ do
  Bus.publish (stBus st) "prompt.async" (object ["sessionID" .= sid, "parts" .= cmiParts input])
  return $ object ["sessionID" .= sid, "queued" .= True]

-- | Extract text content from user message parts
extractUserText :: [Value] -> Text
extractUserText parts = T.intercalate "\n" $ concatMap extractText parts
  where
    extractText (Object obj) = case KM.lookup "type" obj of
      Just (String "text") -> case KM.lookup "text" obj of
        Just (String txt) -> [txt]
        _ -> []
      _ -> []
    extractText _ = []

-- | Mark message as complete and publish idle event
completeMessage :: AppState -> Text -> Text -> Double -> IO ()
completeMessage st sid msgId startTime = do
  let lg = Log.withNS (stLogger st) "message"
  
  now <- getCurrentTime
  let endTime = realToFrac (utcTimeToPOSIXSeconds now) * 1000 :: Double
  let duration = (endTime - startTime) / 1000  -- seconds
  
  Log.logMsg lg Katip.InfoS $ "complete session=" <> sid <> " msg=" <> msgId <> " duration=" <> T.pack (show duration) <> "s"
  
  -- Publish completed message info
  let completedInfo = object
        [ "id" .= msgId
        , "sessionID" .= sid
        , "role" .= ("assistant" :: Text)
        , "time" .= object ["created" .= startTime, "completed" .= endTime]
        , "parentID" .= (msgId :: Text)  -- TODO: actual parent
        , "modelID" .= ("anthropic/claude-opus-4.5" :: Text)
        , "providerID" .= ("openrouter" :: Text)
        , "mode" .= ("build" :: Text)
        , "agent" .= ("build" :: Text)
        , "path" .= object ["cwd" .= stDirectory st, "root" .= stDirectory st]
        , "cost" .= (0 :: Double)
        , "tokens" .= object
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
        let relPath = if unpack path == "" || unpack path == "." || unpack path == "/" 
                      then name 
                      else unpack path </> name
        return $ FileNode
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
  content <- TIO.readFile fullPath
  return $ FileContent ContentTypeText content

-- * Stubs

lspHandler :: Handler [Value]
lspHandler = return []

vcsHandler :: Handler VcsInfo
vcsHandler = return $ VcsInfo (Just "main")

permissionHandler :: Handler [Value]
permissionHandler = return []

questionHandler :: Handler [Value]
questionHandler = return []

questionReplyHandler :: AppState -> Text -> Value -> Handler Value
questionReplyHandler st rid input = liftIO $ do
  Bus.publish (stBus st) "question.replied" (object ["requestID" .= rid, "reply" .= input])
  return $ object ["requestID" .= rid, "ok" .= True]

questionRejectHandler :: AppState -> Text -> Value -> Handler Value
questionRejectHandler st rid input = liftIO $ do
  Bus.publish (stBus st) "question.rejected" (object ["requestID" .= rid, "reject" .= input])
  return $ object ["requestID" .= rid, "ok" .= True]

permissionReplyHandler :: AppState -> Text -> Value -> Handler Value
permissionReplyHandler st rid input = liftIO $ do
  Bus.publish (stBus st) "permission.replied" (object ["requestID" .= rid, "reply" .= input])
  return $ object ["requestID" .= rid, "ok" .= True]

findHandler :: Maybe Text -> Maybe Text -> Maybe Text -> Handler [Value]
findHandler mQuery mPattern mDir = liftIO $ do
  results <- findMatches (fromMaybe "" mQuery) (fromMaybe "" mPattern) mDir
  return results

findFileHandler :: Maybe Text -> Maybe Text -> Handler [Value]
findFileHandler mPattern mDir = liftIO $ do
  results <- findMatches "" (fromMaybe "" mPattern) mDir
  return results

findSymbolHandler :: Maybe Text -> Maybe Text -> Handler [Value]
findSymbolHandler mQuery mDir = liftIO $ do
  results <- findMatches (fromMaybe "" mQuery) "" mDir
  return results

fileStatusHandler :: Maybe Text -> Maybe Text -> Handler [Value]
fileStatusHandler mDir mPath = liftIO $ do
  case mPath of
    Nothing -> return []
    Just path -> do
      fullPath <- resolvePath mDir path
      exists <- doesFileExist fullPath
      return [object ["path" .= path, "exists" .= exists, "status" .= ("clean" :: Text)]]

tuiHandler :: AppState -> Text -> Value -> Handler Value
tuiHandler st name input = liftIO $ do
  Bus.publish (stBus st) ("tui." <> name) (object ["payload" .= input])
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

skillHandler :: Handler [Value]
skillHandler = return []

formatterHandler :: Handler Value
formatterHandler = return $ object []

experimentalToolIdsHandler :: Handler [Text]
experimentalToolIdsHandler = return $ map ToolT.tdName Tool.allTools

experimentalToolHandler :: Value -> Handler Value
experimentalToolHandler input = return $ object ["ok" .= True, "input" .= input]

experimentalWorktreeGetHandler :: AppState -> Handler Value
experimentalWorktreeGetHandler st = return $ object ["root" .= stDirectory st]

experimentalWorktreePostHandler :: AppState -> Value -> Handler Value
experimentalWorktreePostHandler st input =
  return $ object ["root" .= stDirectory st, "input" .= input]

experimentalWorktreeResetHandler :: AppState -> Value -> Handler Value
experimentalWorktreeResetHandler st input =
  return $ object ["root" .= stDirectory st, "reset" .= True, "input" .= input]

-- * PTY Handlers (sandboxed terminals)

ptyListHandler :: AppState -> Handler [Value]
ptyListHandler st = liftIO $ do
  sessions <- Pty.list (stPtyManager st)
  return $ map Data.Aeson.toJSON sessions

ptyCreateHandler :: AppState -> Value -> Handler Value
ptyCreateHandler st input = liftIO $ do
  -- Parse input
  let parseInput = case Data.Aeson.fromJSON input of
        Data.Aeson.Success i -> Just i
        Data.Aeson.Error _ -> Nothing
  
  let ptyInput = case parseInput of
        Just i -> i
        Nothing -> PtyT.CreatePtyInput Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing Nothing
  
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
  -- Get API key from environment
  apiKey <- lookupEnv "OPENROUTER_API_KEY"
  case apiKey of
    Nothing -> return $ object ["error" .= ("OPENROUTER_API_KEY not set" :: Text)]
    Just key -> do
      client <- LLM.newClient (pack key)
      let model = fromMaybe "anthropic/claude-sonnet-4" (ciModel input)
          req = LLM.ChatRequest
            { LLM.crModel = model
            , LLM.crMessages = [LLM.Message LLM.User (ciMessage input)]
            , LLM.crMaxTokens = Just 1024
            , LLM.crTemperature = Nothing
            , LLM.crStream = False
            }
      result <- LLM.chat client req
      case result of
        Left err -> return $ object ["error" .= err]
        Right resp -> do
          let content = case LLM.respChoices resp of
                (c:_) -> LLM.msgContent (LLM.choiceMessage c)
                [] -> ""
          return $ object
            [ "id" .= LLM.respId resp
            , "model" .= LLM.respModel resp
            , "content" .= content
            , "usage" .= LLM.respUsage resp
            ]
