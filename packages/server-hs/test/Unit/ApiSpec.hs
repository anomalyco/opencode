{-# LANGUAGE OverloadedStrings #-}

-- | API handler unit tests
module Unit.ApiSpec where

import Api
import Data.Aeson
import Data.Text qualified as T
import Test.Hspec

spec :: Spec
spec = do
  describe "Health API" $ do
    it "should create a healthy response" $ do
      let health = Health True "0.1.0"
      encode health `shouldBe` "{\"healthy\":true,\"version\":\"0.1.0\"}"

    it "should parse health JSON" $ do
      let json = "{\"healthy\":true,\"version\":\"0.1.0\"}"
      decode json `shouldBe` Just (Health True "0.1.0")

  describe "PathInfo API" $ do
    it "should serialize PathInfo correctly" $ do
      let pathInfo =
            PathInfo
              { home = "/home/user",
                state = "/home/user/.opencode/state",
                config = "/home/user/.opencode/config",
                worktree = "/home/user/project",
                directory = "/home/user/project"
              }
      let json = encode pathInfo
      T.isInfixOf "home" (T.pack $ show json) `shouldBe` True

  describe "Project API" $ do
    it "should serialize Project with all fields" $ do
      let project =
            Project
              { Api.id = "proj_123",
                Api.worktree = "/home/user/project",
                Api.name = Just "My Project"
              }
      let json = encode project
      T.isInfixOf "proj_123" (T.pack $ show json) `shouldBe` True

    it "should handle Project without name" $ do
      let project =
            Project
              { Api.id = "proj_456",
                Api.worktree = "/home/user/other",
                Api.name = Nothing
              }
      decode (encode project) `shouldBe` Just project

  describe "FileType API" $ do
    it "should serialize FileTypeFile as 'file'" $ do
      encode FileTypeFile `shouldBe` "\"file\""

    it "should serialize FileTypeDirectory as 'directory'" $ do
      encode FileTypeDirectory `shouldBe` "\"directory\""

  describe "ContentType API" $ do
    it "should serialize ContentTypeText as 'text'" $ do
      encode ContentTypeText `shouldBe` "\"text\""

    it "should serialize ContentTypeBinary as 'binary'" $ do
      encode ContentTypeBinary `shouldBe` "\"binary\""

  describe "SessionTime API" $ do
    it "should round-trip SessionTime" $ do
      let st =
            SessionTime
              { stCreated = 1234567890,
                stUpdated = 1234567891,
                stArchived = Just 1234567892
              }
      decode (encode st) `shouldBe` Just st
