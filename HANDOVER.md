# `typespec-http-zod` — where this work stands

Working record. Everything here is measured; where a number appears, it came from a command.

## START HERE

**State, 2026-08-12.** Extracted from a single un-split emitter and standing alone. **176 tests, 23
files, typecheck clean, lint clean, format clean.**

⚠️ **This line was stale by 19 tests before anyone noticed.** It said 157 while the suite ran 173, and
the number is the first thing a reader trusts. Re-measure it — `pnpm test` — rather than editing
around it.

**Three numbers to lead every report with: divergences · emitter warnings · named refusals. Today
they are `0 · 0 · 3`.** Say them unprompted and flag the moment one moves.

The three refusals are `unsupported-status-code-range`, `unsupported-type` and
`undeclared-discriminator` (upstream, `microsoft/typespec#7141`). None is on the merits of this
emitter; each is a spec that cannot be represented honestly.

⚠️ **Nothing is published.** Publishing is public and permanent and needs explicit approval.

### The five things most easily lost

1. **Zero divergences does not mean nothing is left, and it does not mean the package is usable.** The
   baseline holds only what the differential can see, and the differential compares two BUILD-TIME
   artefacts. It said `0 · 0 · 3` while the README told adopters to install the package in a way that
   made its only runtime export fail to resolve — a defect no document comparison can reach, because
   the disagreement is with `node_modules` rather than with the document. What is still counted rather
   than compared is stated in the README's `Known limits`, because a number in a baseline file is not a
   stated limitation once a package is published.
2. **The gate is graded too, and it pays every time.** Of the defects found across the extraction and
   the pre-publication review, the ORACLE has produced more than the emitter — and every oracle defect
   accused the emitter falsely. The prototype JSON Schema axis alone opened with **206 accusations over
   218 comparisons, all of them its own**. If a test says the emitter is wrong, parse a real value
   before editing `src/`.
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

⚠️ **Install the tarball and be the adopter. No harness can see what a harness configures away.** Four
defects were found this way against a suite of 173 passing tests, and none of them was findable from
inside: every compile in both repositories sets `runtime-module` explicitly, so the default branch was
ungraded; every harness runs with dev dependencies present, so a runtime import that cannot resolve in
production resolves in all of them. `pnpm pack`, install into a project outside both repos under
`node-linker=isolated`, follow the README **literally**, and run the output — not just typecheck it.
The gap between "it compiles" and "it runs where a stranger put it" is where this class lives.

**Two test-hygiene rules that cost a day to learn, and are load-bearing.** `pnpm vitest run` **skips
the build** — `pnpm test` is `tsc -p tsconfig.build.json && vitest run`, and controls run the wrong way
pass against a stale `dist`. And no test file may depend on emitted output another test file wrote:
both suites once failed on a clean tree and passed on the second run, because `vocabulary.test.ts` and
`packaging.test.ts` graded whatever `.gen.ts` files happened to be on disk under vitest's parallelism.
`test/support/emitted-set.ts` gives each sweep its own input and its own output directory, and
`isolation.test.ts` asserts no two test files share one. Do not reintroduce the dependency.

**Scale the claim to the evidence.** "Nothing broke" is not "nothing is wrong". Say which.

---

## What the oracles are

| oracle                                             | proves                                                                     | catches                                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Conformance differential** (`test/conformance/`) | the validators say what the document says                                  | keys, openness, constraints, required, nullability, property and element types, parameters, declared statuses, response bodies |
| **Round-trip** (`test/reference/roundtrip*`)       | it can serve an API nobody here designed                                   | operations lost between the converter and this emitter; shapes that disagree with a document derived from somebody else's API  |
| **Acceptance** (`test/acceptance.test.ts`)         | the validators accept what the document permits and reject what it forbids | a schema that agrees with the document and throws when a value reaches it                                                      |
| **Vocabulary** (`test/vocabulary.test.ts`)         | the validator says only what the document can say                          | a `.transform()`/`.refine()` smuggled in; a decorator shipped for a spec to depend on                                          |
| **Emitted-output compile** (`test/emit.test.ts`)   | the output is loadable TypeScript                                          | unquoted keys, duplicate declarations, recursion that throws during module initialisation                                      |
| **Reference service** (`test/reference/`)          | question 1 — Zod alone                                                     | every construct that has broken an emitter, annotated with which                                                               |
| **Provenance** (`test/provenance.test.ts`)         | the package names and obeys no codebase but its own                        | a rule keyed on a name the spec author chose                                                                                   |
| **Packaging** (`test/packaging.test.ts`)           | what a stranger gets                                                       | an entry point outside `files`; test material shipped; a path dependency                                                       |
| **Documentation** (`test/documentation.test.ts`)   | a refusal is findable, not discoverable                                    | a diagnostic or option nobody wrote down; a declared diagnostic with no call site                                              |

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

