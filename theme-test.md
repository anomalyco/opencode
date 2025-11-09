# TextMate Grammar Token Examples

This file contains examples of every major TextMate token style for theme testing.

## Comments

<!-- HTML comment -->

// Single line comment
/_ Multi-line comment _/

# Shell comment

/_ JSDoc comment with @param and @return _/

## Strings

"Double quoted string"
'Single quoted string'
`Backtick string`
"String with \"escaped\" quotes"
'String with \'escaped\' quotes'
`String with \`escaped\` backticks`

## Template Literals

`Simple template literal`
`Template with ${variable} interpolation`
`Template with ${function.call()} expression`
Multi-line template with ${nested.interpolation}

## Numbers

42
-17
3.14159
-0.001
1e10
-2.5e-8
0xFF
0o755
0b1010

## Keywords

if else elif for while do switch case default
function class extends implements import export
return break continue throw try catch finally
var let const static async await yield
new this super null undefined true false

## Storage Types

int float double string boolean char void
static final abstract private public protected
readonly volatile transient synchronized

## Constants

MAX_VALUE
DEFAULT_TIMEOUT
API_ENDPOINT
PI
E

## Variables

variableName
\_privateVariable
$specialVariable
camelCase
snake_case
PascalCase
kebab-case

## Functions

functionName()
method.call()
object.property()
array[index]
arrowFunction => expression

## Operators

- - - / % ++ --
      == === != !== > < >= <=
      && || ! & | ^ ~ << >> >>>
      = += -= \*= /= %= &= |= ^= <<= >>= >>>=

## Punctuation

, ; : . ... ( ) [ ] { } < > / \\

# @ $ % ^ & \* - \_ + = | ~ ` ?

## Entities

ClassName
InterfaceName
EnumName
TypeName
MethodName
PropertyName

## Tags

<div>
<span>
<p>
<a href="link">
<img src="image.jpg" alt="description" />

## Attributes

class="container"
id="main"
data-value="123"
disabled
required
readonly

## CSS Selectors & Properties

.container
#header
.button:hover
input[type="text"]
::before
::after

color: #ffffff;
background: linear-gradient(45deg, #ff0000, #00ff00);
font-size: 16px;
margin: 0 auto;
padding: 10px 20px;

## Regular Expressions

/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
/\d{3}-\d{3}-\d{4}/g
/(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})/

## URLs & Paths

https://example.com/path/to/resource
file:///Users/username/project
./relative/path
../parent/directory
/home/user/documents

## JSON

{
"name": "example",
"version": "1.0.0",
"dependencies": {
"react": "^18.0.0",
"typescript": "^4.9.0"
},
"scripts": {
"start": "node index.js",
"test": "jest"
}
}

## XML/HTML

<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Document</title>
</head>
<body>
    <div class="content">
        <h1>Title</h1>
        <p>Paragraph text</p>
    </div>
</body>
</html>

## SQL

SELECT u.id, u.name, u.email, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.active = true
AND o.created_at >= '2023-01-01'
GROUP BY u.id, u.name, u.email
HAVING COUNT(o.id) > 5
ORDER BY order_count DESC
LIMIT 10;

## GraphQL

query GetUserProfile($userId: ID!, $includePosts: Boolean!) {
user(id: $userId) {
id
name
email
avatar
createdAt
posts @include(if: $includePosts) {
id
title
content
publishedAt
comments(first: 10) {
edges {
node {
id
author
content
createdAt
}
}
}
}
}
}

## Shell/Bash

#!/bin/bash

# Variables

PROJECT*DIR="/home/user/projects"
BACKUP_DIR="$PROJECT_DIR/backups"
TIMESTAMP=$(date +"%Y%m%d*%H%M%S")

# Functions

create*backup() {
local source_dir=$1
    local backup_file="$BACKUP_DIR/backup*$TIMESTAMP.tar.gz"

    echo "Creating backup of $source_dir..."
    tar -czf "$backup_file" "$source_dir"
    echo "Backup created: $backup_file"

}

# Conditional logic

if [ -d "$PROJECT_DIR" ]; then
create_backup "$PROJECT_DIR"
else
echo "Project directory not found: $PROJECT_DIR"
exit 1
fi

## Python

