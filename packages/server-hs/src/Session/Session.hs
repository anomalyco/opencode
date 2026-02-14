{-# LANGUAGE OverloadedStrings #-}

-- | Session module - CRUD operations
-- Mirrors the TypeScript Session namespace
module Session.Session
  ( -- * Types
    Session.Types.Session(..)
  , Session.Types.SessionTime(..)
  , Session.Types.CreateSessionInput(..)
  
  -- * Operations
  , create
  , get
  , update
  , delete
  , list
  , touch
  
  -- * Context
  , SessionContext(..)
  , withSessionContext
  ) where

import Control.Exception (catch)
import Control.Monad (forM)
import Data.Aeson (object, (.=))
import Data.Maybe (fromMaybe, isNothing)
import Data.Text (Text)
import qualified Data.Text as T
import Data.Time.Clock (getCurrentTime)
import Data.Time.Clock.POSIX (utcTimeToPOSIXSeconds)
import System.Random (randomIO)
import Numeric (showHex)
import Data.Word (Word64)

import qualified Storage.Storage as Storage
import qualified Bus.Bus as Bus
import Session.Types

-- | Context for session operations
data SessionContext = SessionContext
  { scStorage :: Storage.StorageConfig
  , scBus :: Bus.Bus
  , scProjectID :: Text
  , scDirectory :: Text
  , scVersion :: Text
  }

-- | Run operations with a session context
withSessionContext :: Storage.StorageConfig -> Bus.Bus -> Text -> Text -> Text -> (SessionContext -> IO a) -> IO a
withSessionContext storage bus projectID directory version action =
  action (SessionContext storage bus projectID directory version)

-- | Generate a unique session ID (descending for sorted listing)
generateSessionID :: IO Text
generateSessionID = do
  now <- getCurrentTime
  let ts = realToFrac (utcTimeToPOSIXSeconds now) * 1000 :: Double
  -- Use max - timestamp for descending order
  let descending = maxBound - round ts :: Word64
  rand <- randomIO :: IO Word64
  pure $ "ses_" <> T.pack (showHex descending "") <> T.pack (showHex (rand `mod` 0xFFFF) "")

-- | Generate a random slug
generateSlug :: IO Text
generateSlug = do
  w1 <- randomIO :: IO Word64
  w2 <- randomIO :: IO Word64
  pure $ T.pack $ showHex (w1 `mod` 0xFFFFFF) "" <> showHex (w2 `mod` 0xFFFFFF) ""

-- | Get current timestamp in milliseconds
nowMs :: IO Double
nowMs = do
  now <- getCurrentTime
  pure $ realToFrac (utcTimeToPOSIXSeconds now) * 1000

-- | Create a new session
create :: SessionContext -> CreateSessionInput -> IO Session
create ctx input = do
  sid <- generateSessionID
  slug <- generateSlug
  now <- nowMs
  
  let session = Session
        { sessionId = sid
        , sessionSlug = slug
        , sessionProjectID = scProjectID ctx
        , sessionDirectory = scDirectory ctx
        , sessionParentID = csiParentID input
        , sessionTitle = fromMaybe (defaultTitle now) (csiTitle input)
        , sessionVersion = scVersion ctx
        , sessionTime = SessionTime now now Nothing Nothing
        , sessionSummary = Nothing
        , sessionShare = Nothing
        , sessionRevert = Nothing
        }
  
  -- Write to storage
  Storage.write (scStorage ctx) ["session", scProjectID ctx, sid] session
  
  -- Publish event
  Bus.publish (scBus ctx) "session.created" (object ["info" .= session])
  
  pure session
  where
    defaultTitle now = "New session - " <> T.pack (show (round now :: Integer))

-- | Get a session by ID
get :: SessionContext -> Text -> IO (Maybe Session)
get ctx sid =
  (Just <$> Storage.read (scStorage ctx) ["session", scProjectID ctx, sid])
    `catch` \(Storage.NotFoundError _) -> pure Nothing
-- | Update a session
update :: SessionContext -> Text -> (Session -> Session) -> IO (Maybe Session)
update ctx sid fn = do
  msession <- get ctx sid
  case msession of
    Nothing -> pure Nothing
    Just session -> do
      now <- nowMs
      let updated = fn session { sessionTime = (sessionTime session) { stUpdated = now } }
      Storage.write (scStorage ctx) ["session", scProjectID ctx, sid] updated
      Bus.publish (scBus ctx) "session.updated" (object ["info" .= updated])
      pure (Just updated)

-- | Delete a session
delete :: SessionContext -> Text -> IO Bool
delete ctx sid = do
  msession <- get ctx sid
  case msession of
    Nothing -> pure False
    Just session -> do
      Storage.remove (scStorage ctx) ["session", scProjectID ctx, sid]
      Bus.publish (scBus ctx) "session.deleted" (object ["info" .= session])
      pure True

-- | List all sessions for the current project
list :: SessionContext -> Maybe Bool -> Maybe Int -> IO [Session]
list ctx mRoots mLimit = do
  keys <- Storage.list (scStorage ctx) ["session", scProjectID ctx]
  sessions <- forM keys $ \key -> do
    let sid = last key
    get ctx sid
  let valid = [s | Just s <- sessions]
  let filtered = case mRoots of
        Just True -> filter (isNothing . sessionParentID) valid
        _ -> valid
  let limited = case mLimit of
        Just n -> take n filtered
        Nothing -> filtered
  pure limited

-- | Touch a session (update timestamp)
touch :: SessionContext -> Text -> IO ()
touch ctx sid = do
  _ <- update ctx sid id
  pure ()
