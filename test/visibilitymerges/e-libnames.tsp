import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "LibNames" })
namespace LibNames;

/** Models named after the standard library types the emitted files name for themselves. */
model Record { a: int32; }
model Promise { p: string; }
model Readonly { r: string; }
model Exclude { e: boolean; }
model ArrayBuffer { b: string; }
model Uint8Array { u: int32; }

model Holder {
  rec: Record;
  pr: Promise;
  ro: Readonly;
  ex: Exclude;
  ab: ArrayBuffer;
  ua: Uint8Array;
}

model Upload {
  file: HttpPart<File>;
  note?: HttpPart<string>;
}

@route("/h") @post op put(@body body: Holder): Holder;
// No input at all: its handler input is the library's `Record<string, never>`.
@route("/n") @get op none(): void;
// A header record: its reader's tables are the library's `Readonly<Record<...>>`.
@route("/r") @get op rec(@header counts?: TypeSpec.Record<int32>): void;
// A file part: `arrayBuffer: () => Promise<ArrayBuffer>`, the library's.
@route("/u") @post op upload(@header contentType: "multipart/form-data", @multipartBody body: Upload): void;
