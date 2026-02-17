{-# LANGUAGE OverloadedStrings #-}

module Session.Status (
    SessionStatus (..),
    buildStatus,
) where

import Data.Aeson (ToJSON (..), object, (.=))

data SessionStatus = SessionStatus
    { ssSessions :: Int
    , ssPtys :: Int
    }
    deriving (Eq, Show)

instance ToJSON SessionStatus where
    toJSON s =
        object
            [ "sessions" .= ssSessions s
            , "ptys" .= ssPtys s
            ]

buildStatus :: Int -> Int -> SessionStatus
buildStatus sessions ptys =
    SessionStatus
        { ssSessions = sessions
        , ssPtys = ptys
        }
