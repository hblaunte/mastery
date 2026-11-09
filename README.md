# Mastery

Build your own course from your own sources, then be quizzed on it until you have mastered it.

Drop in PDFs, Markdown, DOCX, HTML or a URL. Mastery reads them, outlines the topics in the order
they depend on each other, and writes quiz items for each: multiple choice, free recall, essays
with rubrics, hands-on experiments where the material allows. Every item points back to the
passage it came from.

Then it tests you. For each item, in this order, with no way to skip ahead: **predict** how likely
you are to get it fully right, **answer** from memory, **reflect** on how it went. Nothing is
graded until the whole session is in. Then each answer is marked against its rubric and the
source passage, your own sentences are highlighted good / weak / wrong, what you missed comes
back sooner, and a calibration report tells you whether your confidence tracks your knowledge.

As items are mastered they light up on a 3D knowledge graph of what you now know.

The design follows Bjork, Dunlosky & Kornell (2013). If something feels obstructive,
[docs/pedagogy.md](docs/pedagogy.md) names the finding it comes from.

## Run it

```bash
pnpm install
pnpm dev            # server on :8787, web on :5173 (proxies /api)
```

Open http://localhost:5173. Add your Anthropic API key under the key icon (it is stored encrypted
on your machine and never reaches the browser), drop a source into the Library, build a course,
begin a session. The tour walks through it the first time.

For a single-origin build: `pnpm build && pnpm start`, then http://127.0.0.1:8787.

## Your key, or ours

Grading and course building call Claude. Bring your own key and you pay Anthropic directly;
every session and every build shows what it cost. An operator who starts the server with
`MASTERY_MANAGED_KEY` set can offer a managed key instead, which appears as an option in Settings.

## What grades what

| Job | Route | Why |
|---|---|---|
| Multiple choice | local, no API call | nothing for a model to judge |
| Essay, experiment | `claude-opus-5-5`, effort high | applying a rubric and refusing to reward fluent prose that commits to nothing |
| Free recall | `claude-sonnet-5-5`, effort medium | a bounded comparison against an answer key |
| Calibration report | `claude-sonnet-5-5`, effort medium | the numbers are computed locally; the model writes the prose |
| Course outline, items | `claude-opus-5-5`, effort high | the course is only as good as its items |

Every route is an environment variable; see `.env.example`. The prompts are plain Markdown in
`prompts/`, editable from Settings, live on the next request.

## Layout

See [docs/architecture.md](docs/architecture.md). The graph's lighting rule is in
[docs/graph-threshold.md](docs/graph-threshold.md).

## Credits

The visual language (tokens, glass surfaces, blur-through sheets, the floating tab bar) is ported
from the Helm Frontend Kit; see `packages/ui/ATTRIBUTION.md`. The knowledge graph's visual system
(star nodes, light-beam links, focus mode) is ported from Universal Graph.
