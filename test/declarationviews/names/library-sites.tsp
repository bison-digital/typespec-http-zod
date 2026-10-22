import "@typespec/http";

using Http;

/**
 * Every place the emitted files name a standard library generic, each reached beside a model of
 * that generic's own name - so a reference left bare names the spec's model, which takes no type
 * arguments, and the set does not compile.
 */
@service(#{ title: "Library sites" })
namespace LibrarySites;

model Record { a: int32; }
model Promise { p: string; }
model Readonly { r: string; }
model Exclude { e: boolean; }

model Holder {
  rec: Record;
  pr: Promise;
  ro: Readonly;
  ex: Exclude;
  // A dictionary, and a loose one: `Record<string, number>` and `Record<string, unknown>`.
  counts?: TypeSpec.Record<int32>;
  loose?: TypeSpec.Record<unknown>;
  // A member that takes any value, read kind by kind - an object among them.
  @minLength(2) anything?: string | unknown;
}

model F { x?: int32; }
model A { kind: "a"; n?: int32; }
model B { kind: "b"; m?: boolean; }

model Upload {
  file: HttpPart<File>;
  notes: HttpPart<string>[];
}

@route("/h") @post op put(@body body: Holder): Holder;
// No input at all: `Record<string, never>`.
@route("/n") @get op none(): void;
// Header records: their readers' tables are `Readonly<Record<...>>`.
@route("/r") @get op rec(@header counts?: TypeSpec.Record<int32>): void;
// A form-exploded model, gathered back under its name.
@route("/e") @get op gather(@query(#{ explode: true }) f?: F): void;
// A form-exploded union of models, read member by member.
@route("/u") @get op either(@query(#{ explode: true }) u?: A | B): void;
// A file part and a repeated part: `Promise<ArrayBuffer>` and the boxing of a lone part.
@route("/p") @post op upload(@header contentType: "multipart/form-data", @multipartBody body: Upload): void;
// A binary response, served as a stream: `ByteStream`'s `Promise`.
@route("/b") @get op download(): { @header contentType: "application/octet-stream"; @body body: bytes };