import os
import sys
from typing import List, Dict, Optional
import requests
from dataclasses import dataclass

@dataclass
class User:
id: int
name: str
email: Optional[str] = None
active: bool = True

    def __post_init__(self):
        if not self.name.strip():
            raise ValueError("Name cannot be empty")

class UserService:
def **init**(self, api_url: str):
self.api_url = api_url
self.session = requests.Session()

    async def get_user(self, user_id: int) -> Optional[User]:
        """Fetch user data from API."""
        try:
            response = await self.session.get(f"{self.api_url}/users/{user_id}")
            response.raise_for_status()
            data = response.json()
            return User(**data)
        except requests.RequestException as e:
            print(f"Error fetching user {user_id}: {e}")
            return None

## Rust

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
pub id: u64,
pub name: String,
pub email: Option<String>, #[serde(default)]
pub active: bool,
pub created_at: chrono::DateTime<chrono::Utc>,
}

impl User {
pub fn new(id: u64, name: String, email: Option<String>) -> Self {
Self {
id,
name,
email,
active: true,
created_at: chrono::Utc::now(),
}
}

    pub fn display_name(&self) -> String {
        match &self.email {
            Some(email) => format!("{} <{}>", self.name, email),
            None => self.name.clone(),
        }
    }

}

pub struct UserService {
api_url: String,
client: reqwest::Client,
}

impl UserService {
pub fn new(api_url: String) -> Self {
Self {
api_url,
client: reqwest::Client::new(),
}
}

    pub async fn get_user(&self, user_id: u64) -> Result<User, Box<dyn std::error::Error>> {
        let url = format!("{}/users/{}", self.api_url, user_id);
        let response = self.client.get(&url).send().await?;
        let user: User = response.json().await?;
        Ok(user)
    }

}

## Go

package main

import (
"context"
"encoding/json"
"fmt"
"log"
"net/http"
"time"
"github.com/gorilla/mux"
)

type User struct {
ID int64 `json:"id"`
Name string `json:"name"`
Email \*string `json:"email,omitempty"`
Active bool `json:"active"`
CreatedAt time.Time `json:"created_at"`
}

type UserService struct {
re UserRepository
}

func NewUserService(repo UserRepository) \*UserService {
return &UserService{repo: repo}
}

func (s *UserService) GetUser(ctx context.Context, id int64) (*User, error) {
user, err := s.repo.FindByID(ctx, id)
if err != nil {
return nil, fmt.Errorf("failed to get user %d: %w", id, err)
}
return user, nil
}

func (s *UserService) CreateUser(ctx context.Context, req *CreateUserRequest) (\*User, error) {
user := &User{
Name: req.Name,
Email: req.Email,
Active: true,
CreatedAt: time.Now(),
}
if err := s.repo.Create(ctx, user); err != nil {
return nil, fmt.Errorf("failed to create user: %w", err)
}
return user, nil
}

## YAML

apiVersion: apps/v1
kind: Deployment
metadata:
name: web-app
namespace: production
labels:
app: web-app
version: v1.2.3
spec:
replicas: 3
selector:
matchLabels:
app: web-app
template:
metadata:
labels:
app: web-app
tier: frontend
spec:
containers: - name: web-app
image: nginx:1.21-alpine
ports: - containerPort: 80
protocol: TCP
env: - name: NODE_ENV
value: "production" - name: API_URL
valueFrom:
secretKeyRef:
name: app-secrets
key: api-url
resources:
requests:
memory: "64Mi"
cpu: "250m"
limits:
memory: "128Mi"
cpu: "500m"
livenessProbe:
httpGet:
path: /health
port: 80
initialDelaySeconds: 30
periodSeconds: 10
readinessProbe:
httpGet:
path: /ready
port: 80
initialDelaySeconds: 5
periodSeconds: 5

## TOML

[project]
name = "example-app"
version = "1.0.0"
description = "An example application"
authors = ["John Doe <john@example.com>"]
license = "MIT"
readme = "README.md"
homepage = "https://example.com"
repository = "https://github.com/johndoe/example-app"
keywords = ["web", "api", "rust"]
categories = ["web-programming"]
edition = "2021"

