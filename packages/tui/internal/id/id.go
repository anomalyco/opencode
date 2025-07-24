package id

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"
)

const (
	PrefixSession = "ses"
	PrefixMessage = "msg"
	PrefixUser    = "usr"
	PrefixPart    = "prt"
)

const length = 26

var (
	lastTimestamp int64
	counter       int64
	mu            sync.Mutex
)

type Prefix string

const (
	Session Prefix = PrefixSession
	Message Prefix = PrefixMessage
	User    Prefix = PrefixUser
	Part    Prefix = PrefixPart
)

func ValidatePrefix(id string, prefix Prefix) bool {
	return strings.HasPrefix(id, string(prefix))
}

func Ascending(prefix Prefix, given ...string) string {
	return generateID(prefix, false, given...)
}

func Descending(prefix Prefix, given ...string) string {
	return generateID(prefix, true, given...)
}

func generateID(prefix Prefix, descending bool, given ...string) string {
	if len(given) > 0 && given[0] != "" {
		if !strings.HasPrefix(given[0], string(prefix)) {
			panic(fmt.Sprintf("ID %s does not start with %s", given[0], string(prefix)))
		}
		return given[0]
	}
	
	return generateNewID(prefix, descending)
}

func randomBase62(length int) string {
	const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	result := make([]byte, length)
	bytes := make([]byte, length)
	rand.Read(bytes)
	
	for i := 0; i < length; i++ {
		result[i] = chars[bytes[i]%62]
	}
	
	return string(result)
}

func generateNewID(prefix Prefix, descending bool) string {
	mu.Lock()
	defer mu.Unlock()
	
	currentTimestamp := time.Now().UnixMilli()
	
	if currentTimestamp != lastTimestamp {
		lastTimestamp = currentTimestamp
		counter = 0
	}
	counter++
	
	now := uint64(currentTimestamp)*0x1000 + uint64(counter)
	
	if descending {
		now = ^now
	}
	
	timeBytes := make([]byte, 6)
	for i := 0; i < 6; i++ {
		timeBytes[i] = byte((now >> (40 - 8*i)) & 0xff)
	}
	
	return string(prefix) + "_" + hex.EncodeToString(timeBytes) + randomBase62(length-12)
}