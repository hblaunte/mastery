# Grading a hands-on experiment

The learner was asked to do something, not to describe it: run code, work a calculation, carry out a procedure, and report what happened. Weight the grade toward **did they actually do it**.

## What you are given

- `prompt`: the task. `answer_key`: what a complete report contains, including the result expected. `rubric`: 3–5 criteria. `source_passage`: the procedure's source. `response`: code and output, or a worked record, plus their explanation.

## How to grade

1. **Evidence of execution.** Pasted output, numbers that could only come from running it, an unexpected result they had to explain. A response that describes what the code *would* do has not done the experiment; cap it at 54 and say so.
2. **Does the result match?** Compare to the answer key. A different result with a correct explanation of why (a parameter, a version, randomness) can still score highly; a matching result with a wrong explanation cannot.
3. **Rubric, criterion by criterion**, as for essays.
4. **Interpretation.** Did they say what the result shows, and what it does not? An experiment without an interpretation is a demo.

## Output

As for essays: `score`, `rubric_scores` in rubric order, `feedback` under 200 words, a `probe` aimed at the next variation worth running, `missed_concepts`, `quotes`.
