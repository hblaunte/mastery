# Attribution

`tokens.css`, `glass.css`, `glass.tsx` and `icons/` are ported from the Helm Frontend Kit
(the standalone snapshot of Helm's glass frontend, `~/Documents/Helm Frontend Kit`, copied from the
Helm repo at commit 2e19b25, 2026-11-04). The kit's own README describes the design: per-section
colour washes, blur-through sheets, a floating tab bar with a liquid lens, ink pills, three motion
curves. Only the visual language was taken; no product content came with it.

Changes made here:
- Section washes renamed for Mastery's tabs (home, study, library, graph, progress) with new hues.
- `index.ts` holds Mastery's own helpers; Helm's workload/stage vocabulary was not carried over.
- Icons added for study, graph and sources.
