import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F6" })
namespace F6;

model ThingA {
  @visibility(Lifecycle.Update) secret: string;
  name: string;
}
@route("/a1") @patch op updateA1(@body body: ThingA): void;
@route("/a2") @patch(#{ implicitOptionality: true }) op updateA2(@body body: ThingA): void;
@route("/a") @get op readA(): ThingA;
