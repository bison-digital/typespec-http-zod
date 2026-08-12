# `typespec-http-zod` — where this work stands

Working record. Everything here is measured; where a number appears, it came from a command.

## START HERE

**State, 2026-08-12.** Extracted from a single un-split emitter and standing alone. **156 tests, 19
files, typecheck clean, lint clean.**

**Three numbers to lead every report with: divergences · emitter warnings · named refusals. Today
they are `0 · 0 · 3`.** Say them unprompted and flag the moment one moves.

The three refusals are `unsupported-status-code-range`, `unsupported-type` and
`undeclared-discriminator` (upstream, `microsoft/typespec#7141`). None is on the merits of this
emitter; each is a spec that cannot be represented honestly.

⚠️ **Nothing is published.** Publishing is public and permanent and needs explicit approval.

### The five things most easily lost

1. **Zero divergences does not mean nothing is left.** The baseline holds only what the differential
   can see. 131 format annotations and 76 inline response bodies are _counted, not compared_ — real gaps, deliberately visible as numbers, and stated in the README
   because a number in a baseline file is not a stated limitation once a package is published.
2. **The gate is graded too, and it pays every time.** Four defects this extraction were in the
   ORACLE, not the emitter, and every one accused the emitter falsely.
3. **A guard that looks present may do nothing.** Break what you guard the day you write it.
4. **`typespec-hono` is a sibling repository and the two move together.** A change to
   `test/reference/service.tsp` breaks it until its copy and digest are updated — see
   `test/reference/PROVENANCE.md`.
5. **`pnpm typecheck` is the last gate, always.** `tsconfig.json` sets flags the build config
   deliberately does not, so a green suite and a red typecheck is ordinary rather than contradictory.

---

## How this work is done — the method, not the manners

⚠️ **This section is why the effort works. Numbers can be re-measured; this cannot be re-derived from
the code.**

**Find the work by asking what nothing is looking at.** Not "where is the emitter wrong" — that
question produces guesses. The productive question is _what does the gate never open_. Prefer an
unopened surface to a narrow arm, and before extending an arm, ask whether some whole file, keyword
or artefact is going ungraded.

**Grade the gate before grading what the gate grades.** Every fix is judged by the differential.
Fixing defects while the ruler is known to be short is how something gets called done twice. The
scoreboard for this extraction is lopsided enough to be a rule: of the defects found, **four were in
the oracle and three in the emitter**, and all four oracle defects reported the emitter as wrong.

**Measure the runtime before editing `src/`.** Twice here a divergence looked like an emitter defect
and was not: a nullable-and-constrained property whose pattern the document publishes through a
`$ref` inside an `anyOf`, and a flattened collection parameter whose optionality the describer could
not see through `z.preprocess`. Both times the emitted validator was checked directly — `.isOptional()`,
`safeParse({})`, the document's own JSON — and both times the emitter was right. Had either been
"fixed" in `src/`, a correct validator would have been broken to satisfy a describer.

**Every guard gets a three-state control, on the day it is written.** Break what it guards → red;
revert **by re-editing, never `git checkout`** → green. Bug + fix → red is half; bug + _reverted_ fix
→ green is the half that proves the old gate was blind rather than the new one noisy.

⚠️ **`git diff --exit-code` proves nothing about an UNTRACKED file.** A control here reverted a file
git had never heard of and reported exit 0 — vacuous, not evidence. Commit first, or compare bytes
with `cmp` against a copy taken before the mutation.

**Verify the mutation applied.** A scripted replace that matches nothing still prints success. Every
edit script here asserts its anchor exists AND is unique; one of them caught a non-unique anchor and
refused to mutate, which is the outcome to want.

**`EXIT=$?` after a pipe is the pipe's last command.** Redirect to a file and read the status
separately. This produced a "passing" control that had not run.

**Ask the first-party question.** Where `@typespec/openapi3` decides something, read its source and
copy the rule — including its refusals. Where Hono decides something, read `hono-base.js`. The
`unroutable-verb` refusal in the sibling package exists because four lines of Hono's dispatcher say
so, not because a test failed.

**Assert the CLASS, never a list of members.** Diagnostics documented, options forwarded, foreign
terms absent, emitted import surfaces — all asserted as sets. A hand-kept list stops covering what the
code does, silently.

⚠️ **A claim in a README is not a guard, and this package shipped one that was not.** The README said
the zero-decorator class was "asserted rather than trusted" while nothing asserted it —
`vocabulary.test.ts` was never carried across in the extraction. That is the exact failure the rule
exists to prevent, reintroduced by the person enforcing it. When a document claims something is
checked, go and find the check.

**Non-vacuity floors on every counting arm.** An arm that stops firing otherwise reports agreement
about nothing. The constraint arm measured **zero** constraints across the entire corpus while
reporting agreement, for the whole life of its predecessor.

**Scale the claim to the evidence.** "Nothing broke" is not "nothing is wrong". Say which.