[dependencies]
tokio = { version = "1.0", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
reqwest = { version = "0.11", features = ["json"] }
chrono = { version = "0.4", features = ["serde"] }
log = "0.4"
env_logger = "0.10"

[dev-dependencies]
tokio-test = "0.4"
mockito = "1.0"

[[bin]]
name = "server"
path = "src/main.rs"

[[bin]]
name = "client"
path = "src/client.rs"

## Dockerfile

FROM node:18-alpine AS base

# Install dependencies only when needed

FROM base AS deps

# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.

RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager

COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml\* ./
RUN \
 if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
 elif [ -f package-lock.json ]; then npm ci; \
 elif [ -f pnpm-lock.yaml ]; then yarn global add pnpm && pnpm i --frozen-lockfile; \
 else echo "Lockfile not found." && exit 1; \
 fi

# Rebuild the source code only when needed

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.

# Learn more here: https://nextjs.org/telemetry

# Uncomment the following line in case you want to disable telemetry during the build.

# ENV NEXT_TELEMETRY_DISABLED 1

RUN \
 if [ -f yarn.lock ]; then yarn run build; \
 elif [ -f package-lock.json ]; then npm run build; \
 elif [ -f pnpm-lock.yaml ]; then pnpm run build; \
 else echo "Lockfile not found." && exit 1; \
 fi

# Production image, copy all the files and run next

FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

# Uncomment the following line in case you want to disable telemetry during runtime.

# ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache

RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size

# https://nextjs.org/docs/advanced-features/output-file-tracing

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000

# set hostname to localhost

ENV HOSTNAME "0.0.0.0"

# server.js is created by next build from the standalone output

# https://nextjs.org/docs/pages/api-reference/next-config-js/output

CMD ["node", "server.js"]

## Makefile

.PHONY: help build test clean install dev lint format

# Default target

.DEFAULT_GOAL := help

# Variables

APP_NAME := myapp
VERSION := $(shell git describe --tags --always --dirty)
BUILD_DIR := ./build
DIST_DIR := ./dist
GO_FILES := $(shell find . -name '\*.go' -type f)

help: ## Show this help message
@echo "Available targets:"
@grep -E '^[a-zA-Z_-]+:._?## ._$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.\*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
go mod download
npm install

build: ## Build the application
@echo "Building $(APP_NAME) version $(VERSION)..."
	mkdir -p $(BUILD_DIR)
	go build -ldflags "-X main.version=$(VERSION)" -o $(BUILD_DIR)/$(APP_NAME) ./cmd/main.go

test: ## Run tests
go test -v ./...
npm test

lint: ## Run linters
golangci-lint run
npx eslint .

format: ## Format code
go fmt ./...
npx prettier --write .

dev: ## Run in development mode
go run ./cmd/main.go --dev

clean: ## Clean build artifacts
rm -rf $(BUILD_DIR)
rm -rf $(DIST_DIR)
go clean -cache

docker-build: ## Build Docker image
docker build -t $(APP_NAME):$(VERSION) .
docker tag $(APP_NAME):$(VERSION) $(APP_NAME):latest

docker-run: ## Run Docker container
docker run -p 8080:8080 $(APP_NAME):latest

release: ## Create a new release
@echo "Creating release $(VERSION)"
git tag -a $(VERSION) -m "Release $(VERSION)"
git push origin $(VERSION)
goreleaser release --rm-dist

## Git Diff

diff --git a/src/components/UserProfile.tsx b/src/components/UserProfile.tsx
index 1234567..abcdefg 100644
--- a/src/components/UserProfile.tsx
+++ b/src/components/UserProfile.tsx
@@ -10,7 +10,7 @@ interface User {
id: number
name: string
email?: string

- createdAt: Date

* readonly createdAt: Date
  active: boolean
  }

@@ -25,8 +25,12 @@ const UserProfile: FC<{ user: User }> = ({ user }) => {
const [isEditing, setIsEditing] = useState(false)
const [formData, setFormData] = useState(user)

- const handleSubmit = async (e: React.FormEvent) => {
- e.preventDefault()
- // Handle form submission
- }
- return (

* <div className="user-card">

- <div className={`user-card ${user.active ? 'active' : 'inactive'}`}>
    <h3>{user.name}</h3>
    <p>{user.email}</p>
  </div>
