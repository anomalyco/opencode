{-# LANGUAGE OverloadedStrings #-}

module Project.Discovery (
    discoverProjects,
) where

import Api (Project (..))
import Data.List (nubBy)
import Project.Build qualified as ProjectBuild
import System.Directory (doesFileExist, listDirectory)
import System.FilePath ((</>))

discoverProjects :: FilePath -> IO [Project]
discoverProjects root = do
    entries <- listDirectory root
    sub <- filterM (\dir -> doesFileExist (root </> dir </> "weapon.json")) entries
    let current = ProjectBuild.projectFromDir root
    let projects = current : map (ProjectBuild.projectFromDir . (root </>)) sub
    pure $ nubBy sameWorktree projects
  where
    filterM _ [] = pure []
    filterM f (x : xs) = do
        ok <- f x
        rest <- filterM f xs
        pure (if ok then x : rest else rest)
    sameWorktree a b = worktree a == worktree b
