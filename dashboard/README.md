# Epitome Dashboard

React 19 SPA for the Epitome personal AI database.

## Tech Stack

- React 19 - UI framework
- Vite - Build tool and dev server
- Tailwind CSS 4 - Utility-first styling
- TanStack Query - Server state management
- D3.js 7.9 - Knowledge graph visualization
- React Router 6 - Client-side routing

## Development

```bash
npm install
npm run dev    # Start dev server at http://localhost:5173
npm run build  # Build for production
```

## Pages Implemented (All 9 Complete!)

1. **Onboarding** (`/onboarding`) - Chat-style flow with Google OAuth import
2. **Profile Editor** (`/profile`) - Version history, confidence badges, deep-merge updates
3. **Tables Browser** (`/tables`) - CRUD operations on custom tables
4. **Memory Search** (`/memories`) - Semantic + full-text search with similarity filtering
5. **Knowledge Graph** (`/graph`) - D3.js interactive force-directed visualization
6. **Memory Review** (`/review`) - Contradiction resolution interface
7. **Activity Log** (`/activity`) - Filterable audit log with per-agent breakdown and CSV export
8. **Connected Agents** (`/agents`) - Permission management and usage statistics
9. **Settings** (`/settings`) - Account info, API keys, data export, vault deletion

## API Configuration

Default: `http://localhost:3000/v1`

Edit `.env` to change:
```env
VITE_API_URL=http://localhost:3000/v1
```
