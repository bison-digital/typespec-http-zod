import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "r13" })
namespace R13;
model Bag { @header h?: string; ...Record<int32> }
model Bag2 { @visibility(Lifecycle.Create) secret?: string; ...Record<unknown> }
@route("/a") @get op read(): Bag;
@route("/b") @get op read2(): Bag2;
