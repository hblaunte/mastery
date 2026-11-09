# Architecture

```
apps/web        React 19 + Vite. The glass shell (tabs, washes, sheets) from packages/ui.
                screens/   Home · Study · Library · Graph · Progress (the five tabs)
                sheets/    Session · Results · Settings · Reader · Build · Course (blur-through sheets)
                onboarding/  the spotlight tour
                graph/     the 3D knowledge graph (ported visual system)
apps/server     Hono on Node. JSON on disk under data/. Talks to the Claude API; the browser never does.
                config.ts   env, model routing          keys.ts     encrypted key vault, byok / managed
                store.ts    persistence                 llm.ts      client, caching, structured calls, cost
                scheduler.ts ladder, interleaving       grader.ts   mcq locally, the rest by rubric
                sessions.ts new / submit                graph.ts    derive GraphData from courses + state
                jobs.ts     background course builds    ingest/     extract + chunk sources
                generate/   outline + items pipeline    app.ts      routes (see packages/shared for the list)
packages/shared the API contract (types)
packages/ui     tokens.css, glass.css, glass.tsx (ported; see ATTRIBUTION.md)
prompts/        grading and generation prompts, plain Markdown, re-read on every request
```

## Data flow

1. **Library**: a dropped file is extracted to text on the server, split into passages with
   locators, and stored as `data/sources/<id>.json` + `.chunks.json`. Nothing leaves the machine.
2. **Build**: `POST /api/courses/build` starts a job. The pipeline outlines topics from the
   passages, then writes items per topic with the grounding text in context. Progress streams
   over SSE. The result is `data/courses/<id>.json`, which holds the answer keys and is never
   served whole: `GET /api/courses/:id` strips them.
3. **Session**: `POST /api/session/new` picks due and fresh items across the chosen courses and
   returns them without answers. `POST /api/session/submit` grades everything, updates the
   ladder in `data/state.json`, attaches reading to misses, computes bias and resolution
   locally, asks the cheap tier for the prose report, and writes `data/sessions/<stamp>.json`.
4. **Graph**: `GET /api/graph` derives nodes and links from courses plus state on every call.

## Keys

`PUT /api/keys {mode:"byok", key}` encrypts the key with AES-256-GCM under a machine-local
secret (`data/.secret`, mode 0600) and validates it with one free `models.list` call. The status
endpoint returns only the mode and the last four characters. `mode:"managed"` uses the operator's
`MASTERY_MANAGED_KEY`; the billing side of "pay us and we hold the key" is not built, only the
switch that would sit behind it.

## Cost

Every API call records tokens and the cache hit. Sessions and builds show an estimated cost from
a published rate table (`llm.ts`). The first item of each (model, kind) group is graded alone to
write the cache prefix; the rest fan out and read it.

## Deploying

The server binds 127.0.0.1 and has no authentication: it is a personal, local tool as shipped.
Putting it on a network means adding a login in front of it and moving `data/` somewhere durable.
