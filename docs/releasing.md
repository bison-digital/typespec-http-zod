# Releasing

This package publishes **first**, always, and the reason is worth knowing before you cut one.

## Why the order is not a preference

[`typespec-hono`](https://github.com/bison-digital/typespec-hono) is built on this package's API and
declares it as an ordinary dependency, resolved by version range. So its dependency bump cannot
install until the version it names exists on the registry, and its CI - which runs
`pnpm install --frozen-lockfile` - fails at the install step rather than at a test.

That means **a change spanning both packages is not verifiable by either repository's CI.** It is
also not verifiable by `pnpm pack` plus a `file:` override, which is the quick way and skips the one
thing that matters here: version-range resolution. A tarball cannot tell you that `^0.24.0` reaches
this package, that a peer range is satisfiable, or that a transitive install lands at all.

## Rehearse before you publish

Publish both packages to a registry running on your machine and install from it into an empty
directory, exactly as a stranger would. Same evidence as a real publish, none of the
irreversibility. `typespec-hono`'s `docs/releasing.md` carries the commands; the short version is
`verdaccio`, `npm publish --registry http://localhost:4873 --provenance=false`, then a clean
`npm install` in a fresh directory - and then **check what the registry resolved rather than what
you asked for**, because the transitive edge is the whole point.

Then compile a spec against it, typecheck a consumer file, and put values through the emitted
validators. Emitted output that compiles is a weaker claim than emitted output that parses.

## Checks before anything is published

A green suite proves the suite; it does not prove every claim a release makes. A contradiction of the
document, a check loosened to let a change pass, or a "known limit" that should have been a fix is
found by asking what the release claims rather than whether the gates are green. So before the
rehearsal:

- **Every changed code path has a test that was shown to fail**: the fix removed, the test red, the
  fix restored.
- **Every sentence in the CHANGELOG and the guides** is backed by a test or a captured measurement -
  including a sentence about what a sibling package does.
- **Every option the change touches was exercised**, `compile-schemas` and `seal-object-schemas`
  among them, and the suite was run at the bottom of the `zod` peer range.
- **No new entry under Known limits.** An artefact either agrees with the document or the emitter
  refuses the construct with a diagnostic; a gap is fixed, not listed.
- **No pin raised and no carve-out added to a check** to let a change pass.
- **The schema derived from a validator answers as the validator does**, wherever it is published
  (an MCP tool's `inputSchema`).
- **Every claim about "the document" holds at every OpenAPI version openapi3 publishes, its default
  `3.0.0` first.** 0.31.0 graded 3.1 and 3.2 alone, read a required read-only property as 3.1 does,
  and refused every create body leaving out a server-assigned `id` - which openapi3's default 3.0
  document accepts. `conformance/openapi30.test.ts` grades the 3.0 compile; a change to how a schema
  is read is checked there and in `behaviour.test.ts`.
- **Every downstream suite runs against the rehearsal packages before anything is published**:
  `typespec-hono`, `typespec-http-mcp`, `typespec-postman`'s run suite, and the reference consumer,
  `typespec-hono-example`, which sends a create body without its server-assigned read-only `id`.
  0.31.0's regression was found by postman's run suite, after publishing, because it was pinned to an
  older server and nothing ran it against the release.

## The sequence

1. The checks above. Then rehearse with both packages at their release versions.
2. Four gates here, **by exit code** - `pnpm test`, `pnpm typecheck`, `pnpm lint`,
   `pnpm format:check`. Never through a pipe: `pnpm typecheck | tail` reports `tail`'s status, and
   that shipped a broken tag once.
3. Bump the version, move the CHANGELOG's `[Unreleased]` heading, add the new version to
   `minimumReleaseAgeExclude` in the dependents' `pnpm-workspace.yaml`.
4. Commit, `git tag vX.Y.Z`, push `main`, then push the tag **separately** - a lightweight tag does
   not travel with `--follow-tags`.
5. Confirm against the registry itself, `curl -s https://registry.npmjs.org/typespec-http-zod`, and
   by the release workflow's conclusion for the tagged commit, not by its colour. `npm view` answered
   the previous version for minutes after 0.29.0 and 0.30.0 were published; the registry lags the
   workflow by one to three minutes, and that is not a failure.
6. **This publish is also the pipeline's canary.** It is what proves the token, OIDC and provenance
   still work, on a version you were shipping anyway - which is why a `-rc` release usually buys
   nothing here beyond a version number that can never be reused.
7. Only then bump `typespec-hono` and release it.
8. **Prove it against the reference consumer**, which installs from npm rather than from a checkout:

   ```bash
   gh workflow run CI --repo bison-digital/typespec-hono-example
   ```

## Zod

The peer range is a correctness bound rather than a preference, and it moves when the emitted
validators' agreement with the published document depends on a Zod fix. See
[Reference](reference.md#zod-version-support). Raising it is a breaking change and takes a minor
bump, which at `0.x` is what SemVer 2.0.0 leaves as the increment for one.
