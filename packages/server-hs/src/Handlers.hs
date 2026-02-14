{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE FlexibleContexts #-}

module Handlers where

import Servant
import Control.Monad.IO.Class (liftIO)
import Control.Concurrent.STM
import Data.Text (Text, pack, unpack)
import qualified Data.Text.IO as TIO
import Data.Maybe (fromMaybe)
import Data.Time.Clock (getCurrentTime)
import Data.Time.Clock.POSIX (utcTimeToPOSIXSeconds)
import System.Directory (listDirectory, doesDirectoryExist, makeAbsolute, getCurrentDirectory)
import System.FilePath ((</>))
import Control.Monad (forM, forM_)
import Control.Concurrent (forkIO, threadDelay)
import Data.Aeson (Value(..), object, (.=))
import qualified Data.Aeson
import qualified Data.Map.Strict as Map
import Control.Exception (catch)

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
import qualified Config.Types as CT

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
  cfg <- Config.get (stDirectory st)
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
  now <- getCurrentTime
  let t = realToFrac (utcTimeToPOSIXSeconds now) * 1000
  let msgTime = SessionTime t t Nothing
  
  -- 1. User Message
  let uMsgId = fromMaybe ("msg_" ++ show (round t :: Integer)) (cmiMessageId input)
  let uMsg = Message
        { msgInfo = MessageInfo (pack uMsgId) sid "user" msgTime
        , msgParts = cmiParts input
        }
  
  -- 2. Assistant Message
  let aMsgId = "msg_" ++ show (round t + 1 :: Integer)
  let aMsg = Message
        { msgInfo = MessageInfo (pack aMsgId) sid "assistant" msgTime
        , msgParts = []
        }
  
  -- Write to storage
  Storage.write (stStorage st) ["message", sid, pack uMsgId] uMsg
  Storage.write (stStorage st) ["message", sid, pack aMsgId] aMsg
  
  -- Publish events
  Bus.publish (stBus st) "message.updated" (object ["info" .= uMsg])
  Bus.publish (stBus st) "message.updated" (object ["info" .= aMsg])

  -- Mock streaming response
  _ <- forkIO $ do
    let words' = ["This", " ", "is", " ", "a", " ", "simulated", " ", "streaming", " ", "response", " ", "from", " ", "Haskell!"]
    forM_ (zip [0..] words') $ \(i, w) -> do
        threadDelay 100000 -- 100ms
        let partEvent = object
              [ "id" .= pack aMsgId
              , "sessionID" .= sid
              , "partIndex" .= (i :: Int)
              , "content" .= (w :: String)
              ]
        Bus.publish (stBus st) "message.part.updated" partEvent
        
  return aMsg

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
