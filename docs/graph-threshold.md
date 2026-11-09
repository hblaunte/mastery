# When does an item earn its node?

The knowledge graph is populated automatically from your own graded answers. The question is
where to put the bar. This document is the reasoning behind the default, and the knobs.

## The default: latest score at or above 75, and not multiple choice

**75** is not arbitrary. It is the boundary that already carries meaning in two other places in
the system, so a third system agreeing with it costs nothing to learn:

- In the grading anchors (`prompts/_system.md`), 75–89 is "substantively correct with a real gap".
  Below 75 the answer "would mislead someone who trusted it". A node on a map of what you know
  should not represent something you would mislead someone about.
- Reading suggestions attach only to items scored below 75. Above it, a correct answer gets no
  reading list. So the two outputs of a grade are complementary: below 75 you get a passage to
  read, at or above 75 you get a node. Nothing falls between.

The spacing ladder's pass mark is 70, deliberately lower: a 70 is good enough evidence to lengthen
the interval, since partial retrieval still strengthens memory, but not good enough to display as
knowledge. The graph is the stricter of the two because it is the one you will look at and believe.

**Latest score, not best score.** A node that stays lit after a lapse would be a map of what you
once knew. Using the latest score means a node can go dark again, which is the honest reading.

**Multiple choice never fully lights a node.** Recognising the right option among four is not the
same as producing it, and the whole platform exists to tell those two apart. Multiple-choice
items feed the schedule and the course stats but contribute nothing to the graph on their own.
Their topic lights when a produced item (recall, essay, experiment) under it lights.

## Three states, so the graph is not binary

| State | Items | Topics |
|---|---|---|
| **emerging** | latest produced score 55–74: the core idea is present | at least one item emerging, none lit |
| **lit** | latest produced score ≥ threshold | at least one item lit |
| **mastered** | latest score ≥ 90 **and** ladder box ≥ 3 (survived at least a 4-day interval) | 80% or more of items lit |

Emerging nodes render dim, lit nodes at full glow, mastered nodes larger with a slow breathing.
Items scored below 55 do not appear at all; they are counted as "not yet lit" in the legend so
the gap is visible without being decorated.

## Links

- **member**: topic ↔ item, quiet.
- **prereq**: from the course outline, medium.
- **concept**: two lit items whose grades named the same missed concept, brightest. This is the
  link the learner cannot see from inside: what they keep confusing together.

## The knob

`Settings → Knowledge graph threshold`, or `MASTERY_GRAPH_THRESHOLD`, from 50 to 95 in steps of 5.
Lower is more forgiving. 90 means only near-perfect answers count. Changing it recomputes the
graph on the next view; nothing is stored, the graph is derived from courses plus the schedule.

## Alternatives considered

- **Best-ever score.** Rejected: the graph would never go dark, so it would stop being information.
- **Two consecutive passes.** Safer against a lucky day, but it makes the first session feel inert
  and the ladder already punishes a lapse. Could be offered as a strict mode later.
- **Pass mark 70, same as the ladder.** Rejected so that the reading cutoff and the node cutoff
  agree; a 72 would otherwise get both a reading list and a node, which reads as a contradiction.
