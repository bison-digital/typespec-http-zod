import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F14" })
namespace F14;

model User {
  @visibility(Lifecycle.Read) id: string;
  @visibility(Lifecycle.Create) password: string;
  name: string;
}
@route("/users") @post op create(...User): User;
