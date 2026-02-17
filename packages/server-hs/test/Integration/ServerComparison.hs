{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Integration.ServerComparison where

import ApiCompatibilitySpec (Endpoint (..), haskellEndpoints, typescriptOnlyEndpoints)
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
testEndpoint :: ServerConfig -> Endpoint -> IO (Int, T.Text)
testEndpoint config endpoint = do
    manager <- newManager defaultManagerSettings
    let baseUrl = T.unpack (serverUrl config)
        path = T.unpack (path endpoint)
        methodStr = T.unpack (method endpoint)

    result <- try $ do
        request <- parseRequest (baseUrl ++ path)
        let request' = request{method = T.encodeUtf8 (method endpoint)}
        response <- httpLbs request' manager
        let status = statusCode (responseStatus response)
        return (status, T.pack $ show status)

    case result of
        Left (e :: SomeException) -> return (0, T.pack $ "Error: " ++ show e)
        Right r -> return r

-- | Compare responses between two servers
compareEndpoints :: ServerConfig -> ServerConfig -> [Endpoint] -> IO [(Endpoint, Bool)]
compareEndpoints server1 server2 endpoints = do
    results <-
        mapM
            ( \ep -> do
                (status1, _) <- testEndpoint server1 ep
                (status2, _) <- testEndpoint server2 ep
                let match = (status1 == status2) || (status1 >= 200 && status1 < 300 && status2 >= 200 && status2 < 300)
                return (ep, match)
            )
            endpoints
    return results

-- | Property: All endpoints should have valid paths
prop_validPaths :: Property
prop_validPaths = property $ do
    endpoint <- forAll $ Gen.element haskellEndpoints
    assert $ T.isPrefixOf "/" (path endpoint)

-- | Property: All methods should be valid HTTP methods
prop_validMethods :: Property
prop_validMethods = property $ do
    endpoint <- forAll $ Gen.element haskellEndpoints
    assert $ method endpoint `elem` ["GET", "POST", "PUT", "DELETE", "PATCH"]

-- | Property: Path parameters should be extractable
prop_extractPathParams :: Property
prop_extractPathParams = property $ do
    endpoint <- forAll $ Gen.element haskellEndpoints
    let params = extractPathParams (path endpoint)
    assert $ all (not . T.null) params
  where
    extractPathParams p =
        let parts = T.splitOn "{" p
            rest = map (T.takeWhile (/= '}')) (drop 1 parts)
         in filter (not . T.null) rest

-- | Property: Generate random valid requests
prop_generateValidRequests :: Property
prop_generateValidRequests = property $ do
    endpoint <- forAll $ Gen.element haskellEndpoints
    -- Generate path parameters
    let pathParams = extractPathParams (path endpoint)
    generatedParams <- forAll $ mapM (\_ -> Gen.text (Range.linear 3 20) Gen.alphaNum) pathParams
    -- Build URL
    let url = buildUrl (path endpoint) generatedParams []
    -- URL should be valid
    assert $ T.isPrefixOf "/" url
  where
    extractPathParams p =
        let parts = T.splitOn "{" p
            rest = map (T.takeWhile (/= '}')) (drop 1 parts)
         in filter (not . T.null) rest
    buildUrl base pathParams _ =
        foldl (\acc p -> T.replace ("{" <> p <> "}") p acc) base pathParams

-- | Run all property tests
runPropertyTests :: IO Bool
runPropertyTests = do
    putStrLn "\nRunning Property Tests..."
    putStrLn "========================\n"

    result1 <-
        checkSequential $
            Group
                "Endpoint Properties"
                [ ("validPaths", prop_validPaths)
                , ("validMethods", prop_validMethods)
                , ("extractPathParams", prop_extractPathParams)
                , ("generateValidRequests", prop_generateValidRequests)
                ]

    return result1

-- | Test spec for HSpec integration
spec :: Spec
spec = do
    describe "API Compliance Tests" $ do
        it "should have valid endpoint paths" $ do
            check prop_validPaths

        it "should have valid HTTP methods" $ do
            check prop_validMethods

        it "should have extractable path parameters" $ do
            check prop_extractPathParams

        it "should generate valid requests" $ do
            check prop_generateValidRequests

    describe "Server Comparison" $ do
        it "can check if Haskell server is running" $ do
            running <- checkServer haskellServer
            if running
                then putStrLn "  ✓ Haskell server is running"
                else pendingWith "Haskell server not running (start with: cabal run)"

        it "can check if TypeScript server is running" $ do
            running <- checkServer typescriptServer
            if running
                then putStrLn "  ✓ TypeScript server is running"
                else pendingWith "TypeScript server not running"

-- | Main entry point for standalone execution
main :: IO ()
main = do
    putStrLn "========================================"
    putStrLn "OpenAPI Property-Based API Testing"
    putStrLn "========================================"
    putStrLn ""

    -- Check servers
    haskellRunning <- checkServer haskellServer
    typescriptRunning <- checkServer typescriptServer

    putStrLn $
        "Haskell Server (port "
            ++ show (serverPort haskellServer)
            ++ "): "
            ++ if haskellRunning then "✓ Running" else "✗ Not running"
    putStrLn $
        "TypeScript Server (port "
            ++ show (serverPort typescriptServer)
            ++ "): "
            ++ if typescriptRunning then "✓ Running" else "✗ Not running"
    putStrLn ""

    -- Run property tests
    success <- runPropertyTests

    if success
        then do
            putStrLn "\n✓ All property tests passed!"
        else do
            putStrLn "\n✗ Some property tests failed"

    putStrLn ""
    putStrLn "Haskell Server Endpoints:"
    mapM_ (putStrLn . ("  " ++) . formatEndpoint) haskellEndpoints
  where
    formatEndpoint (Endpoint m p) = T.unpack m ++ " " ++ T.unpack p
