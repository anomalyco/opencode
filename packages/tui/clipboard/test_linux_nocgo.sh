#!/bin/bash
# Test script for Linux CGO-free clipboard implementation

echo "Testing Linux clipboard implementation without CGO..."

# Check for required tools
echo "Checking for clipboard tools..."
for tool in xclip xsel wl-copy; do
    if command -v $tool &> /dev/null; then
        echo "✓ $tool is installed"
    else
        echo "✗ $tool is not installed"
    fi
done

# Create test program
cat > test_linux_clipboard.go << 'EOF'
package main

import (
    "fmt"
    "log"
    "os"
    "golang.design/x/clipboard"
)

func main() {
    err := clipboard.Init()
    if err != nil {
        log.Fatal("Failed to initialize clipboard:", err)
    }
    
    // Test text
    fmt.Println("\n=== Testing Text Clipboard ===")
    testText := []byte("Hello from CGO-free Linux clipboard!")
    clipboard.Write(clipboard.FmtText, testText)
    fmt.Println("Wrote text:", string(testText))
    
    readText := clipboard.Read(clipboard.FmtText)
    fmt.Println("Read text:", string(readText))
    
    if string(testText) == string(readText) {
        fmt.Println("✓ Text clipboard test passed")
    } else {
        fmt.Println("✗ Text clipboard test failed")
    }
    
    // Test empty write
    fmt.Println("\n=== Testing Empty Write ===")
    clipboard.Write(clipboard.FmtText, []byte{})
    emptyRead := clipboard.Read(clipboard.FmtText)
    if emptyRead == nil || len(emptyRead) == 0 {
        fmt.Println("✓ Empty write test passed")
    } else {
        fmt.Println("✗ Empty write test failed, got:", string(emptyRead))
    }
    
    // Test image if requested
    if len(os.Args) > 1 && os.Args[1] == "image" {
        fmt.Println("\n=== Testing Image Clipboard ===")
        
        // Try to read test image
        imageData, err := os.ReadFile("tests/testdata/clipboard.png")
        if err != nil {
            fmt.Println("Could not read test image:", err)
            return
        }
        
        clipboard.Write(clipboard.FmtImage, imageData)
        fmt.Println("Wrote image data, length:", len(imageData))
        
        readImage := clipboard.Read(clipboard.FmtImage)
        if readImage != nil {
            fmt.Println("Read image data, length:", len(readImage))
            if len(imageData) == len(readImage) {
                fmt.Println("✓ Image clipboard test passed")
            } else {
                fmt.Println("✗ Image lengths don't match")
            }
        } else {
            fmt.Println("✗ Failed to read image from clipboard")
        }
        
        // Test that reading text from image clipboard returns nil
        textFromImage := clipboard.Read(clipboard.FmtText)
        if textFromImage == nil {
            fmt.Println("✓ Reading text from image clipboard correctly returned nil")
        } else {
            fmt.Println("✗ Reading text from image clipboard should return nil, got:", string(textFromImage))
        }
    }
}
EOF

# Run tests with CGO disabled
echo -e "\n=== Running with CGO_ENABLED=0 ==="
CGO_ENABLED=0 go run test_linux_clipboard.go

echo -e "\n=== Running with CGO_ENABLED=0 and image test ==="
CGO_ENABLED=0 go run test_linux_clipboard.go image

# Run actual tests
echo -e "\n=== Running go test with CGO_ENABLED=0 ==="
CGO_ENABLED=0 go test -v -run TestClipboard

# Clean up
rm -f test_linux_clipboard.go

echo -e "\nTest script completed!"