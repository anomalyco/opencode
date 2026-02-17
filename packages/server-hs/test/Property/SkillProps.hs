{-# LANGUAGE OverloadedStrings #-}

module Property.SkillProps where

import Data.Aeson (encode, object, (.=))
import Data.ByteString.Lazy qualified as BSL
import Data.Text (Text)
import Data.Text qualified as T
import Data.Text.IO qualified as TIO
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Skill.Skill (SkillIndex (..), SkillInfo (..), listSkills, parseSkill, parseSkillIndex)
import System.Directory (createDirectoryIfMissing)
import System.FilePath ((</>))
import System.IO.Temp (createTempDirectory)
import Test.Tasty
import Test.Tasty.Hedgehog

prop_parseSkillFrontmatter :: Property
prop_parseSkillFrontmatter = property $ do
    name <- forAll genNonEmptyText
    desc <- forAll genNonEmptyText
    body <- forAll $ Gen.list (Range.linear 0 5) genText
    let content =
            T.unlines $
                ["---", "name: " <> name, "description: " <> desc, "---"] <> body
    case parseSkill "/tmp/SKILL.md" content of
        Nothing -> failure
        Just skill -> do
            skillName skill === name
            skillDescription skill === desc
            skillContent skill === T.unlines body

prop_parseSkillMissingFrontmatter :: Property
prop_parseSkillMissingFrontmatter = property $ do
    body <- forAll genText
    let content = "no-frontmatter\n" <> body
    parseSkill "/tmp/SKILL.md" content === Nothing

prop_skillDiscoveryFromConfigPath :: Property
prop_skillDiscoveryFromConfigPath = property $ do
    name <- forAll genNonEmptyText
    desc <- forAll genNonEmptyText
    result <- evalIO $ do
        tmp <- createTempDirectory "/tmp" "skill-config"
        let skillsDir = tmp </> "skills" </> T.unpack name
        createDirectoryIfMissing True skillsDir
        let path = skillsDir </> "SKILL.md"
        let content =
                T.unlines
                    [ "---"
                    , "name: " <> name
                    , "description: " <> desc
                    , "---"
                    , "Body"
                    ]
        TIO.writeFile path content
        let cfg =
                object
                    [ "skills"
                        .= object
                            [ "paths" .= [("skills" :: Text)]
                            ]
                    ]
        BSL.writeFile (tmp </> "weapon.json") (encode cfg)
        skills <- listSkills tmp
        pure (any (\skill -> skillName skill == name) skills)
    assert result

prop_parseSkillIndex :: Property
prop_parseSkillIndex = property $ do
    name <- forAll genNonEmptyText
    file <- forAll genNonEmptyText
    let payload =
            object
                [ "skills"
                    .= [ object
                            [ "name" .= name
                            , "files" .= [file]
                            ]
                       ]
                ]
    case parseSkillIndex (BSL.toStrict (encode payload)) of
        Nothing -> failure
        Just idx -> length (siSkills idx) === 1

prop_parseSkillIndexMultiple :: Property
prop_parseSkillIndexMultiple = property $ do
    name1 <- forAll genNonEmptyText
    name2 <- forAll genNonEmptyText
    file1 <- forAll genNonEmptyText
    file2 <- forAll genNonEmptyText
    let payload =
            object
                [ "skills"
                    .= [ object ["name" .= name1, "files" .= [file1]]
                       , object ["name" .= name2, "files" .= [file2]]
                       ]
                ]
    case parseSkillIndex (BSL.toStrict (encode payload)) of
        Nothing -> failure
        Just idx -> length (siSkills idx) === 2

prop_parseSkillIndexInvalid :: Property
prop_parseSkillIndexInvalid = property $ do
    let payload = "not-json"
    parseSkillIndex payload === Nothing

genText :: Gen Text
genText = Gen.text (Range.linear 0 200) Gen.alphaNum

genNonEmptyText :: Gen Text
genNonEmptyText = Gen.text (Range.linear 1 50) Gen.alphaNum

tests :: TestTree
tests =
    testGroup
        "Skill Property Tests"
        [ testProperty "parse skill frontmatter" prop_parseSkillFrontmatter
        , testProperty "missing frontmatter" prop_parseSkillMissingFrontmatter
        , testProperty "discover skills from config paths" prop_skillDiscoveryFromConfigPath
        , testProperty "parse skill index" prop_parseSkillIndex
        , testProperty "parse skill index multiple" prop_parseSkillIndexMultiple
        , testProperty "parse skill index invalid" prop_parseSkillIndexInvalid
        ]
