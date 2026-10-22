import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F12" })
namespace F12;

model ThingC {
  @visibility(Lifecycle.Create) c: string;
  @visibility(Lifecycle.Update) u: string;
  name: string;
}
@sharedRoute @route("/c") @post @parameterVisibility(Lifecycle.Create) op createC(@body body: ThingC): void;
@sharedRoute @route("/c") @post @parameterVisibility(Lifecycle.Update) op updateC(@header h: string, @body body: ThingC): void;
