{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Integration.ApiCompliance where

import Control.Concurrent (threadDelay)
import Control.Exception (SomeException, try)
import Control.Monad.IO.Class (liftIO)
import Data.Aeson
import qualified Data.ByteString.Lazy as BSL
import Data.Maybe (fromMaybe)
import qualified Data.Text as T
import Hedgehog
import qualified Hedgehog.Gen as Gen
import qualified Hedgehog.Range as Range
import Network.HTTP.Client
import Network.HTTP.Types.Status (statusCode)
import System.Exit (ExitCode (..))
import System.Process (readProcessWithExitCode)
import Test.Hspec
import Text.Regex.PCRE ((=~))

-- | Server configuration
data ServerConfig = ServerConfig
    { serverName :: T.Text
    , serverPort :: Int
    , serverUrl :: T.Text
    }
    deriving (Show)

-- | Default server configs
haskellServer :: ServerConfig
haskellServer = ServerConfig "Haskell" 8080 "http://localhost:8080"

typescriptServer :: ServerConfig
typescriptServer = ServerConfig "TypeScript" 4096 "http://localhost:4096"

-- | API Endpoint definition
data ApiEndpoint = ApiEndpoint
    { epPath :: T.Text
    , epMethod :: T.Text
    , epQueryParams :: [T.Text]
    , epPathParams :: [T.Text]
    , epHasBody :: Bool
    }
    deriving (Eq, Show)

-- | Expected endpoints from Haskell Api.hs
haskellEndpoints :: [ApiEndpoint]
haskellEndpoints =
    [ ApiEndpoint "/global/health" "GET" [] [] False
    , ApiEndpoint "/path" "GET" [] [] False
    , ApiEndpoint "/global/config" "GET" [] [] False
    , ApiEndpoint "/project" "GET" [] [] False
    , ApiEndpoint "/project/current" "GET" ["directory"] [] False
    , ApiEndpoint "/config/providers" "GET" [] [] False
    , ApiEndpoint "/provider/auth" "GET" [] [] False
    , ApiEndpoint "/agent" "GET" [] [] False
    , ApiEndpoint "/config" "GET" [] [] False
    , ApiEndpoint "/command" "GET" [] [] False
    , ApiEndpoint "/session/status" "GET" [] [] False
    , ApiEndpoint "/session" "GET" ["directory", "roots", "limit"] [] False
    , ApiEndpoint "/session" "POST" ["directory"] [] True
    , ApiEndpoint "/session/{sessionID}/message" "GET" ["limit"] ["sessionID"] False
    , ApiEndpoint "/session/{sessionID}/message" "POST" [] ["sessionID"] True
    , ApiEndpoint "/lsp" "GET" [] [] False
    , ApiEndpoint "/vcs" "GET" [] [] False
    , ApiEndpoint "/permission" "GET" [] [] False
    , ApiEndpoint "/question" "GET" [] [] False
    , ApiEndpoint "/file" "GET" ["directory", "path"] [] False
    , ApiEndpoint "/file/content" "GET" ["directory", "path"] [] False
    , ApiEndpoint "/global/event" "GET" [] [] False
    , ApiEndpoint "/pty" "GET" [] [] False
    , ApiEndpoint "/pty" "POST" [] [] True
    , ApiEndpoint "/pty/{ptyID}" "GET" [] ["ptyID"] False
    , ApiEndpoint "/pty/{ptyID}" "PUT" [] ["ptyID"] True
    , ApiEndpoint "/pty/{ptyID}" "DELETE" [] ["ptyID"] False
    , ApiEndpoint "/pty/{ptyID}/connect" "GET" [] ["ptyID"] False
    , ApiEndpoint "/pty/{ptyID}/commit" "POST" [] ["ptyID"] False
    , ApiEndpoint "/pty/{ptyID}/changes" "GET" [] ["ptyID"] False
    , ApiEndpoint "/chat" "POST" [] [] True
    ]

-- | Check if server is running
checkServer :: ServerConfig -> IO Bool
checkServer config = do
    manager <- newManager defaultManagerSettings
    let url = T.unpack (serverUrl config) ++ "/global/health"
    result <- try $ do
        request <- parseRequest url
        response <- httpLbs request manager
        return $ statusCode (responseStatus response) == 200
    case result of
        Left (_ :: SomeException) -> return False
        Right ok -> return ok

-- | Make HTTP request to endpoint
testEndpoint :: ServerConfig -> ApiEndpoint -> IO (Int, T.Text)
testEndpoint config endpoint = do
    manager <- newManager defaultManagerSettings
    let baseUrl = T.unpack (serverUrl config)
        path = T.unpack (epPath endpoint)
        method = epMethod endpoint

    result <- try $ do
        request <- parseRequest (baseUrl ++ path)
        let request' = request{method = T.encodeUtf8 method}
        response <- httpLbs request' manager
        let status = statusCode (responseStatus response)
        return (status, T.pack $ show status)

    case result of
        Left (e :: SomeException) -> return (0, T.pack $ "Error: " ++ show e)
        Right r -> return r

-- | Property: All endpoints should have valid paths
prop_validPaths :: Property
prop_validPaths = property $ do
    endpoint <- forAll $ Gen.element haskellEndpoints
    assert $ T.isPrefixOf "/" (epPath endpoint)

-- | Property: All methods should be valid HTTP methods
prop_validMethods :: Property
prop_validMethods = property $ do
    endpoint <- forAll $ Gen.element haskellEndpoints
    assert $ epMethod endpoint `elem` ["GET", "POST", "PUT", "DELETE", "PATCH"]

-- | Property: Path parameters should be extractable
prop_extractPathParams :: Property
prop_extractPathParams = property $ do
    endpoint <- forAll $ Gen.element haskellEndpoints
    let params = extractPathParams (epPath endpoint)
    -- All params should be non-empty when in braces
    assert $ all (not . T.null) params
  where
    extractPathParams p =
        let parts = T.splitOn "{" p
            rest = map (T.takeWhile (/= '}')) (drop 1 parts)
         in filter (not . T.null) rest

-- | Run all property tests
runPropertyTests :: IO Bool
runPropertyTests = do
    putStrLn "\nRunning Property Tests..."
    putStrLn "========================\n"

    result1 <-
        checkSequential $
            Group
                "Path Properties"
                [ ("validPaths", prop_validPaths)
                , ("validMethods", prop_validMethods)
                , ("extractPathParams", prop_extractPathParams)
                ]

    return result1

-- | Main entry point
main :: IO ()
main = do
    putStrLn "========================================"
    putStrLn "OpenAPI Property-Based API Testing"
    putStrLn "========================================"
    putStrLn ""

    -- Load OpenAPI spec
    specResult <- loadOpenAPISpec "../openapi/openapi.json"
    case specResult of
        Left err -> do
            putStrLn $ "Warning: " ++ err
            putStrLn "Running basic property tests..."
        Right spec -> do
            putStrLn $ "Loaded OpenAPI spec with " ++ show (HM.size $ specPaths spec) ++ " paths"

    -- Run property tests
    success <- runPropertyTests

    if success
        then do
            putStrLn "\n✓ All property tests passed!"
            putStrLn ""
            putStrLn "To run full property-based tests with Schemathesis:"
            putStrLn "  ./scripts/property-test-openapi.sh"
        else do
            putStrLn "\n✗ Some property tests failed"

    putStrLn ""
    putStrLn "Haskell Server Endpoints:"
    mapM_ (putStrLn . ("  " ++) . formatEndpoint) haskellEndpoints
  where
    formatEndpoint (Endpoint m p) = T.unpack m ++ " " ++ T.unpack p
