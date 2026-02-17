{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module Skill.Skill (
    SkillInfo (..),
    listSkills,
    parseSkill,
) where

import Control.Monad (foldM, forM)
import Data.Aeson (ToJSON (..), object, (.=))
import Data.Map.Strict qualified as Map
import Data.Maybe (mapMaybe)
import Data.Text (Text)
import Data.Text qualified as T
import Data.Text.IO qualified as TIO
import GHC.Generics (Generic)
import System.Directory (doesDirectoryExist, doesFileExist, getHomeDirectory, listDirectory, makeAbsolute)
import System.FilePath (takeDirectory, takeFileName, (</>))

data SkillInfo = SkillInfo
    { skillName :: Text
    , skillDescription :: Text
    , skillLocation :: Text
    , skillContent :: Text
    }
    deriving (Show, Eq, Generic)

instance ToJSON SkillInfo where
    toJSON skill =
        object
            [ "name" .= skillName skill
            , "description" .= skillDescription skill
            , "location" .= skillLocation skill
            , "content" .= skillContent skill
            ]

listSkills :: FilePath -> IO [SkillInfo]
listSkills root = do
    home <- getHomeDirectory
    projectDirs <- projectSkillRoots root
    let globalDirs =
            [ home </> ".config" </> "weapon" </> "skills"
            , home </> ".claude" </> "skills"
            , home </> ".agents" </> "skills"
            ]
    files <- fmap concat (mapM findSkills (globalDirs ++ projectDirs))
    infos <- foldM addSkill Map.empty files
    pure (Map.elems infos)

parseSkill :: FilePath -> Text -> Maybe SkillInfo
parseSkill path content = do
    (meta, body) <- parseFrontmatter (T.lines content)
    name <- Map.lookup "name" meta
    desc <- Map.lookup "description" meta
    pure $
        SkillInfo
            { skillName = name
            , skillDescription = desc
            , skillLocation = T.pack path
            , skillContent = T.unlines body
            }

projectSkillRoots :: FilePath -> IO [FilePath]
projectSkillRoots root = do
    base <- makeAbsolute root
    let dirs = walkUp base
    pure $ concatMap skillDirs dirs
  where
    skillDirs dir =
        [ dir </> ".weapon" </> "skill"
        , dir </> ".weapon" </> "skills"
        , dir </> ".claude" </> "skills"
        , dir </> ".agents" </> "skills"
        ]

walkUp :: FilePath -> [FilePath]
walkUp start = go start []
  where
    go dir acc =
        let parent = takeDirectory dir
            next = dir : acc
         in if parent == dir then reverse next else go parent next

findSkills :: FilePath -> IO [FilePath]
findSkills dir = do
    exists <- doesDirectoryExist dir
    if not exists
        then pure []
        else scan dir
  where
    scan path = do
        entries <- listDirectory path
        parts <- forM entries $ \entry -> do
            let item = path </> entry
            isDir <- doesDirectoryExist item
            if isDir
                then scan item
                else do
                    isFile <- doesFileExist item
                    if isFile && takeFileName item == "SKILL.md"
                        then pure [item]
                        else pure []
        pure (concat parts)

addSkill :: Map.Map Text SkillInfo -> FilePath -> IO (Map.Map Text SkillInfo)
addSkill acc path = do
    absolute <- makeAbsolute path
    content <- TIO.readFile absolute
    case parseSkill absolute content of
        Nothing -> pure acc
        Just skill -> pure (Map.insert (skillName skill) skill acc)

parseFrontmatter :: [Text] -> Maybe (Map.Map Text Text, [Text])
parseFrontmatter lines' = case lines' of
    [] -> Nothing
    (first : rest)
        | T.strip first /= "---" -> Nothing
        | otherwise -> go rest []
  where
    go remaining acc = case remaining of
        [] -> Nothing
        (line : more)
            | T.strip line == "---" ->
                let meta = Map.fromList (mapMaybe parseMeta (reverse acc))
                 in Just (meta, more)
            | otherwise -> go more (line : acc)

parseMeta :: Text -> Maybe (Text, Text)
parseMeta line =
    let (key, rest) = T.breakOn ":" line
     in if T.null rest
            then Nothing
            else Just (T.strip key, T.strip (T.drop 1 rest))
