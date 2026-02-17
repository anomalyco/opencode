{-# LANGUAGE LambdaCase #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE ScopedTypeVariables #-}

module Property.OpenApiProps where

-- Re-export Endpoint type from ApiCompatibilitySpec to avoid duplication
import ApiCompatibilitySpec (Endpoint (..), haskellEndpoints)
import Data.Aeson
import Data.ByteString.Lazy qualified as BSL
import Data.HashMap.Strict qualified as HM
import Data.List (nub)
import Data.Text qualified as T
import Hedgehog
import Hedgehog.Gen qualified as Gen
import Hedgehog.Range qualified as Range
import System.Directory (doesFileExist)

-- | OpenAPI Schema representation
data OpenAPISpec = OpenAPISpec
    { specPaths :: HM.HashMap T.Text PathItem
    , specComponents :: Maybe Components
    }
    deriving (Show)

data PathItem = PathItem
    { pathGet :: Maybe Operation
    , pathPost :: Maybe Operation
    , pathPut :: Maybe Operation
    , pathDelete :: Maybe Operation
    , pathPatch :: Maybe Operation
    }
    deriving (Show)

data Operation = Operation
    { opSummary :: Maybe T.Text
    , opOperationId :: Maybe T.Text
    , opParameters :: Maybe [Parameter]
    , opRequestBody :: Maybe OpenApiRequestBody
    , opResponses :: Maybe (HM.HashMap T.Text OpenApiResponse)
    }
    deriving (Show)

data Parameter = Parameter
    { paramName :: T.Text
    , paramIn :: T.Text
    , paramRequired :: Maybe Bool
    , paramSchema :: Maybe Value
    }
    deriving (Show)

data OpenApiRequestBody = OpenApiRequestBody
    { rbContent :: HM.HashMap T.Text MediaType
    }
    deriving (Show)

data MediaType = MediaType
    { mtSchema :: Maybe Value
    }
    deriving (Show)

data OpenApiResponse = OpenApiResponse
    { respDescription :: T.Text
    , respContent :: Maybe (HM.HashMap T.Text MediaType)
    }
    deriving (Show)

data Components = Components
    { compSchemas :: Maybe (HM.HashMap T.Text Value)
    }
    deriving (Show)

-- JSON Instances
instance FromJSON OpenAPISpec where
    parseJSON = withObject "OpenAPISpec" $ \v ->
        OpenAPISpec <$> v .: "paths" <*> v .:? "components"

instance FromJSON PathItem where
    parseJSON = withObject "PathItem" $ \v ->
        PathItem <$> v .:? "get" <*> v .:? "post" <*> v .:? "put" <*> v .:? "delete" <*> v .:? "patch"

instance FromJSON Operation where
    parseJSON = withObject "Operation" $ \v ->
        Operation <$> v .:? "summary" <*> v .:? "operationId" <*> v .:? "parameters" <*> v .:? "requestBody" <*> v .:? "responses"

instance FromJSON Parameter where
    parseJSON = withObject "Parameter" $ \v ->
        Parameter <$> v .: "name" <*> v .: "in" <*> v .:? "required" <*> v .:? "schema"

instance FromJSON OpenApiRequestBody where
    parseJSON = withObject "RequestBody" $ \v ->
        OpenApiRequestBody <$> v .: "content"

instance FromJSON MediaType where
    parseJSON = withObject "MediaType" $ \v ->
        MediaType <$> v .:? "schema"

instance FromJSON OpenApiResponse where
    parseJSON = withObject "Response" $ \v ->
        OpenApiResponse <$> v .: "description" <*> v .:? "content"

instance FromJSON Components where
    parseJSON = withObject "Components" $ \v ->
        Components <$> v .:? "schemas"

-- | Load OpenAPI spec from file
loadOpenAPISpec :: FilePath -> IO (Either String OpenAPISpec)
loadOpenAPISpec path = do
    exists <- doesFileExist path
    if not exists
        then return $ Left $ "File not found: " ++ path
        else do
            content <- BSL.readFile path
            case decode content of
                Nothing -> return $ Left "Failed to parse JSON"
                Just spec -> return $ Right spec

-- | Generate random path parameter
genPathParam :: T.Text -> Gen T.Text
genPathParam paramName = case T.unpack paramName of
    "sessionID" -> Gen.element ["sess_123", "sess_456", "sess_test"]
    "messageID" -> Gen.element ["msg_123", "msg_456", "msg_test"]
    "partID" -> Gen.element ["part_123", "part_456", "part_test"]
    "ptyID" -> Gen.element ["pty_123", "pty_456", "pty_test"]
    "providerID" -> Gen.element ["openai", "anthropic", "openrouter"]
    "projectID" -> Gen.element ["proj_123", "proj_default"]
    "permissionID" -> Gen.element ["perm_123", "perm_456"]
    "requestID" -> Gen.element ["req_123", "req_456"]
    _ -> Gen.text (Range.linear 3 20) Gen.alphaNum

-- | Generate random query parameter value
genQueryParam :: T.Text -> Gen T.Text
genQueryParam paramName = case T.unpack paramName of
    "directory" -> Gen.element [".", "..", "/tmp", "/home/user"]
    "path" -> Gen.element [".", "README.md", "src", "package.json"]
    "limit" -> T.pack . show <$> Gen.int (Range.linear 1 100)
    "roots" -> Gen.element ["true", "false"]
    "pattern" -> Gen.element ["foo", "bar", ".*", "test"]
    "query" -> Gen.element ["search", "find", "test"]
    _ -> Gen.text (Range.linear 1 10) Gen.alphaNum

-- | Build URL with path and query parameters
buildUrl :: T.Text -> [T.Text] -> [(T.Text, T.Text)] -> T.Text
buildUrl base pathParams queryParams =
    let path = foldl (\acc p -> T.replace ("{" <> p <> "}") p acc) base pathParams
        query = T.intercalate "&" $ map (\(k, v) -> k <> "=" <> v) queryParams
     in if T.null query then path else path <> "?" <> query

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
    -- All params should be non-empty when in braces
    assert $ all (not . T.null) params
  where
    extractPathParams p =
        let parts = T.splitOn "{" p
            rest = map (T.takeWhile (/= '}')) (drop 1 parts)
         in filter (not . T.null) rest

prop_noQueryInPaths :: Property
prop_noQueryInPaths = property $ do
    endpoint <- forAll $ Gen.element haskellEndpoints
    assert $ not ("?" `T.isInfixOf` path endpoint)

prop_methodUppercase :: Property
prop_methodUppercase = property $ do
    endpoint <- forAll $ Gen.element haskellEndpoints
    method endpoint === T.toUpper (method endpoint)

prop_uniqueMethodPaths :: Property
prop_uniqueMethodPaths = property $ do
    let entries = map (\ep -> (method ep, path ep)) haskellEndpoints
    length entries === length (nub entries)

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
                , ("noQueryInPaths", prop_noQueryInPaths)
                , ("methodUppercase", prop_methodUppercase)
                , ("uniqueMethodPaths", prop_uniqueMethodPaths)
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
    ok <- runPropertyTests

    if ok
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
