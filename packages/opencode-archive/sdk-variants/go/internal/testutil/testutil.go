package testutil

import (
	"net/http"
	"os"
	"strconv"
	"testing"
)

func CheckTestServer(t *testing.T, url string) bool {
	if _, err := http.Get(url); err != nil {
		const SKIP_MOCK_TESTS = "SKIP_MOCK_TESTS"
		if str, ok := os.LookupEnv(SKIP_MOCK_TESTS); ok {
			skip, err := strconv.ParseBool(str)
			if err != nil {
				t.Fatalf("strconv.ParseBool(os.LookupEnv(%s)) failed: %s", SKIP_MOCK_TESTS, err)
			}
			if skip {
				t.Skip("The test will not run without a mock Prism server running against your OpenAPI spec")
				return false
			}
			t.Errorf("The test will not run without a mock Prism server running against your OpenAPI spec. You can set the environment variable %s to true to skip running any tests that require the mock server", SKIP_MOCK_TESTS)
			return false
		}
	}
	return true
}
