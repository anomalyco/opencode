package app

import (
	"testing"

	"github.com/sst/opencode-sdk-go"
)

// TestFindModelByFullID tests the findModelByFullID function
func TestFindModelByFullID(t *testing.T) {
	// Create test providers with models
	providers := []opencode.Provider{
		{
			ID: "anthropic",
			Models: map[string]opencode.Model{
				"claude-3-opus-20240229":   {ID: "claude-3-opus-20240229"},
				"claude-3-sonnet-20240229": {ID: "claude-3-sonnet-20240229"},
			},
		},
		{
			ID: "openai",
			Models: map[string]opencode.Model{
				"gpt-4":         {ID: "gpt-4"},
				"gpt-3.5-turbo": {ID: "gpt-3.5-turbo"},
			},
		},
	}

	tests := []struct {
		name               string
		fullModelID        string
		expectedFound      bool
		expectedProviderID string
		expectedModelID    string
	}{
		{
			name:               "valid full model ID",
			fullModelID:        "anthropic/claude-3-opus-20240229",
			expectedFound:      true,
			expectedProviderID: "anthropic",
			expectedModelID:    "claude-3-opus-20240229",
		},
		{
			name:               "valid full model ID with slash in model name",
			fullModelID:        "openai/gpt-3.5-turbo",
			expectedFound:      true,
			expectedProviderID: "openai",
			expectedModelID:    "gpt-3.5-turbo",
		},
		{
			name:          "invalid format - missing slash",
			fullModelID:   "anthropic",
			expectedFound: false,
		},
		{
			name:          "invalid format - empty string",
			fullModelID:   "",
			expectedFound: false,
		},
		{
			name:          "provider not found",
			fullModelID:   "nonexistent/model",
			expectedFound: false,
		},
		{
			name:          "model not found",
			fullModelID:   "anthropic/nonexistent-model",
			expectedFound: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider, model := findModelByFullID(providers, tt.fullModelID)

			if tt.expectedFound {
				if provider == nil || model == nil {
					t.Errorf("Expected to find provider/model, but got nil")
					return
				}

				if provider.ID != tt.expectedProviderID {
					t.Errorf("Expected provider ID %s, got %s", tt.expectedProviderID, provider.ID)
				}

				if model.ID != tt.expectedModelID {
					t.Errorf("Expected model ID %s, got %s", tt.expectedModelID, model.ID)
				}
			} else {
				if provider != nil || model != nil {
					t.Errorf("Expected not to find provider/model, but got provider: %v, model: %v", provider, model)
				}
			}
		})
	}
}

// TestFindModelByProviderAndModelID tests the findModelByProviderAndModelID function
func TestFindModelByProviderAndModelID(t *testing.T) {
	// Create test providers with models
	providers := []opencode.Provider{
		{
			ID: "anthropic",
			Models: map[string]opencode.Model{
				"claude-3-opus-20240229":   {ID: "claude-3-opus-20240229"},
				"claude-3-sonnet-20240229": {ID: "claude-3-sonnet-20240229"},
			},
		},
		{
			ID: "openai",
			Models: map[string]opencode.Model{
				"gpt-4":         {ID: "gpt-4"},
				"gpt-3.5-turbo": {ID: "gpt-3.5-turbo"},
			},
		},
	}

	tests := []struct {
		name               string
		providerID         string
		modelID            string
		expectedFound      bool
		expectedProviderID string
		expectedModelID    string
	}{
		{
			name:               "valid provider and model",
			providerID:         "anthropic",
			modelID:            "claude-3-opus-20240229",
			expectedFound:      true,
			expectedProviderID: "anthropic",
			expectedModelID:    "claude-3-opus-20240229",
		},
		{
			name:          "provider not found",
			providerID:    "nonexistent",
			modelID:       "claude-3-opus-20240229",
			expectedFound: false,
		},
		{
			name:          "model not found",
			providerID:    "anthropic",
			modelID:       "nonexistent-model",
			expectedFound: false,
		},
		{
			name:          "both provider and model not found",
			providerID:    "nonexistent",
			modelID:       "nonexistent-model",
			expectedFound: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider, model := findModelByProviderAndModelID(providers, tt.providerID, tt.modelID)

			if tt.expectedFound {
				if provider == nil || model == nil {
					t.Errorf("Expected to find provider/model, but got nil")
					return
				}

				if provider.ID != tt.expectedProviderID {
					t.Errorf("Expected provider ID %s, got %s", tt.expectedProviderID, provider.ID)
				}

				if model.ID != tt.expectedModelID {
					t.Errorf("Expected model ID %s, got %s", tt.expectedModelID, model.ID)
				}
			} else {
				if provider != nil || model != nil {
					t.Errorf("Expected not to find provider/model, but got provider: %v, model: %v", provider, model)
				}
			}
		})
	}
}

// TestFindProviderByID tests the findProviderByID function
func TestFindProviderByID(t *testing.T) {
	// Create test providers
	providers := []opencode.Provider{
		{ID: "anthropic"},
		{ID: "openai"},
		{ID: "google"},
	}

	tests := []struct {
		name               string
		providerID         string
		expectedFound      bool
		expectedProviderID string
	}{
		{
			name:               "provider found",
			providerID:         "anthropic",
			expectedFound:      true,
			expectedProviderID: "anthropic",
		},
		{
			name:          "provider not found",
			providerID:    "nonexistent",
			expectedFound: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			provider := findProviderByID(providers, tt.providerID)

			if tt.expectedFound {
				if provider == nil {
					t.Errorf("Expected to find provider, but got nil")
					return
				}

				if provider.ID != tt.expectedProviderID {
					t.Errorf("Expected provider ID %s, got %s", tt.expectedProviderID, provider.ID)
				}
			} else {
				if provider != nil {
					t.Errorf("Expected not to find provider, but got %v", provider)
				}
			}
		})
	}
}
