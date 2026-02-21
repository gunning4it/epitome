---
name: epitome-memory
description: Use when the user has Epitome connected, mentions personal memory, personal data, profile, preferences, knowledge graph, or tracked habits.
---

# Epitome Memory

Epitome gives you shared, persistent memory of the user across conversations and AI agents. You have 3 tools — this skill teaches you when and how to use each one.

## Conversation Startup

**Always call `recall` at the start of every conversation.** This loads the user's profile, top entities, table inventory, collections, and retrieval hints within a ~2000 token budget. Pass an optional `topic` parameter if the conversation has a clear subject.

```
recall({})
recall({ topic: "meal planning" })
```

Use the returned context to personalize your responses from the very first message. Reference what you know — don't make the user repeat themselves.

## Decision Tree — Which Tool to Use

| User intent | Tool | Example |
|---|---|---|
| Asks about their data/profile/preferences | `recall` | `recall({})` or `recall({ topic: "food" })` |
| Shares personal info (allergies, job, family) | `memorize` | `memorize({ text: "I'm allergic to shellfish", category: "profile", data: { allergies: ["shellfish"] } })` |
| Logs trackable data (meals, workouts, expenses) | `memorize` | `memorize({ text: "Had a burrito for lunch", category: "meals", data: { food: "burrito", calories: 650 } })` |
| Shares an experience, reflection, note | `memorize` | `memorize({ text: "That dinner was magical", storage: "memory", collection: "journal" })` |
| Asks "what do I track?" or "what tables do I have?" | `recall` | `recall({})` — context response includes table inventory |
| Asks about tracked data (counts, history, trends) | `recall` | `recall({ mode: "table", table: { table: "meals", sql: "SELECT ..." } })` |
| Asks "remember when I..." or about past experiences | `recall` | `recall({ topic: "beach dinner" })` or `recall({ mode: "memory", memory: { collection: "journal", query: "beach dinner" } })` |
| Asks about relationships, patterns, connections | `recall` | `recall({ mode: "graph", graph: { queryType: "pattern", pattern: "..." } })` |
| Says "that's wrong" or corrects stored information | `review` | `review({ action: "list" })` then `review({ action: "resolve", metaId: 123, resolution: "confirm" })` |

## Tool Usage Guide

### recall

Retrieve information from all of the user's data sources.

**Context load — no arguments:**
```
recall({})
```
Returns profile, top entities, table inventory, collections, and retrieval hints. Call this at the start of every conversation.

**Context with topic:**
```
recall({ topic: "meal planning" })
```
Returns profile plus relevance-ranked results from all sources matching the topic.

**Federated search:**
```
recall({ topic: "food preferences" })
```
Searches across profile, tables, memories, and graph with fusion ranking.

**Memory mode — collection-specific vector search:**
```
recall({
  mode: "memory",
  memory: { collection: "journal", query: "coffee", minSimilarity: 0.7, limit: 5 }
})
```
- Default similarity threshold is 0.7 — lower it to 0.5 for broader results if initial search returns nothing
- Search one collection at a time; if unsure which collection, try `journal` first, then `notes`
- Results are ranked by cosine similarity score

**Graph mode — relationships and patterns:**
```
// Natural language
recall({ mode: "graph", graph: { queryType: "pattern", pattern: "what food do I like?" } })

// Traverse from a specific entity
recall({ mode: "graph", graph: { queryType: "traverse", entityId: 42, relation: "knows", maxHops: 2 } })
```
- Use pattern queries when the user asks about categories ("what restaurants have I been to?")
- Use traverse queries when exploring connections from a known entity
- Max 3 hops for traversal

**Table mode — structured data queries:**

Structured filters for simple lookups:
```
recall({
  mode: "table",
  table: { table: "meals", filters: { meal_type: "dinner" }, limit: 10 }
})
```

SQL mode for complex analysis:
```
recall({
  mode: "table",
  table: { table: "meals", sql: "SELECT food, COUNT(*) as times FROM meals GROUP BY food ORDER BY times DESC LIMIT 5" }
})
```
- SQL queries are read-only and sandboxed
- Default limit is 50, max is 1000
- Use `offset` for pagination through large result sets

**Budget control:**
- `budget: "small"` — minimal context, fast
- `budget: "medium"` — default retrieval depth
- `budget: "deep"` — thorough search across all sources

### memorize

Save or delete a fact, experience, or event.

