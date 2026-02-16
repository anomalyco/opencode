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
import System.Directory (listDirectory, doesDirectoryExist, makeAbsolute, getCurrentDirectory)
import System.FilePath ((</>))
import Control.Monad (forM)
import Control.Concurrent (forkIO)
import Data.Aeson (Value(..), object, (.=))
import qualified Data.Aeson
import qualified Data.Aeson.KeyMap as KM
import qualified Data.Map.Strict as Map
import Control.Exception (catch, SomeException)

import Api
import State
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
