# Epitome Plugin for Claude Code

Personal AI memory — gives every AI agent shared, persistent memory of you.

## Setup

### Option 1: Install from Plugin Marketplace (Recommended)

```bash
claude plugin install epitome
```

This auto-configures the MCP connection to `epitome.fyi/mcp`. On first use, you'll authenticate via browser (OAuth 2.0).

### Option 2: Install from Local Path

```bash
claude plugin install /path/to/epitome/plugin
```

### Option 3: API Key (Manual)

If you prefer API key auth over OAuth:

1. Get your API key from [epitome.fyi/dashboard/settings](https://epitome.fyi/dashboard/settings)
2. Add the MCP server manually:

```bash
claude mcp add epitome \
  --transport http \
  --url https://epitome.fyi/mcp \
  --header "Authorization: Bearer epi_your_key_here"
```

### Self-Hosted

If you're running Epitome locally or on your own server:

```bash
claude mcp add epitome \
  --transport http \
  --url http://localhost:3000/mcp \
  --header "Authorization: Bearer epi_your_key_here"
```

## Available Tools

| Tool | Description |
|------|-------------|
| `get_user_context` | Load profile, entities, tables, and recent memories |
| `update_profile` | Update personal info (deep-merges with existing data) |
| `list_tables` | List all data tables you track |
| `query_table` | Query records with filters or SQL |
| `add_record` | Log meals, workouts, expenses, or any trackable data |
| `search_memory` | Semantic search across saved memories |
| `save_memory` | Save experiences, notes, and reflections |
| `query_graph` | Query your knowledge graph for relationships and patterns |
| `review_memories` | List and resolve memory contradictions |

## Example Queries

Once the plugin is installed, just talk naturally:

- "What did I eat last week?"
- "Log that I had a chicken salad for lunch"
- "I'm allergic to shellfish"
- "What restaurants have I been to?"
- "Remember when I went to that concert?"
- "What patterns do you see in my workouts?"
- "That's not right — I'm not vegetarian anymore"

The plugin's skill teaches Claude when to use each tool automatically.

## How It Works

The plugin includes a **skill** (`skills/epitome-memory/SKILL.md`) that teaches Claude:

1. To load your context at the start of every conversation
2. Which tool to use based on what you say
3. How to format data correctly (atomic columns, collection conventions)
4. To save information automatically without asking permission
5. How to handle contradictions and corrections

## Links

- [Epitome Dashboard](https://epitome.fyi)
- [Documentation](https://epitome.fyi/docs)
- [GitHub](https://github.com/gunning4it/epitome)
- [MCP Registry](https://github.com/modelcontextprotocol/servers)