| what                                                                                                                                                                                                                                                                     | how it was found                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`types.ts` had no `@discriminator` handling at all.** `zod.ts` emitted a discriminated union; `types.ts` emitted the base's own properties. The contract type could not be narrowed, admitted every string the validator rejects, and the subtypes got no declaration. | `wire-contract.gen.ts`, whose whole purpose is catching the emitter disagreeing with itself across its two walks. Second defect of that class it has caught. |
| **A hardcoded `companyId` filter** dropped any parameter of that name from the emitted input type while the validator went on requiring it — two artefacts describing different shapes, from a rule no document states.                                                  | Reading every line of prose for the de-extraction sweep. It was code, not a comment.                                                                         |
| **The wire assertion's failure message named one repository's architecture**, in every consumer's build output.                                                                                                                                                          | The same sweep.                                                                                                                                              |

### Found by being the adopter — a fresh project, a `pnpm pack` tarball, no Hono

⚠️ **Every one of these was invisible to 173 passing tests, because every harness in both repositories
runs with dev dependencies present and configures away the path a consumer actually takes.** The
method that found them was not a new arm: it was installing the tarball into a project outside both
repos and following the README literally.

| what                                                                                                                                                                                                                                                                                                              | how it was found                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **The README said `npm install --save-dev`, and `armFor` is a runtime VALUE.** An application calling it typechecks, builds and runs in development, then fails on deploy with `ERR_MODULE_NOT_FOUND`. Same `dist/` bytes: devDependency exit 1, `dependencies` exit 0. `typespec-hono` had the identical defect. | Running the emitted output under a production install. Nothing else distinguishes the two cases. |
| **`EmittedRoute.paramsSchema` was dead AND wrong in two measured ways** — no wire decoding (`z.number().int()` met `"1"`), and headers keyed on the TypeSpec name rather than the wire name. Written on every route, read by nothing. Deleted before 0.1.0 froze it.                                              | Asking which field an adopter reaches for first. It reads as "the parameters".                   |
| **The README's own quickstart emitted 1 of the 4 advertised files**, and set `seal-object-schemas: true` while that option's row says to match openapi3, whose default is `false` — instructing a divergence against the document this package claims to agree with.                                              | Following the quickstart and counting the files.                                                 |
| **The promised identifiers were wrong for any spec using a namespace** (`Widgets_readWidgetPath`, not `readWidgetPath`), and a validator that is already a component gets no second name — so nothing in the emitted file said which schema validates which operation.                                            | Writing the Express handler the README does not contain.                                         |

### In the oracle — all four accusing the emitter falsely

| what                                                                                                                                                                                                                             | how it was found                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **The constraint reader stopped at an `anyOf`**, so a nullable-and-constrained property read as unconstrained in the document. `documentKindOf` already peeled that wrapper; the two describers disagreed about the same schema. | The constraint arm firing for the first time, once a depth fixture existed. |
| **The Zod describer could not see optionality through `z.preprocess`** (a `pipe` in Zod 4, whose `out` carries the schema), so a flattened collection parameter read as required.                                                | The same run. Settled by measuring the runtime.                             |
| **A test asserted `"$select"` quoted.** `$` is a valid identifier start; the emitter was right.                                                                                                                                  | Its own first run.                                                          |
| **Two suites compiled one fixture to one directory with different options, in parallel.** The same request answered 400, 200 and 204 across runs of an unchanged emitter.                                                        | Question 3 disagreeing with itself.                                         |

---

## Open, in the order I would take them

1. **Every counted-but-ungraded surface is closed.** `content-type`/`accept`: 77 positions compared.
   Response bodies: 24 by shape and 44 by kind, leaving 4 negotiated entries no single arm can be
   attributed to and 4 that reduce to no readable kind on either side — both pinned, not floors.
   `format` is no longer a counter at all: not enforcing it is a decision, and a class assertion now
   refuses any format-derived Zod call, so turning it on breaks a test rather than moving a number.
2. **Publishing.** Needs explicit approval, and the GitHub repositories do not exist yet — which also
   means the sibling package's CI cannot pass, because it checks this one out.
