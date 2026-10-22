import "@typespec/http";
import "@typespec/openapi3";
using Http;
using OpenAPI;
@service(#{ title: "d2z" }) namespace D2;
model IR { @visibility(Lifecycle.Read) id: string; name: string; }
model B { v: IR; }
@friendlyName("Dee") model D extends B { @visibility(Lifecycle.Create) secret: string; }
model DCreate is Create<D2.D>;
@route("/l") @post op l(@body body: DCreate): void;
