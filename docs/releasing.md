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

## The sequence

1. Rehearse with both packages at their release versions.
2. Four gates here, **by exit code** - `pnpm test`, `pnpm typecheck`, `pnpm lint`,
   `pnpm format:check`. Never through a pipe: `pnpm typecheck | tail` reports `tail`'s status, and
   that shipped a broken tag once.
3. Bump the version, move the CHANGELOG's `[Unreleased]` heading, add the new version to
   `minimumReleaseAgeExclude` in the dependents' `pnpm-workspace.yaml`.
4. Commit, `git tag vX.Y.Z`, push `main`, then push the tag **separately** - a lightweight tag does
   not travel with `--follow-tags`.
5. Confirm by `npm view typespec-http-zod version`, not by the workflow's colour. The registry lags
   the workflow by about a minute; that is not a failure.
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
