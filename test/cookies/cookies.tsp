import "@typespec/http";

using Http;

/**
 * Cookie parameters, which this emitter dropped silently until 0.27.
 *
 * **`@typespec/http-specs` contains no `@cookie` at all**, which is how the omission survived every
 * conformance oracle: the differential compares emitted validators against the published document
 * for every parameter location the corpus exercises, and it exercises three of the four.
 */
@service(#{ title: "Cookies" })
namespace Cookies;

@route("/session")
interface Sessions {
  @get read(@cookie session: string): { @statusCode statusCode: 200; @body body: { ok: boolean } };

  @route("/maybe")
  @get
  maybe(@cookie trace?: string): { @statusCode statusCode: 200; @body body: { ok: boolean } };

  /** A constrained cookie, so the constraint pipeline is exercised in this location too. */
  @route("/typed")
  @get
  typed(
    @cookie count: int32,
    @cookie @minLength(3) name: string,
  ): { @statusCode statusCode: 200; @body body: { ok: boolean } };
}
