# Rep Royale rebrand (Direction A · Monochrome Precision)

- `IMPLEMENTATION_PLAN.md`: the plan for the redesign (design system, navigation, frame → code map, PR order, builds, risks). It tracks progress in its **Progress** section and in the **Status** column of §6.
- `frames/`: the 30 final flow frames (01 Welcome … 30 Daily reminder).
- `empty-states/`: the 15 empty states (E01 … E15).

The frames are HTML mockups standing in for native iOS. Inter stands in for SF Pro, and the frames are 1206 × 2622 (3x of a 402 × 874 pt iPhone). These copies are 256-colour PNGs, which keeps the repo small. The palette colours (`#000000`, `#111113`, `#1C1C1E`, `#30D158`, `#FFFFFF` …) are pixel-exact; only anti-aliased edges are approximated.

The design tokens in code live in `src/ui/tokens.ts`.
