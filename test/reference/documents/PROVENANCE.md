# Reference documents

Published OpenAPI documents, vendored so the round-trip suite is hermetic. A suite that fetches these
at run time decides whether it passes using a value it did not supply, and then fails for reasons that
have nothing to do with the code under test.

⚠️ **Every digest below is ASSERTED by `test/vendored.test.ts`, over every file in this directory as
a class.** The version of this record inherited from the un-split package documented digests that
nothing checked — and one of them had never matched the file it described, from the commit that
introduced it. A provenance record whose digests are not verified is prose claiming to be a guard.

| file | source | retrieved | sha256 |
| --- | --- | --- | --- |
| `oai-petstore.yaml` | <https://raw.githubusercontent.com/OAI/learn.openapis.org/main/examples/v3.0/petstore.yaml> — the OpenAPI Initiative's own teaching example | 2026-08-10 | `cefaafa05eee75b1888762dea08a295f245e9f3e4bdb8777f4bdfed09e335339` |
| `swagger-petstore.json` | <https://petstore3.swagger.io/api/v3/openapi.json> — the canonical Swagger Petstore, the most widely implemented reference API there is | 2026-08-10 | `b5e9a5da3d7a7491958099627bc976db0ec42f2464da3b46b178ab06e3da38b5` |

## Why these two

They are **not** written to exercise an emitter, which is exactly their value.
`@typespec/http-specs` is a corpus of scenarios built to break emitters, and `constraints.tsp` and
`service.tsp` are ours; all three encode what somebody already thought to test. These are APIs
somebody sat down and designed, and the only question they ask is whether this emitter can serve a
surface it had no hand in.

`swagger-petstore` earns its place immediately: it is the reference API most implementations are
first pointed at, and it carries form bodies, API-key and OAuth2 security, enums, arrays of models and
no-content responses in one small document.

## Refreshing one

A deliberate commit: re-download, read the diff, and update the digest here. The suite will fail until
you do, which is the point.

```bash
shasum -a 256 test/reference/documents/*.yaml test/reference/documents/*.json
```
