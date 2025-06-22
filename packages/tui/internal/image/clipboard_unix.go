//go:build !windows

package image

import (
	"bytes"
	"fmt"
	"github.com/atotto/clipboard"
	"image"
)

func GetImageFromClipboard() ([]byte, string, error) {
	text, err := clipboard.ReadAll()
	if err != nil {
		return nil, "", fmt.Errorf("Error reading clipboard")
	}

	if text == "" {
		return nil, "", nil
	}

	binaryData := []byte(text)
	imageBytes, err := binaryToImage(binaryData)
	if err != nil {
		return nil, text, nil
	}
	return imageBytes, "", nil

}

func binaryToImage(data []byte) ([]byte, error) {
	reader := bytes.NewReader(data)
	img, _, err := image.Decode(reader)
	if err != nil {
		return nil, fmt.Errorf("Unable to covert bytes to image")
	}

	return ImageToBytes(img)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
