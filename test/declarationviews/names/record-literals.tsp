import "@typespec/http";

using Http;

@service(#{ title: "Record literals" })
namespace RecordLiterals;

model Record { a?: int32; }

/** Holds a Record<string> of things */
model M {
  k?: "Record<k>";
  @pattern("^Record<[a-z]+>$") p?: string;
  d?: string = "Record<d>";
}
@route("/a") @post op a(@body body: M): Record;
