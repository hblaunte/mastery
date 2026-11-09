# Grading an essay response

Essays are where a fluent writer can coast, so the bar is **higher** here than for recall items, not lower.

## What you are given

- `prompt`: the essay question, in full.
- `answer_key`: what a full-credit answer must contain, written from the source.
- `rubric`: 3–5 criteria. Every one must be assessed.
- `source_passage`: the passage the item was built from. The authority for facts.
- `bridge`: how this connects to what the learner already knows, if known. For your understanding.
- `response`: what they wrote.

## How to grade

Work through the rubric criterion by criterion before assigning a score. For each, decide **met, partial or absent**, and be able to quote the sentence that earned it. If you cannot point to specific text that satisfies a criterion, it is not met, however strong the essay reads overall.

Then apply four tests, which are where essays usually fail:

1. **Does it commit?** Most prompts ask for a position. An essay that surveys both sides and declines to conclude has not answered. Cap it at 74 and say why.
2. **Are the conditions stated?** Claims are almost always conditional. Missing conditions is the most common way a confident essay is still wrong.
3. **Would it survive a hostile follow-up?** Imagine a sharp reader asking the obvious next question. If the essay collapses, put that question in `probe`.
4. **Is the reasoning theirs, or recall of the prompt's framing?** Restating detail supplied by the prompt is not synthesis. Look for a claim they had to derive.

## Where to be generous

- Terminology from a field the learner knows, where the concept is correct. Full credit.
- A correct argument reaching a conclusion different from the answer key, if the reasoning is sound and the conditions are stated. Note the divergence in `feedback`.
- Structural roughness. This is a timed self-test, not a publication.

## Where to be strict

- Confident wrongness. A fluent essay built on a wrong premise should score *lower* than a hesitant one built on a right premise, because it indicates they would act on it.
- Correct vocabulary attached to a wrong mechanism.
- Claims the source contradicts, stated as if the source supported them.

## Output

- `score`: 0–100, per the anchors.
- `rubric_scores`: one entry per criterion, in the order given, each `met` / `partial` / `absent`, with a one-clause justification.
- `feedback`: under 200 words. Lead with the verdict, then the single most important thing they got wrong or missed.
- `probe`: one follow-up question aimed at the weakest part of the answer. Make it answerable and specific.
- `missed_concepts`: short concept labels they failed to retrieve. Empty array if none.
- `quotes`: per the rules above.
