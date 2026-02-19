<p align="center">
  <img src="dashboard/public/epitome.png" alt="Epitome" width="80" />
</p>

<h1 align="center">Epitome</h1>

<p align="center">
  <strong>One memory layer, every AI agent.</strong>
</p>

<p align="center">
  The portable identity layer that gives every AI agent a shared, persistent memory of you.<br />
  Open source. Self-hostable. Yours.
</p>

<p align="center">
  <a href="https://github.com/gunning4it/epitome/blob/main/LICENSE"><img src="https://img.shields.io/github/license/gunning4it/epitome" alt="MIT License" /></a>
  <a href="https://github.com/gunning4it/epitome/stargazers"><img src="https://img.shields.io/github/stars/gunning4it/epitome" alt="GitHub Stars" /></a>
  <a href="https://github.com/gunning4it/epitome/actions"><img src="https://img.shields.io/github/actions/workflow/status/gunning4it/epitome/ci.yml?branch=main&label=tests" alt="Tests" /></a>
</p>

<p align="center">
  <a href="https://epitome.fyi">Website</a> ·
  <a href="#quickstart">Quickstart</a> ·
  <a href="#connect-an-ai-agent">Connect an Agent</a> ·
  <a href="https://epitome.fyi/docs">Docs</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

## The Problem

Every AI conversation starts from zero. You repeat yourself to every agent — your name, your preferences, your allergies, your tech stack. Chat history is siloed per app. There's no portable memory layer.

**Epitome fixes this.** One database that every AI agent shares, so they all remember you.

---

## Quickstart

### Hosted (fastest)

1. Sign up at [epitome.fyi](https://epitome.fyi)
2. Go to **Settings → API Keys** and copy your MCP URL
3. [Connect an AI agent](#connect-an-ai-agent) — done

### Self-Hosted

```bash
git clone https://github.com/gunning4it/epitome.git
cd epitome
cp .env.example .env    # edit with your credentials
docker compose up -d
```

Open [localhost:5173](http://localhost:5173) and sign in with Google or GitHub OAuth.

---

## Connect an AI Agent

Get your API key from **Settings → API Keys** in the dashboard (hosted or self-hosted).

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "epitome": {
      "url": "https://epitome.fyi/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add --transport http --header "Authorization: Bearer YOUR_API_KEY" epitome https://epitome.fyi/mcp
```

### Self-Hosted

For self-hosted, replace `https://epitome.fyi` with `http://localhost:3000`.

Epitome exposes **9 MCP tools** — profile read/write, memory search, table CRUD, knowledge graph queries, and more. See the [full tool reference](https://epitome.fyi/docs/mcp-tools).

---

## Who This Is For

- **AI developers** building agents that need persistent user memory
- **Power users** who want every AI to remember them across platforms
- **Self-hosters** who want full data ownership — no cloud required

### Use Cases

- Your meal-tracking agent remembers your allergies
- Your coding assistant knows your stack, your patterns, your team
- Your calendar agent knows your family, your priorities, your routines
- Every new AI tool you try already knows you on day one

---

## Why Epitome?

|  | Chat History | Vector DB | Note Apps | **Epitome** |
|---|:---:|:---:|:---:|:---:|
| Portable identity | | | | **✓** |
| Multi-agent shared memory | | | | **✓** |
| Knowledge graph | | | | **✓** |
| Consent & audit per agent | | | | **✓** |
| Per-user schema isolation | | | | **✓** |
| Structured + semantic data | | partial | | **✓** |
| Self-hostable | | ✓ | | **✓** |

---

## The Five Layers

| # | Layer | Description |
|---|-------|-------------|
| 01 | **Personal Database** | Structured tables, vector semantic memory, and key-value storage. Your data lives in PostgreSQL — queryable, exportable, yours. |
| 02 | **Portable Identity** | A structured profile any AI agent reads instantly. Name, preferences, relationships — zero cold start, every conversation. |
| 03 | **Memory Quality** | Confidence scoring, source attribution, and lifecycle management. Memories earn trust through reinforcement, not blind faith. |
| 04 | **Knowledge Graph** | Entities with typed, weighted edges. People, places, concepts — connected in a graph that grows with every interaction. |
| 05 | **Consent & Audit** | Per-table permissions and an append-only activity log. You control exactly what each agent can see and do. |

---

## Architecture

```
AI Agent ──→ MCP (Streamable HTTP) ──→ Hono API ──→ PostgreSQL
                                         │
                                    per-user schema
                                      isolation
```

Each user gets their own PostgreSQL schema (`user_{id}`) — not row-level security, full schema-level isolation. Cross-schema access is impossible at the SQL level.

See [EPITOME_TECH_SPEC.md](EPITOME_TECH_SPEC.md) for the full architecture.

---

## Security & Privacy

- **You own your data** — self-host or use the hosted service
- **Per-user PostgreSQL schema isolation** — not row-level security, full schema separation
- **Per-agent consent rules** — you control what each agent can read and write
- **Append-only audit log** — every access is recorded
- **GDPR-ready** — export or delete all your data at any time

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 22 LTS |
| API | Hono |
| Database | PostgreSQL 17 + pgvector |
| MCP | @modelcontextprotocol/sdk |
| Frontend | React 19 + Tailwind CSS 4 + shadcn/ui |
| Validation | Zod |
| Testing | Vitest |

---

## Documentation

- [Quick Start](https://epitome.fyi/docs/quickstart) — Get running in 60 seconds
- [API Reference](https://epitome.fyi/docs/api) — REST endpoint documentation
- [MCP Tools](https://epitome.fyi/docs/mcp-tools) — All 9 MCP tools explained
- [Architecture](EPITOME_TECH_SPEC.md) — Full technical specification
- [Data Model](EPITOME_DATA_MODEL.md) — Every table, column, and constraint
- [Self-Hosting Guide](https://epitome.fyi/docs/self-hosting) — Docker Compose deployment
- [Security](https://epitome.fyi/docs/security) — Isolation, consent, and audit

---

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
git clone https://github.com/gunning4it/epitome.git
cd epitome && cp .env.example .env
docker compose up -d
```

Then open a PR — we're happy to help with your first contribution.

---

## License

[MIT](LICENSE)
