# Shared fixtures

## `service.tsp` — shared with `typespec-hono`

This is the **origin** copy. `typespec-hono` vendors it and records the same digest.

```
sha256  d3992e858fe12df430cec64a77a1374e88eeed718d0e65538c8d406107f5f224
```

**Why the other package holds a copy rather than importing it.** This package ships no test material:
`files` carries `dist` and `lib` only, matching `@typespec/openapi3`, which excludes `dist/test/**`
explicitly. Shipping a fixture would make it de-facto public API delivered to every installer forever,
for the benefit of one sibling repository.

**Why it is shared at all.** Only because **question 3 — can an application be built on both packages,
and does it answer real requests correctly? — needs one spec that both halves serve.** Everything else
is package-specific: `constraints.tsp` and the per-construct fixtures are this package's, and the
routing, wiring and scope fixtures are the server generator's.

⚠️ **Editing this file breaks `typespec-hono` until its copy and digest are updated too.** That is the
intended behaviour and the reason the digest exists — vendoring detects drift, it does not prevent it.

Regenerate with:

```bash
shasum -a 256 test/reference/service.tsp
```