---

## What the oracles are

| oracle | proves | catches |
| --- | --- | --- |
| **Conformance differential** (`test/conformance/`) | the validators say what the document says | keys, openness, constraints, required, nullability, property and element types, parameters, declared statuses, response bodies |
| **Round-trip** (`test/reference/roundtrip*`) | it can serve an API nobody here designed | operations lost between the converter and this emitter; shapes that disagree with a document derived from somebody else's API |
| **Acceptance** (`test/acceptance.test.ts`) | the validators accept what the document permits and reject what it forbids | a schema that agrees with the document and throws when a value reaches it |
| **Vocabulary** (`test/vocabulary.test.ts`) | the validator says only what the document can say | a `.transform()`/`.refine()` smuggled in; a decorator shipped for a spec to depend on |
| **Emitted-output compile** (`test/emit.test.ts`) | the output is loadable TypeScript | unquoted keys, duplicate declarations, recursion that throws during module initialisation |
| **Reference service** (`test/reference/`) | question 1 — Zod alone | every construct that has broken an emitter, annotated with which |
| **Provenance** (`test/provenance.test.ts`) | the package names and obeys no codebase but its own | a rule keyed on a name the spec author chose |
| **Packaging** (`test/packaging.test.ts`) | what a stranger gets | an entry point outside `files`; test material shipped; a path dependency |
| **Documentation** (`test/documentation.test.ts`) | a refusal is findable, not discoverable | a diagnostic or option nobody wrote down; a declared diagnostic with no call site |

Corpus: `@typespec/http-specs@0.1.0-alpha.41`, **pinned exactly**, 61 scenarios differentiated. Both
emitters run from **one program** — recompiling would make disagreements ambiguous.

Depth fixtures exist because the corpus tests protocol behaviour, not validation:
`test/reference/constraints.tsp` carries every constraint keyword once, on the type it is legal on.

```bash
pnpm test        # everything
pnpm typecheck   # LAST, before every commit
```

Baselines regenerate with `UPDATE_CONFORMANCE_BASELINE=1`. **They may only shrink**, and both
directions are asserted: a new divergence fails as a regression, an entry that no longer diverges
fails as stale — deleting it is part of the fix.

---

## Defects found during the extraction

### In the emitter

| what | how it was found |
| --- | --- |
| **`types.ts` had no `@discriminator` handling at all.** `zod.ts` emitted a discriminated union; `types.ts` emitted the base's own properties. The contract type could not be narrowed, admitted every string the validator rejects, and the subtypes got no declaration. | `wire-contract.gen.ts`, whose whole purpose is catching the emitter disagreeing with itself across its two walks. Second defect of that class it has caught. |
| **A hardcoded `companyId` filter** dropped any parameter of that name from the emitted input type while the validator went on requiring it — two artefacts describing different shapes, from a rule no document states. | Reading every line of prose for the de-extraction sweep. It was code, not a comment. |
| **The wire assertion's failure message named one repository's architecture**, in every consumer's build output. | The same sweep. |

### In the oracle — all four accusing the emitter falsely

| what | how it was found |
| --- | --- |
| **The constraint reader stopped at an `anyOf`**, so a nullable-and-constrained property read as unconstrained in the document. `documentKindOf` already peeled that wrapper; the two describers disagreed about the same schema. | The constraint arm firing for the first time, once a depth fixture existed. |
| **The Zod describer could not see optionality through `z.preprocess`** (a `pipe` in Zod 4, whose `out` carries the schema), so a flattened collection parameter read as required. | The same run. Settled by measuring the runtime. |
| **A test asserted `"$select"` quoted.** `$` is a valid identifier start; the emitter was right. | Its own first run. |
| **Two suites compiled one fixture to one directory with different options, in parallel.** The same request answered 400, 200 and 204 across runs of an unchanged emitter. | Question 3 disagreeing with itself. |

---

## Open, in the order I would take them

1. **Two counted-but-ungraded surfaces remain**, both stated in the README: 131 unenforced `format`
   annotations (a decision, not a defect — `format` is an annotation under 2020-12) and 76 inline or
   negotiated response bodies read by status but not resolved to a component. `content-type`/`accept`
   is closed: 77 positions compared, no divergences.
2. **Publishing.** Needs explicit approval, and the GitHub repositories do not exist yet — which also
   means the sibling package's CI cannot pass, because it checks this one out.
3. **A second differential axis.** Everything is currently compared against `@typespec/openapi3`. A
   defect the two emitters share is invisible to that, by construction.

### Done, and worth not redoing

- **TypeSpec 1.14 → 1.15 and corpus alpha.40 → alpha.41** (`c0b41b3`), as its own slice. Every number
  unchanged: 65 scenarios, 581 document operations, 584 emitted, `0 · 0 · 3`.
- **TypeScript 6 → 7** (`c7d6095`), the native compiler. Emitted declarations differ in exactly one
  file and two lines, and the difference is union member ordering.
