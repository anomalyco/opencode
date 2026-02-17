{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

{- | Session type definitions
Mirrors the TypeScript Session.Info schema
-}
module Session.Types (
    Session (..),
    SessionTime (..),
    SessionSummary (..),
    SessionShare (..),
    SessionRevert (..),
    CreateSessionInput (..),
) where

import Data.Aeson
import Data.Text (Text)
import GHC.Generics (Generic)

-- | Session time information
data SessionTime = SessionTime
    { stCreated :: Double
    , stUpdated :: Double
    , stCompacting :: Maybe Double
    , stArchived :: Maybe Double
    }
    deriving (Show, Eq, Generic)

instance ToJSON SessionTime where
    toJSON st =
        object
            [ "created" .= stCreated st
            , "updated" .= stUpdated st
            , "compacting" .= stCompacting st
            , "archived" .= stArchived st
            ]

instance FromJSON SessionTime where
    parseJSON = withObject "SessionTime" $ \v ->
        SessionTime
            <$> v .: "created"
            <*> v .: "updated"
            <*> v .:? "compacting"
            <*> v .:? "archived"

-- | Session summary (diff stats)
data SessionSummary = SessionSummary
    { ssAdditions :: Int
    , ssDeletions :: Int
    , ssFiles :: Maybe Int
    }
    deriving (Show, Eq, Generic)

instance ToJSON SessionSummary where
    toJSON ss =
        object
            [ "additions" .= ssAdditions ss
            , "deletions" .= ssDeletions ss
            , "files" .= ssFiles ss
            ]

instance FromJSON SessionSummary where
    parseJSON = withObject "SessionSummary" $ \v ->
        SessionSummary
            <$> v .: "additions"
            <*> v .: "deletions"
            <*> v .:? "files"

-- | Session share info
data SessionShare = SessionShare
    { shareUrl :: Text
    }
    deriving (Show, Eq, Generic)

instance ToJSON SessionShare where
    toJSON ss = object ["url" .= shareUrl ss]

instance FromJSON SessionShare where
    parseJSON = withObject "SessionShare" $ \v ->
        SessionShare
            <$> v .: "url"

-- | Session revert state
data SessionRevert = SessionRevert
    { revertMessageID :: Text
    , revertPartID :: Maybe Text
    , revertSnapshot :: Maybe Text
    , revertDiff :: Maybe Text
    }
    deriving (Show, Eq, Generic)

instance ToJSON SessionRevert where
    toJSON sr =
        object
            [ "messageID" .= revertMessageID sr
            , "partID" .= revertPartID sr
            , "snapshot" .= revertSnapshot sr
            , "diff" .= revertDiff sr
            ]

instance FromJSON SessionRevert where
    parseJSON = withObject "SessionRevert" $ \v ->
        SessionRevert
            <$> v .: "messageID"
            <*> v .:? "partID"
            <*> v .:? "snapshot"
            <*> v .:? "diff"

-- | Full session info
data Session = Session
    { sessionId :: Text
    , sessionSlug :: Text
    , sessionProjectID :: Text
    , sessionDirectory :: Text
    , sessionParentID :: Maybe Text
    , sessionTitle :: Text
    , sessionVersion :: Text
    , sessionTime :: SessionTime
    , sessionSummary :: Maybe SessionSummary
    , sessionShare :: Maybe SessionShare
    , sessionRevert :: Maybe SessionRevert
    }
    deriving (Show, Eq, Generic)

instance ToJSON Session where
    toJSON s =
        object
            [ "id" .= sessionId s
            , "slug" .= sessionSlug s
            , "projectID" .= sessionProjectID s
            , "directory" .= sessionDirectory s
            , "parentID" .= sessionParentID s
            , "title" .= sessionTitle s
            , "version" .= sessionVersion s
            , "time" .= sessionTime s
            , "summary" .= sessionSummary s
            , "share" .= sessionShare s
            , "revert" .= sessionRevert s
            ]

instance FromJSON Session where
    parseJSON = withObject "Session" $ \v ->
        Session
            <$> v .: "id"
            <*> v .: "slug"
            <*> v .: "projectID"
            <*> v .: "directory"
            <*> v .:? "parentID"
            <*> v .: "title"
            <*> v .: "version"
            <*> v .: "time"
            <*> v .:? "summary"
            <*> v .:? "share"
            <*> v .:? "revert"

-- | Input for creating a session
data CreateSessionInput = CreateSessionInput
    { csiTitle :: Maybe Text
    , csiParentID :: Maybe Text
    }
    deriving (Show, Eq, Generic)

instance FromJSON CreateSessionInput where
    parseJSON = withObject "CreateSessionInput" $ \v ->
        CreateSessionInput
            <$> v .:? "title"
            <*> v .:? "parentID"

instance ToJSON CreateSessionInput where
    toJSON csi =
        object
            [ "title" .= csiTitle csi
            , "parentID" .= csiParentID csi
            ]
