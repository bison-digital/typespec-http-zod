import "@typespec/http";
import "@typespec/openapi3";
using Http;
@service(#{ title: "v3" }) namespace V3;
model IR { @visibility(Lifecycle.Read) id: string; name: string; }
union U { a: IR, b: string }
model W { v: U.a }
@route("/w") @patch(#{ implicitOptionality: true }) op upd(@body body: W): void;
@route("/i") @get op get(): IR;
