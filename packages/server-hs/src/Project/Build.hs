{-# LANGUAGE OverloadedStrings #-}

module Project.Build (
    projectFromDir,
) where

import Api qualified
import Data.Text qualified as T
import System.FilePath (takeFileName)
import Prelude hiding (id)

projectFromDir :: FilePath -> Api.Project
projectFromDir dir =
    let name = T.pack (takeFileName dir)
        pid = if T.null name then "proj_default" else "proj_" <> name
        title = if T.null name then Nothing else Just name
     in Api.Project pid (T.pack dir) title
