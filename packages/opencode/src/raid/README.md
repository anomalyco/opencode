# RAID - Retrieval-Augmented Intelligence Database

RAID is an advanced knowledge management system for OpenCode that combines traditional full-text search with AI-powered query orchestration.

## Features

- **Document Sharding**: Automatically breaks large documents into overlapping chunks for efficient processing
- **Full-Text Search**: SQLite FTS5 with BM25 relevance ranking
- **AI Orchestration**: Intelligent query routing with parallel shard processing
- **Answer Fusion**: Synthesizes responses from multiple knowledge sources
- **Dual Storage**: Separate project-specific and global knowledge bases

## Quick Start

### 1. Set Environment Variables

```bash
# Required: OpenAI API key (or compatible API)
export OPENAI_API_KEY="your-api-key"

# Optional: Custom API endpoint (for LM Studio, Ollama, etc.)
export RAID_BASE_URL="http://localhost:1234/v1"

# Optional: Model configuration
export RAID_SHARD_MODEL="gpt-4o-mini"    # Fast model for shards
export RAID_ORCH_MODEL="gpt-4o"          # Powerful model for orchestration
```

### 2. Ingest Documents

```bash
# Ingest project documentation
opencode tool raid-ingest \
  --filePath ./docs/api-reference.md \
  --source project \
  --tags "api,reference" \
  --generateSummary true

# Ingest to global knowledge base
opencode tool raid-ingest \
  --filePath ~/Documents/style-guide.md \
  --source global \
  --tags "guidelines,style"
```

### 3. Search Documents

```bash
# Full-text search
opencode tool raid-search \
  --query "authentication" \
  --maxResults 5 \
  --source both

# Search with filters
opencode tool raid-search \
  --query "api AND endpoints" \
  --contentType '["markdown"]' \
  --tags '["api"]'
```

### 4. AI-Powered Queries

```bash
# Ask natural language questions
opencode tool raid-query \
  --query "How do I configure authentication?" \
  --showProgress true

# Query specific documents
opencode tool raid-query \
  --query "Explain the rate limiting implementation" \
  --documentIds '["doc-id-123"]'
```

### 5. Manage Knowledge Base

```bash
# View statistics
opencode tool raid-kb --action stats

# List all documents
opencode tool raid-kb --action list --limit 20

# Get specific document
opencode tool raid-kb --action get --documentId "doc-123"

# Delete document
opencode tool raid-kb --action delete --documentId "doc-123"

# Clear all project documents
opencode tool raid-kb --action clear --source project
```

## Architecture

### Core Components

```
packages/opencode/src/raid/
├── raid-types.ts          # TypeScript type definitions
├── raid-config.ts         # Configuration management
├── raid-kb.ts            # Knowledge base (SQLite + FTS)
└── raid-orchestrator.ts  # AI orchestration engine
```

### Tools

```
packages/opencode/src/tool/
├── raid-ingest.ts/.txt   # Document ingestion
├── raid-search.ts/.txt   # Full-text search
├── raid-query.ts/.txt    # AI-powered querying
└── raid-kb.ts/.txt       # KB management
```

## Configuration

### Environment Variables

| Variable                    | Default                     | Description                                     |
| --------------------------- | --------------------------- | ----------------------------------------------- |
| `RAID_API_KEY`              | -                           | OpenAI API key (falls back to `OPENAI_API_KEY`) |
| `RAID_BASE_URL`             | `https://api.openai.com/v1` | API endpoint                                    |
| `RAID_SHARD_MODEL`          | `gpt-4o-mini`               | Model for shard queries (fast)                  |
| `RAID_ORCH_MODEL`           | `gpt-4o`                    | Model for orchestration (powerful)              |
| `RAID_NUM_SHARDS`           | `10`                        | Number of shards per document                   |
| `RAID_MAX_TOKENS_PER_SHARD` | `4000`                      | Maximum tokens per shard                        |
| `RAID_OVERLAP_TOKENS`       | `200`                       | Token overlap between shards                    |
| `RAID_MAX_CONCURRENT`       | `5`                         | Max parallel shard queries                      |
| `RAID_GLOBAL_KB_PATH`       | `~/.opencode/raid`          | Global KB storage                               |
| `RAID_AUTO_INDEX`           | `true`                      | Auto-index new files                            |

### Storage Locations

- **Project KB**: `.opencode/raid.db` in project root
- **Global KB**: `~/.opencode/raid/raid.db` in user home

## Use Cases

### 1. Documentation Search

Index your project documentation and query it naturally:

```bash
# Ingest docs
opencode tool raid-ingest \
  --filePath ./docs/architecture.md \
  --source project

# Ask questions
opencode tool raid-query \
  --query "What database does the system use?"
```

### 2. Code Understanding

Build a knowledge base from technical specifications:

```bash
# Ingest API specs
opencode tool raid-ingest \
  --filePath ./specs/api-v2.yaml \
  --source project \
  --tags "api,spec"

# Query implementation details
opencode tool raid-query \
  --query "How are webhooks authenticated?"
```

### 3. Onboarding Assistant

Create a global knowledge base for your organization:

```bash
# Ingest company guidelines
opencode tool raid-ingest \
  --filePath ~/company/coding-standards.md \
  --source global \
  --tags "standards,guidelines"

# New team members can query
opencode tool raid-query \
  --query "What are our TypeScript conventions?"
```

### 4. Research Repository

Index research papers and technical articles:

