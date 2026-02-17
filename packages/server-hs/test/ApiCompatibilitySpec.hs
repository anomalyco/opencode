{-# LANGUAGE OverloadedStrings #-}

module ApiCompatibilitySpec where

import Data.Text qualified as T
import Test.Hspec

-- | Simple endpoint representation
data Endpoint = Endpoint
  { method :: T.Text,
    path :: T.Text
  }
  deriving (Eq, Show)

-- | Endpoints implemented in Haskell server
haskellEndpoints :: [Endpoint]
haskellEndpoints =
  [ Endpoint "GET" "/global/health",
    Endpoint "GET" "/path",
    Endpoint "GET" "/global/config",
    Endpoint "GET" "/project",
    Endpoint "GET" "/project/current",
    Endpoint "GET" "/config/providers",
    Endpoint "GET" "/provider/auth",
    Endpoint "GET" "/agent",
    Endpoint "GET" "/config",
    Endpoint "GET" "/command",
    Endpoint "GET" "/session/status",
    Endpoint "GET" "/session",
    Endpoint "POST" "/session",
    Endpoint "GET" "/session/{sessionID}/message",
    Endpoint "POST" "/session/{sessionID}/message",
    Endpoint "GET" "/lsp",
    Endpoint "GET" "/vcs",
    Endpoint "GET" "/permission",
    Endpoint "GET" "/question",
    Endpoint "GET" "/file",
    Endpoint "GET" "/file/content",
    Endpoint "GET" "/global/event",
    Endpoint "GET" "/pty",
    Endpoint "POST" "/pty",
    Endpoint "GET" "/pty/{ptyID}",
    Endpoint "PUT" "/pty/{ptyID}",
    Endpoint "DELETE" "/pty/{ptyID}",
    Endpoint "GET" "/pty/{ptyID}/connect",
    Endpoint "POST" "/pty/{ptyID}/commit",
    Endpoint "GET" "/pty/{ptyID}/changes",
    Endpoint "POST" "/chat"
  ]

-- | Endpoints in TypeScript server but NOT in Haskell
-- Based on analysis of packages/weapon/src/server/routes/*.ts
typescriptOnlyEndpoints :: [Endpoint]
typescriptOnlyEndpoints =
  [ -- Auth routes
    Endpoint "POST" "/auth/{providerID}",
    Endpoint "DELETE" "/auth/{providerID}",
    Endpoint "PUT" "/auth/{providerID}",
    -- Session detail routes
    Endpoint "GET" "/session/{sessionID}",
    Endpoint "DELETE" "/session/{sessionID}",
    Endpoint "PATCH" "/session/{sessionID}",
    -- Session child routes
    Endpoint "GET" "/session/{sessionID}/children",
    -- Session todo routes
    Endpoint "GET" "/session/{sessionID}/todo",
    -- Session init routes
    Endpoint "POST" "/session/{sessionID}/init",
    -- Session fork routes
    Endpoint "POST" "/session/{sessionID}/fork",
    -- Session abort routes
    Endpoint "POST" "/session/{sessionID}/abort",
    -- Session share routes
    Endpoint "POST" "/session/{sessionID}/share",
    Endpoint "DELETE" "/session/{sessionID}/share",
    -- Session diff routes
    Endpoint "GET" "/session/{sessionID}/diff",
    -- Session summarize routes
    Endpoint "POST" "/session/{sessionID}/summarize",
    -- Session command routes
    Endpoint "POST" "/session/{sessionID}/command",
    -- Session shell routes
    Endpoint "POST" "/session/{sessionID}/shell",
    -- Session revert routes
    Endpoint "POST" "/session/{sessionID}/revert",
    -- Session unrevert routes
    Endpoint "POST" "/session/{sessionID}/unrevert",
    -- Session permissions routes
    Endpoint "POST" "/session/{sessionID}/permissions/{permissionID}",
    -- Message detail routes
    Endpoint "GET" "/session/{sessionID}/message/{messageID}",
    -- Part routes
    Endpoint "DELETE" "/session/{sessionID}/message/{messageID}/part/{partID}",
    Endpoint "PATCH" "/session/{sessionID}/message/{messageID}/part/{partID}",
    -- Prompt async routes
    Endpoint "POST" "/session/{sessionID}/prompt_async",
    -- Question routes
    Endpoint "POST" "/question/{requestID}/reply",
    Endpoint "POST" "/question/{requestID}/reject",
    -- Permission routes
    Endpoint "POST" "/permission/{requestID}/reply",
    -- Provider routes
    Endpoint "GET" "/provider",
    Endpoint "POST" "/provider/{providerID}/oauth/authorize",
    Endpoint "POST" "/provider/{providerID}/oauth/callback",
    -- Project routes
    Endpoint "GET" "/project/{projectID}",
    -- Find routes
    Endpoint "GET" "/find",
    Endpoint "GET" "/find/file",
    Endpoint "GET" "/find/symbol",
    -- File status routes
    Endpoint "GET" "/file/status",
    -- TUI routes
    Endpoint "POST" "/tui/append-prompt",
    Endpoint "POST" "/tui/open-help",
    Endpoint "POST" "/tui/open-sessions",
    Endpoint "POST" "/tui/open-themes",
    Endpoint "POST" "/tui/open-models",
    Endpoint "POST" "/tui/submit-prompt",
    Endpoint "POST" "/tui/clear-prompt",
    Endpoint "POST" "/tui/execute-command",
    Endpoint "POST" "/tui/show-toast",
    Endpoint "POST" "/tui/publish",
    Endpoint "POST" "/tui/select-session",
    Endpoint "POST" "/tui/control/next",
    Endpoint "POST" "/tui/control/response",
    -- Instance routes
    Endpoint "POST" "/instance/dispose",
    -- Log routes
    Endpoint "POST" "/log",
    -- Skill routes
    Endpoint "GET" "/skill",
    -- Formatter routes
    Endpoint "GET" "/formatter",
    -- Experimental routes
    Endpoint "GET" "/experimental/tool/ids",
    Endpoint "POST" "/experimental/tool",
    Endpoint "GET" "/experimental/worktree",
    Endpoint "POST" "/experimental/worktree",
    Endpoint "POST" "/experimental/worktree/reset"
  ]

-- | Test spec
spec :: Spec
spec = do
  describe "API Compatibility Analysis" $ do
    it "reports Haskell server endpoints" $ do
      putStrLn $ "\nHaskell server implements " ++ show (length haskellEndpoints) ++ " endpoints"

    it "reports TypeScript-only endpoints" $ do
      putStrLn $ "TypeScript server has " ++ show (length typescriptOnlyEndpoints) ++ " additional endpoints"
      putStrLn "\nMissing in Haskell server:"
      mapM_ (putStrLn . ("  - " ++) . show) typescriptOnlyEndpoints

    it "calculates API coverage" $ do
      let total = length haskellEndpoints + length typescriptOnlyEndpoints
      let coverage = fromIntegral (length haskellEndpoints) / fromIntegral total * 100 :: Double
      putStrLn $ "\nAPI Coverage: " ++ show (round coverage) ++ "%"
      putStrLn $ "(" ++ show (length haskellEndpoints) ++ " / " ++ show total ++ " endpoints)"
