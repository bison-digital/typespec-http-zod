import "@typespec/http";
import "@typespec/versioning";

using Http;
using Versioning;

/**
 * **One declaration, reached through every copy the compiler makes of it.** `model B is A` copies
 * `A`'s properties, a spread copies the spread model's into each operation, and each versioning
 * projection clones the whole service - once per emitter that asks for it. Each diagnostic below is
 * reported once, at the source. See `reportonce.test.ts`.
 */
@versioned(Versions)
@service(#{ title: "Report once" })
namespace ReportOnce;

enum Versions {
  v1,
  v2,
}

model Filter {
  a: int32;
}

model A {
  @encode("x", string) filter: Filter;
  @encode(string) @minValue(1) count: int32;
}

model B is A;

model Params {
  @query @encode("x", string) q: Filter;
}

@route("/a") @post op one(@body body: A): void;
@route("/b") @post op two(@body body: B): void;
@route("/p") @get op three(...Params): void;
@route("/q") @get op four(...Params): void;

@error
model Gone {
  @statusCode _: 410;
  @body body: never;
}

@route("/g") @get op five(): void | Gone;
@route("/h") @get op six(): void | Gone;
