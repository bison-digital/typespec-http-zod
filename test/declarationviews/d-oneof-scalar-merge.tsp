import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "fE" }) namespace FE;
enum Color { red, green }
@oneOf union O1 { v0: Color, v1: string }
model Root { k: utcDateTime }
model Sub extends Root { @encodedName("application/json", "k") kk: O1 }
@route("/s") @post op s(@body body: Sub): void;
