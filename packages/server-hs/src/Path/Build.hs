{-# LANGUAGE OverloadedStrings #-}

module Path.Build (
    buildPath,
) where

import Api (PathInfo (..))
import Data.Text (Text)

buildPath :: Text -> Text -> Text -> Text -> Text -> PathInfo
buildPath home state config worktree directory =
    PathInfo
        { home = home
        , state = state
        , config = config
        , worktree = worktree
        , directory = directory
        }