```bash
# Ingest research
for paper in ~/research/*.pdf; do
  opencode tool raid-ingest \
    --filePath "$paper" \
    --source global \
    --tags "research"
done

# Find relevant research
opencode tool raid-search \
  --query "machine learning optimization"
```

## Advanced Usage

### Custom API Endpoints

RAID works with any OpenAI-compatible API:

```bash
# LM Studio
export RAID_BASE_URL="http://localhost:1234/v1"
export RAID_SHARD_MODEL="local-model"

# Ollama with OpenAI compatibility
export RAID_BASE_URL="http://localhost:11434/v1"
export RAID_SHARD_MODEL="llama2"
```

### Sharding Strategy

Adjust sharding based on document size:

```bash
# Large documents (books, specs)
export RAID_NUM_SHARDS=20
export RAID_MAX_TOKENS_PER_SHARD=3000
export RAID_OVERLAP_TOKENS=300

# Small documents (blog posts)
export RAID_NUM_SHARDS=5
export RAID_MAX_TOKENS_PER_SHARD=5000
export RAID_OVERLAP_TOKENS=200
```

### FTS Query Syntax

Use SQLite FTS5 syntax for advanced searches:

```bash
# Exact phrase
opencode tool raid-search --query '"user authentication"'

# Boolean operators
opencode tool raid-search --query 'api AND (rest OR graphql)'

# Prefix matching
opencode tool raid-search --query 'auth*'

# Field-specific
opencode tool raid-search --query 'title:authentication'

# Exclude terms
opencode tool raid-search --query 'api -deprecated'
```

## Performance Tips

1. **Model Selection**:
   - Use `gpt-4o-mini` or `gpt-3.5-turbo` for shards (speed)
   - Use `gpt-4o` or `gpt-4` for orchestration (quality)

2. **Sharding**:
   - Optimal: 1KB-1MB documents
   - Too many shards = slower queries
   - Too few shards = worse accuracy

3. **Caching**:
   - Search results are fast (SQLite FTS)
   - AI queries cost API calls
   - Consider caching frequent queries

4. **Concurrency**:
   - Balance `RAID_MAX_CONCURRENT` with API rate limits
   - More concurrent = faster but more API load

## Troubleshooting

### No API Key Error

```
Error: API key is required (set RAID_API_KEY or OPENAI_API_KEY)
```

**Solution**: Set the API key environment variable:

```bash
export OPENAI_API_KEY="your-key"
```

### FTS Search Returns No Results

**Possible causes**:

- No documents ingested
- Query syntax error
- Wrong source filter

**Solution**:

```bash
# Check if documents exist
opencode tool raid-kb --action stats

# Try simpler query
opencode tool raid-search --query "keyword"
```

### AI Query Fails

**Possible causes**:

- API key invalid/expired
- Rate limit exceeded
- Model not available

**Solution**:

```bash
# Check API connection
curl $RAID_BASE_URL/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Try different model
export RAID_SHARD_MODEL="gpt-3.5-turbo"
```

### Slow Queries

**Possible causes**:

- Too many shards
- Slow AI model
- Low concurrency

**Solution**:

```bash
# Increase concurrency
export RAID_MAX_CONCURRENT=10

# Use faster model
export RAID_SHARD_MODEL="gpt-3.5-turbo"
```

## Examples

### Example 1: Project Documentation

```bash
# Ingest all markdown docs
find ./docs -name "*.md" -exec \
  opencode tool raid-ingest \
    --filePath {} \
    --source project \
    --tags "documentation" \;

# Search for specific topics
opencode tool raid-search \
  --query "deployment configuration"

# Ask questions
opencode tool raid-query \
  --query "How do I deploy to production?"
```

### Example 2: Code Analysis

```bash
# Ingest architecture decision records
opencode tool raid-ingest \
  --filePath ./adr/0001-use-postgresql.md \
  --source project \
  --tags "adr,database"

# Query decisions
opencode tool raid-query \
  --query "Why did we choose PostgreSQL?"
```

### Example 3: Personal Knowledge Base

```bash
# Create global knowledge base
opencode tool raid-ingest \
  --filePath ~/notes/coding-tips.md \
  --source global \
  --tags "tips,personal"

# Search across all projects
opencode tool raid-search \
  --query "performance optimization" \
  --source global
```

## Integration with OpenCode

RAID tools are available in OpenCode sessions:

```
User: "Can you search our documentation for authentication info?"
Agent: [Uses raid-search tool automatically]

User: "Ingest this API spec into the knowledge base"
Agent: [Uses raid-ingest tool to add document]

User: "What does our architecture doc say about caching?"
Agent: [Uses raid-query tool for AI-powered answer]
```

## Limitations

- Single-user, file-based storage (SQLite)
- No distributed processing
- Requires OpenAI-compatible API for AI features
- FTS limited to text-based search (no semantic embeddings)
- No real-time document sync

## Future Enhancements

Potential improvements:

- Vector embeddings for semantic search
- Multi-modal support (images, PDFs)
- Distributed storage backends
- Real-time document synchronization
- Collaborative knowledge bases
- Document versioning
- Access control and permissions

## Related Documentation

- [RAID Types](./raid-types.ts) - TypeScript type definitions
- [RAID Config](./raid-config.ts) - Configuration management
- [RAID KB](./raid-kb.ts) - Knowledge base implementation
- [RAID Orchestrator](./raid-orchestrator.ts) - AI orchestration

## Support

For issues, questions, or contributions:

- GitHub Issues: https://github.com/sst/opencode/issues
- Documentation: https://opencode.ai/docs
