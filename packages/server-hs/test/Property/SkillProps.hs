{-# LANGUAGE OverloadedStrings #-}

module Property.SkillProps where

import Data.Text (Text)
import Data.Text qualified as T
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import Skill.Skill (SkillInfo (..), parseSkill)
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
        ]
