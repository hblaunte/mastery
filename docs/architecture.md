# Architecture

```
apps/web        React 19 + Vite. The glass shell (tabs, washes, sheets) from packages/ui.
                screens/   Home · Study · Library · Graph · Progress (the five tabs)
                sheets/    Session · Results · Settings · Reader · Build · Course (blur-through sheets)
                onboarding/  the spotlight tour
                graph/     the 3D knowledge graph (ported visual system)
apps/server     Hono on Node. JSON on disk under data/. Talks to the Claude API; the browser never does.
                config.ts   env, model routing          keys.ts     encrypted key vault, byok / managed
                store.ts    courses, state, sessions    library.ts  the Markdown library (raw, pages, index, log)
                llm.ts      client, caching, structured calls, cost
                scheduler.ts ladder, interleaving       grader.ts   mcq locally, the rest by rubric
                sessions.ts new / submit                graph.ts    derive GraphData from courses + state
                jobs.ts     background builds and OCR   ingest/     extract (pdf, docx, pptx, xlsx, epub, html, md, url), chunk, ocr
                generate/   outline + items pipeline    app.ts      routes (see packages/shared for the list)
packages/shared the API contract (types)
packages/ui     tokens.css, glass.css, glass.tsx (ported; see ATTRIBUTION.md)
prompts/        grading and generation prompts, plain Markdown, re-read on every request
```

## Data flow

1. **Library**: a dropped file is extracted to Markdown on the server and stored the way
   Karpathy's LLM-wiki pattern stores knowledge: the original bytes under `data/library/raw/`
   (never edited), one `data/library/sources/<id>.md` page per source with frontmatter (origin,
   SHA-256, pages, extraction method, pages still needing OCR), a map of content in
   `data/library/index.md`, and an append-only `data/library/log.md`. Passages with locators
   ("pp. 12–14", "slide 3", "3 Methods › 3.2 Sampling") are derived from the Markdown on read, so
   an edit to the page in the reader is what the builder and the grader see next. The same file
   dropped twice is recognised by hash. Scanned PDF pages are detected per page and transcribed on
   request with Claude's native PDF input (`POST /api/library/:id/ocr`, cheap tier, batches of 15
   pages), then merged back under their page markers. Nothing leaves the machine until a build or
   a grade, and then only the passages involved.
2. **Build**: `POST /api/courses/build` starts a job. The pipeline outlines topics from the
   passages, then writes items per topic with the grounding text in context. Progress streams
   over SSE. The result is `data/courses/<id>.json`, which holds the answer keys and is never
   served whole: `GET /api/courses/:id` strips them.
3. **Session**: `POST /api/session/new` picks due and fresh items across the chosen courses and
   returns them without answers. `POST /api/session/submit` grades everything, updates the
   ladder in `data/state.json`, attaches reading to misses, computes bias and resolution
   locally, asks the cheap tier for the prose report, and writes `data/sessions/<stamp>.json`.
4. **Graph**: `GET /api/graph` derives nodes and links from courses plus state on every call.

## Languages

The interface ships in English, Simplified Chinese and Traditional Chinese (`Settings → Language`,
default "System", which follows the browser). Generated text follows `Settings.language` too: when
it is "auto", every prompt carries a note telling the model to write items, feedback and reports in
the language of the source and to answer the learner in the language they wrote in; when it is set,
the note names that language. The note is substituted for `{{language}}` in `prompts/_system.md`,
`build-outline.md` and `build-items.md`. Server-side strings the learner reads (build progress,
local multiple-choice verdicts, key and model errors) come from `apps/server/src/i18n.ts`, chosen
by the setting or, under "auto", by the client's `x-mastery-lang` header.

Chinese text is handled in the chunker: sentences split at 。！？； as well as at Latin punctuation,
the overlap tail cuts at a clause mark rather than a space, and the passage target shrinks with the
share of CJK characters (6,000 Latin characters or about 2,400 Chinese ones, roughly the same token
budget). `Source.tokens` estimates one token per CJK character and four Latin characters per token
and drives the cost estimates. Quote highlighting is substring matching, so the grader's marks land
on Chinese sentences unchanged. OCR is told to transcribe in the language of the page and keep
full-width punctuation.

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

The server binds 127.0.0.1 and, in development, has no authentication: it is a personal, local
tool as shipped. Putting it on a network means adding a login in front of it and moving `data/`
somewhere durable.

The desktop app (`apps/desktop`) runs this same server inside Electron on a random local port
with a per-launch token (`MASTERY_TOKEN`, checked on every `/api` request), with `MASTERY_DATA_DIR`,
`MASTERY_PROMPTS_DIR` and `MASTERY_WEB_DIST` pointed at the user's application folder and the
bundle's resources. `startServer()` in `server.ts` is the entry both `pnpm start` and the shell
use. See [packaging.md](packaging.md).
