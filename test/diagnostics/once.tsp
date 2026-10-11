import "@typespec/http";

using Http;

/**
 * One status range OpenAPI cannot key, and so one `unsupported-status-code-range`.
 *
 * **A diagnostic is raised once per cause, however many walks read the cause.** The route walk and
 * the contract walk each resolved the operation's responses, and the resolution reports the range,
 * so with contracts emitted the same error was raised twice at the same location.
 */
@service(#{ title: "Once" })
namespace Once;

model Problem {
  @minValue(400)
  @maxValue(450)
  @statusCode
  statusCode: int32;

  message: string;
}

@route("/thing") @get op readThing(): { id: string } | Problem;
