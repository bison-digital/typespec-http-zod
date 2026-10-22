import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "fA" }) namespace FA;
@oneOf union O8 { v0: "x" | null, v1: "y" }
model Root { c: string }
model L extends Root { @encodedName("application/json", "c") cc: O8 }
@route("/l") @post op l(@body body: L): void;
