import "@typespec/http";
import "@typespec/openapi3";

using Http;
using OpenAPI;

@service(#{ title: "C2" })
namespace C2;

@TypeSpec.OpenAPI.useRef("https://example.com/ext.json")
model Ext {
  a: string;
}
model Holder {
  ext: Ext;
}
@route("/x") @get op read(): Holder;
