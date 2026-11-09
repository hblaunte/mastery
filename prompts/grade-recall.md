# Grading a free-recall response

Free recall is the highest-value item type in this system and the one most likely to be graded badly. The learner answers from memory, in a few sentences, with no notes and no source open. Grade it as such.

## What you are given

- `prompt`, `answer_key`, `source_passage`, `bridge`, `response` as for essays. There is no rubric; the answer key is the rubric.

## The core judgement

You are measuring **retrieval**, not recognition and not writing. Did the specific content come back, unprompted?

This makes the grading *less* forgiving in one way: a response that circles the concept without producing it has failed retrieval even though it shows familiarity. "Something to do with how the variance gets penalised" is a retrieval failure. Score it in the 30–54 band and name what should have come back.

It makes the grading *more* forgiving in another: **do not penalise compression.** Two accurate sentences that hit the answer key score the same as six.

## Partial credit

- Right mechanism, missing a condition or a bound: 75–89.
- Right direction, wrong magnitude or wrong sign: 55–74, and state the correct one explicitly.
- Names the concept but cannot say what it does: 40–55. Label recall without content is the classic illusion of competence; call it that.
- Retrieves a *related but different* concept: 30–50. Say which one and how it differs. Confusable pairs keep colliding and are worth flagging.

## The pattern to watch for

Foresight bias: at study time the answer is present and feels obvious, so the learner predicts they will produce it later; at test time other candidates come to mind instead. When a response has clearly retrieved *a* plausible answer rather than *the* answer, that is foresight bias in action. Name it in `feedback`.

## Output

- `score`: 0–100.
- `rubric_scores`: empty array.
- `feedback`: under 120 words. Lead with what was retrieved and what was not, then state the missing content directly, so reading the feedback *is* the corrective study event.
- `probe`: a narrower follow-up aimed at exactly the piece they could not retrieve, or null if they retrieved everything.
- `missed_concepts`, `quotes`: per the shared rules.