**Profile updates:**
```
memorize({
  text: "I'm vegetarian",
  category: "profile",
  data: { dietary: ["vegetarian"] }
})
```
- Deep-merges with existing profile (won't overwrite unrelated fields)
- Use for: name, timezone, job, family members, allergies, dietary preferences, goals, languages

**Structured records:**

**Keep column values atomic.** Put the item name in the primary column, and metadata in separate columns:

```
// Meals
memorize({
  text: "Had a breakfast burrito at Crest Cafe",
  category: "meals",
  data: {
    food: "breakfast burrito",        // dish name only
    restaurant: "Crest Cafe",         // venue separate
    ingredients: "eggs, bacon, cheese", // comma-separated list
    meal_type: "breakfast",
    calories: 650
  }
})

// Workouts
memorize({
  text: "Did deadlifts at Gold's Gym",
  category: "workouts",
  data: {
    exercise: "deadlifts",
    duration: 45,
    intensity: "high",
    calories_burned: 400,
    location: "Gold's Gym"
  }
})

// Expenses
memorize({
  text: "Bought groceries at Trader Joe's",
  category: "expenses",
  data: {
    item: "groceries",
    amount: 42.50,
    category: "groceries",
    vendor: "Trader Joe's"
  }
})

// Medications
memorize({
  text: "Took ibuprofen for headache",
  category: "medications",
  data: {
    medication_name: "ibuprofen",
    dose: "400mg",
    frequency: "as needed",
    purpose: "headache"
  }
})
```

- **Do NOT concatenate descriptions into a single field** — "breakfast burrito at Crest Cafe with eggs and bacon" in one column is wrong
- New columns are auto-created, so don't hesitate to add relevant fields
- Entity extraction runs automatically after insertion (non-blocking)
- If the table doesn't exist yet, the first record auto-creates it

**Vector-only saves (memories):**
```
memorize({
  text: "Had an amazing sunset dinner at Nobu overlooking the ocean. The black cod was incredible.",
  storage: "memory",
  collection: "journal",
  metadata: { topic: "dining", mood: "happy", location: "Malibu" }
})
```

**Collection naming conventions:**
- `journal` — daily entries, experiences, reflections
- `notes` — ideas, thoughts, reference material
- `conversations` — important conversation summaries
- `reviews` — reviews of restaurants, books, movies, products
- `goals` — goals, plans, aspirations

- Entity extraction runs automatically after save (non-blocking)
- Always choose the most specific collection that fits

**Routing order:**
1. `action: "delete"` — semantic search + soft-delete matching vectors
2. `storage: "memory"` — vector-only save via saveMemory
3. `category: "profile"` — deep-merge profile update
4. Default — addRecord (dual-writes table row + auto-vectorized memory)

### review

Check for or resolve memory contradictions.

**List contradictions:**
```
review({ action: "list" })
```
Returns up to 5 unresolved contradictions.

**Resolve a contradiction:**
```
review({ action: "resolve", metaId: 123, resolution: "confirm" })
```

- `confirm` — the newer information is correct, supersede the old
- `reject` — the older information was correct, discard the new
- `keep_both` — both are valid in different contexts (e.g., "likes pizza" and "avoiding carbs this month")

When the user says "that's wrong":
1. Call `review({ action: "list" })` to find relevant contradictions
2. Ask the user which version is correct if ambiguous
3. Resolve with the appropriate action

## Critical Behaviors

### Save Automatically
When the user shares personal information, log data, or describe experiences — save it immediately with `memorize`. **Never ask "should I save this?"** The user expects Epitome to remember automatically.

### Avoid Duplication
Before saving, consider whether this information already exists:
- Profile data: use `memorize` with `category: "profile"` to merge (not create duplicates)
- Records: check if the same event was already logged today
- Memories: don't save the same experience twice in the same conversation

### Use Loaded Context
After calling `recall`, actively reference the returned data in your responses. If you know the user is vegetarian, mention it when discussing meal options. If you know their timezone, use it for scheduling.

### Handle Consent Errors
If a tool returns a `CONSENT_DENIED` error, the user hasn't granted this agent permission for that resource. Tell the user:
> "I don't have permission to access [resource] yet. You can grant access in your Epitome dashboard under Settings > Agent Permissions."

Don't retry the same tool — it will fail again until permissions are updated.

## Profile vs Table vs Memory

Understanding when to use each storage type:

| Signal | Storage | Tool | Example |
|---|---|---|---|
| Stable personal fact | Profile | `memorize` (category: "profile") | "I'm allergic to shellfish" |
| Discrete data point | Table record | `memorize` (default/category) | "I had lobster for dinner" |
| Experience or reflection | Memory vector | `memorize` (storage: "memory") | "That dinner was magical" |

**Rules of thumb:**
- If it defines **who the user is** → profile
- If it's a **countable event** with structured fields → table record
- If it's a **narrative or feeling** the user might search for later → memory
- When in doubt, a single user statement can trigger multiple calls (e.g., "I had an amazing lobster dinner at Nobu" → `memorize` with category for the meal record + `memorize` with `storage: "memory"` for the experience)
