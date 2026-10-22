import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "N4" })
namespace N4;

model Thing { @visibility(Lifecycle.Create) c: string; name: string; }
model ThingCreate { other: int32; }
@route("/x") @get op read(): Thing;
@route("/x") @post op create(@body body: Thing): void;
@route("/y") @get op readTC(): ThingCreate;
