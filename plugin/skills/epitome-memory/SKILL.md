---
name: epitome-memory
description: Use when the user has Epitome connected, mentions personal memory, personal data, profile, preferences, knowledge graph, or tracked habits.
---

# Epitome Memory

Epitome gives you shared, persistent memory of the user across conversations and AI agents. You have 9 tools — this skill teaches you when and how to use each one.

## Conversation Startup

**Always call `get_user_context` at the start of every conversation.** This loads the user's profile, top entities, table inventory, and recent memories within a ~2000 token budget. Pass an optional `topic` parameter if the conversation has a clear subject.

```
get_user_context({ topic: "meal planning" })
```

Use the returned context to personalize your responses from the very first message. Reference what you know — don't make the user repeat themselves.

## Decision Tree — Which Tool to Use

| User intent | Tool | Example |
|---|---|---|
| Shares personal info (allergies, job, family, preferences) | `update_profile` | "I'm allergic to shellfish" |
| Logs trackable data (meals, workouts, expenses, meds) | `add_record` | "I had a breakfast burrito at Crest Cafe" |
| Shares an experience, reflection, note, or idea | `save_memory` | "That dinner at the beach was magical" |
| Asks "what do I track?" or "what data do you have?" | `list_tables` | "What tables do I have?" |
| Asks about tracked data (counts, history, trends) | `query_table` | "What did I eat last week?" |
| Asks "remember when I..." or about past conversations | `search_memory` | "What did I say about that book?" |
| Asks about relationships, patterns, or connections | `query_graph` | "What food do I like?" |
| Says "that's wrong" or corrects stored information | `review_memories` | "I'm not allergic to peanuts anymore" |

## Tool Usage Guide

### get_user_context

Call at conversation start. Returns profile, entities, tables, and memories.

- Pass `topic` to get relevance-ranked entities for that subject
- If the response is empty, the user is new — welcome them and explain what Epitome can track

### update_profile

For stable personal facts that define who the user is.

```
update_profile({
  data: {
    preferences: { dietary: ["vegetarian", "no shellfish"] },
    health: { allergies: ["shellfish"] }
  },
  reason: "user mentioned dietary restrictions"
})
```

- Deep-merges with existing profile (won't overwrite unrelated fields)
- Use for: name, timezone, job, family members, allergies, dietary preferences, goals, languages
- Always include a `reason` so the user can audit changes later

### add_record

For discrete, trackable data points. Tables and columns are auto-created.

**Keep column values atomic.** Put the item name in the primary column, and metadata in separate columns:

```
// Meals
add_record({
  table: "meals",
  data: {
    food: "breakfast burrito",        // dish name only
    restaurant: "Crest Cafe",         // venue separate
    ingredients: "eggs, bacon, cheese", // comma-separated list
    meal_type: "breakfast",
    calories: 650
  }
})

// Workouts
add_record({
  table: "workouts",
  data: {
    exercise: "deadlifts",
    duration: 45,
    intensity: "high",
    calories_burned: 400,
    location: "Gold's Gym"
  }
})

// Expenses
add_record({
  table: "expenses",
  data: {
    item: "groceries",
    amount: 42.50,
    category: "groceries",
    vendor: "Trader Joe's"
  }
})

// Medications
add_record({
  table: "medications",
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
- If the table doesn't exist yet, provide a `tableDescription` on the first record

### save_memory

For experiences, reflections, notes, and anything the user might want to recall later.

```
save_memory({
  collection: "journal",
  text: "Had an amazing sunset dinner at Nobu overlooking the ocean. The black cod was incredible.",
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

### query_table

For retrieving and analyzing tracked data.

**Structured filters** for simple lookups:
```
query_table({
  table: "meals",
  filters: { meal_type: "dinner" },
  limit: 10
})
```

**SQL mode** for complex analysis:
```
query_table({
  table: "meals",
  sql: "SELECT food, COUNT(*) as times FROM meals GROUP BY food ORDER BY times DESC LIMIT 5"
})
```

- SQL queries are read-only and sandboxed
- Default limit is 50, max is 1000
- Use `offset` for pagination through large result sets

### search_memory

For semantic (meaning-based) search across saved memories.

```
search_memory({
  collection: "journal",
  query: "beach dinner sunset",
  minSimilarity: 0.7,
  limit: 5
})
```

- Default similarity threshold is 0.7 — lower it to 0.5 for broader results if initial search returns nothing
- Search one collection at a time; if unsure which collection, try `journal` first, then `notes`
- Results are ranked by cosine similarity score

### query_graph

For discovering relationships and patterns in the knowledge graph.

**Pattern queries** — find entities and relationships:
```
// Natural language
query_graph({ queryType: "pattern", pattern: "what food do I like?" })

// Structured
query_graph({
  queryType: "pattern",
  pattern: { entityType: "food", relation: "likes" }
})
```

**Traverse queries** — navigate from a specific entity:
```
query_graph({
  queryType: "traverse",
  entityId: 42,
  relation: "knows",
  maxHops: 2
})
```

- Use pattern queries when the user asks about categories ("what restaurants have I been to?")
- Use traverse queries when exploring connections from a known entity
- Max 3 hops for traversal

### review_memories

For handling contradictions and corrections.

**List contradictions:**
```
review_memories({ action: "list" })
```

**Resolve a contradiction:**
```
review_memories({
  action: "resolve",
  metaId: 123,
  resolution: "confirm"    // or "reject" or "keep_both"
})
```

- `confirm` — the newer information is correct, supersede the old
- `reject` — the older information was correct, discard the new
- `keep_both` — both are valid in different contexts (e.g., "likes pizza" and "avoiding carbs this month")

When the user says "that's wrong":
1. Call `review_memories({ action: "list" })` to find relevant contradictions
2. Ask the user which version is correct if ambiguous
3. Resolve with the appropriate action

## Critical Behaviors

### Save Automatically
When the user shares personal information, log data, or describe experiences — save it immediately. **Never ask "should I save this?"** The user expects Epitome to remember automatically.

### Avoid Duplication
Before saving, consider whether this information already exists:
- Profile data: use `update_profile` to merge (not create duplicates)
- Records: check if the same event was already logged today
- Memories: don't save the same experience twice in the same conversation

### Use Loaded Context
After calling `get_user_context`, actively reference the returned data in your responses. If you know the user is vegetarian, mention it when discussing meal options. If you know their timezone, use it for scheduling.

### Handle Consent Errors
If a tool returns a `CONSENT_DENIED` error, the user hasn't granted this agent permission for that resource. Tell the user:
> "I don't have permission to access [resource] yet. You can grant access in your Epitome dashboard under Settings > Agent Permissions."

Don't retry the same tool — it will fail again until permissions are updated.

## Profile vs Table vs Memory

Understanding when to use each storage type:

| Signal | Storage | Tool | Example |
|---|---|---|---|
| Stable personal fact | Profile | `update_profile` | "I'm allergic to shellfish" |
| Discrete data point | Table record | `add_record` | "I had lobster for dinner" |
| Experience or reflection | Memory vector | `save_memory` | "That dinner at the beach was magical" |

**Rules of thumb:**
- If it defines **who the user is** → profile
- If it's a **countable event** with structured fields → table record
- If it's a **narrative or feeling** the user might search for later → memory
- When in doubt, a single user statement can trigger multiple tools (e.g., "I had an amazing lobster dinner at Nobu" → `add_record` for the meal + `save_memory` for the experience)
