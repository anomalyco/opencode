{-# LANGUAGE OverloadedStrings #-}

module ApiCompatibilitySpec where

import Data.Text qualified as T
import Test.Hspec

-- | Simple endpoint representation
data Endpoint = Endpoint
    { method :: T.Text
    , path :: T.Text
    }
    deriving (Eq, Show)

-- | Endpoints implemented in Haskell server
haskellEndpoints :: [Endpoint]
haskellEndpoints =
    [ Endpoint "GET" "/global/health"
    , Endpoint "GET" "/path"
    , Endpoint "GET" "/global/config"
    , Endpoint "GET" "/project"
    , Endpoint "GET" "/project/{projectID}"
    , Endpoint "GET" "/project/current"
    , Endpoint "GET" "/config/providers"
    , Endpoint "GET" "/provider/auth"
    , Endpoint "GET" "/provider"
    , Endpoint "POST" "/provider/{providerID}/oauth/authorize"
    , Endpoint "POST" "/provider/{providerID}/oauth/callback"
    , Endpoint "POST" "/auth/{providerID}"
    , Endpoint "PUT" "/auth/{providerID}"
    , Endpoint "DELETE" "/auth/{providerID}"
    , Endpoint "GET" "/agent"
    , Endpoint "GET" "/config"
    , Endpoint "GET" "/command"
    , Endpoint "GET" "/session/status"
    , Endpoint "GET" "/session"
    , Endpoint "POST" "/session"
    , Endpoint "GET" "/session/{sessionID}"
    , Endpoint "DELETE" "/session/{sessionID}"
    , Endpoint "PATCH" "/session/{sessionID}"
    , Endpoint "GET" "/session/{sessionID}/children"
    , Endpoint "GET" "/session/{sessionID}/todo"
    , Endpoint "POST" "/session/{sessionID}/init"
    , Endpoint "POST" "/session/{sessionID}/fork"
    , Endpoint "POST" "/session/{sessionID}/abort"
    , Endpoint "POST" "/session/{sessionID}/share"
    , Endpoint "DELETE" "/session/{sessionID}/share"
    , Endpoint "GET" "/session/{sessionID}/diff"
    , Endpoint "POST" "/session/{sessionID}/summarize"
    , Endpoint "POST" "/session/{sessionID}/command"
    , Endpoint "POST" "/session/{sessionID}/shell"
    , Endpoint "POST" "/session/{sessionID}/revert"
    , Endpoint "POST" "/session/{sessionID}/unrevert"
    , Endpoint "POST" "/session/{sessionID}/permissions/{permissionID}"
    , Endpoint "GET" "/session/{sessionID}/message"
    , Endpoint "POST" "/session/{sessionID}/message"
    , Endpoint "GET" "/session/{sessionID}/message/{messageID}"
    , Endpoint "DELETE" "/session/{sessionID}/message/{messageID}/part/{partID}"
    , Endpoint "PATCH" "/session/{sessionID}/message/{messageID}/part/{partID}"
    , Endpoint "POST" "/session/{sessionID}/prompt_async"
    , Endpoint "GET" "/lsp"
    , Endpoint "GET" "/vcs"
    , Endpoint "GET" "/permission"
    , Endpoint "POST" "/permission/{requestID}/reply"
    , Endpoint "GET" "/question"
    , Endpoint "POST" "/question/{requestID}/reply"
    , Endpoint "POST" "/question/{requestID}/reject"
    , Endpoint "GET" "/find"
    , Endpoint "GET" "/find/file"
    , Endpoint "GET" "/find/symbol"
    , Endpoint "GET" "/file"
    , Endpoint "GET" "/file/content"
    , Endpoint "GET" "/file/status"
    , Endpoint "GET" "/global/event"
    , Endpoint "GET" "/pty"
    , Endpoint "POST" "/pty"
    , Endpoint "GET" "/pty/{ptyID}"
    , Endpoint "PUT" "/pty/{ptyID}"
    , Endpoint "DELETE" "/pty/{ptyID}"
    , Endpoint "GET" "/pty/{ptyID}/connect"
    , Endpoint "POST" "/pty/{ptyID}/commit"
    , Endpoint "GET" "/pty/{ptyID}/changes"
    , Endpoint "POST" "/tui/append-prompt"
    , Endpoint "POST" "/tui/open-help"
    , Endpoint "POST" "/tui/open-sessions"
    , Endpoint "POST" "/tui/open-themes"
    , Endpoint "POST" "/tui/open-models"
    , Endpoint "POST" "/tui/submit-prompt"
    , Endpoint "POST" "/tui/clear-prompt"
    , Endpoint "POST" "/tui/execute-command"
    , Endpoint "POST" "/tui/show-toast"
    , Endpoint "POST" "/tui/publish"
    , Endpoint "POST" "/tui/select-session"
    , Endpoint "POST" "/tui/control/next"
    , Endpoint "POST" "/tui/control/response"
    , Endpoint "POST" "/instance/dispose"
    , Endpoint "POST" "/log"
    , Endpoint "GET" "/skill"
    , Endpoint "GET" "/formatter"
    , Endpoint "GET" "/experimental/tool/ids"
    , Endpoint "POST" "/experimental/tool"
    , Endpoint "GET" "/experimental/worktree"
    , Endpoint "POST" "/experimental/worktree"
    , Endpoint "POST" "/experimental/worktree/reset"
    , Endpoint "POST" "/chat"
    ]

{- | Endpoints in TypeScript server but NOT in Haskell
Based on analysis of packages/weapon/src/server/routes/*.ts
-}
typescriptOnlyEndpoints :: [Endpoint]
typescriptOnlyEndpoints = []

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
            putStrLn $ "\nAPI Coverage: " ++ show (round coverage :: Int) ++ "%"
            putStrLn $ "(" ++ show (length haskellEndpoints) ++ " / " ++ show total ++ " endpoints)"