3. **A second differential axis — assessed, prototyped, and deliberately NOT landed.** Everything is
   currently compared against `@typespec/openapi3` through describers we wrote, and that is the weak
   point rather than a theoretical one: four extraction defects lived there and every one accused the
   emitter falsely. `shape.ts` reconstructs schemas by hand from Zod's INTERNAL `._zod.def` across 788
   lines, which nothing obliges Zod to keep stable across the `^4.0.0` peer range.

   **`z.toJSONSchema()` is Zod's own supported serialiser, so it replaces all of that.** Built into
   `differential.test.ts` (same compile — a second compile would make every disagreement ambiguous),
   it went from **206 divergences / 218 comparisons** to **64**, and **every class diagnosed was the
   ORACLE being naive, not the emitter**. Reverted rather than landed: 64 false accusations is not
   shippable, and a skip-predicate tuned until the arm goes green is the vacuous arm this file warns
   about. The patch is worth resuming; these are the expensive facts it cost hours to learn.

   ⚠️ **`io: "input"` is load-bearing.** In OUTPUT mode `z.strictObject` and `z.object` both report
   `additionalProperties: false` — the output of a stripping object has only known keys — so openness
   silently stops being compared. In input mode the three are distinct: `false`, absent, `{}`. Input
   is also what a request contract states: what the validator ACCEPTS.

   ⚠️ **`unevaluatedProperties` is `allOf`-AWARE, and that is why openapi3 uses it.** A model
   extending `Record<float32>` is published as `allOf: [{$ref: TheRecord}]` with
   `unevaluatedProperties: {not: {}}`, and that does **not** seal it — the base's
   `additionalProperties` has already evaluated those keys, so the typed catchall survives
   inheritance. Zod has no such composition, so the emitter writes `.catchall(z.number())` on the
   derived model and **the two agree**. Reading `{not:{}}` as "sealed" accused the emitter on 30
   components in `type/property/additional-properties` alone.

   The other four reconciliations, all legitimate dialect differences rather than defects:
   `unevaluatedProperties: {not:{}}` vs `additionalProperties: false`; `enum: [x]` vs `const: x` (2020-12
   defines them as equivalent); `contentEncoding`/`contentMediaType` as annotations, exactly like
   `format`; and `propertyNames: {type: "string"}` from `z.record`, which asserts nothing because every
   JSON key is a string. Components must be registered under their document names so nested references
   serialise as `#/$defs/<Name>` rather than inlining — inlining diverges on every nested model and
   does not terminate on the recursive fixtures.

4. **`zod/mini` does not work, and it is a stated-audience problem rather than a footnote.** The
   tree-shakeable variant has **no chained methods at all** — measured on 4.4.3, `typeof
z.string().optional`, `.nullable` and `.min` are each `undefined` — while the emitted validators use
   `.optional()`, `.nullable()`, `.default()`, `.strict()`, `.loose()` and `.catchall()`. Browsers and
   Workers are named audience in the first paragraph of the README. This is a property of the emitted
   SPELLING rather than of the schemas, so an emission mode using the functional forms is possible;
   recorded in `Known limits` as a measured fact, not a plan.

5. **Refusal severity is an open question, and the accounting blocks it.** All three refusals are
   `severity: "error"`. An `error` sets `program.hasError()`, and `@typespec/openapi3` then writes **no
   document at all** — so a consumer running both emitters loses their OpenAPI file. openapi3 marks
   `unsupported-status-code-range` an error itself (verified in its `lib.js`, 1.14 and 1.15), so that
   one is settled; `undeclared-discriminator` is upstream `microsoft/typespec#7141`, which reads as
   "valid spec, cannot currently be expressed" rather than "spec is wrong for any emitter".

   ⚠️ **Do not flip one before re-keying the accounting.** `corpus.ts:244` counts `emitterWarnings` as
   `severity === "warning"` and records a refusal only where a `severity === "error"` exists. Flipping
   any refusal swings `0 · 0 · 3` to `0 · 3 · 0` with **nothing having changed** — and worse, conflates
   "knowingly shipping output the document does not describe" with "refused to emit", which are
   different facts. Key on the diagnostic CODE, read from `$lib`.

### Done, and worth not redoing

- **TypeSpec 1.14 → 1.15 and corpus alpha.40 → alpha.41** (`c0b41b3`), as its own slice. Every number
  unchanged: 65 scenarios, 581 document operations, 584 emitted, `0 · 0 · 3`.
- **TypeScript 6 → 7** (`c7d6095`), the native compiler. Emitted declarations differ in exactly one
  file and two lines, and the difference is union member ordering.
