import "@typespec/http";

using Http;

/**
 * Text naming a library type, in every place a spec writes text into the emitted files: an enum's
 * value, a literal, a pattern, a default and a query literal - beside a model of the library type's
 * own name, which the files then had to name the library's through `globalThis`.
 */
@service(#{ title: "Library literals" })
namespace LibraryLiterals;

model Record { a?: int32; }
enum E { a: "Record<int32>", b: "x" }
model M {
  e?: E;
  l?: "Promise<x>";
  @pattern("^Readonly<[a-z]+>$") p?: string;
  d?: string = "Exclude<y>";
}
@route("/a") @post op a(@body body: M, @query q?: "Record<q>"): Record;
