import "@typespec/http";

using TypeSpec.Http;

/**
 * **Reserved path expansion, in every form that reaches `allowReserved`.**
 *
 * A note path is `areas/health.md`, so a vault route has to match across `/`. TypeSpec states that
 * with RFC 6570's `+` operator, and the fact reaches the emitter as `allowReserved` on the resolved
 * path parameter. It reaches the OpenAPI document as nothing at all: measured at 3.0.0, 3.1.0 and
 * 3.2.0, openapi3 publishes `/vault/{path}` and raises `path-reserved-expansion` as a warning.
 *
 * **Two forms set the flag and a fixture carrying only one proves half the rule.** The operator in
 * the route template is the form a human writes. The annotation form is the one
 * `@typespec/http-specs` itself uses, and `@typespec/http` resolves it by APPENDING `{+param}` to
 * the template - so an emitter that read the template rather than the parameter would still pass on
 * the first form and quietly agree with itself.
 *
 * The non-reserved operations are load-bearing, not padding: reserved-ness is a property of a
 * PARAMETER, and a route with one of each is the only thing that catches a rule applied per
 * operation.
 */
@service(#{ title: "Reserved" })
namespace Reserved;

/** The plain case: the operator in the route template. */
@route("/vault/{+path}")
@get
op read(@path path: string): string;

/** Renamed. The wire name is what a router matches, and it is not the TypeSpec property name. */
@route("/file/{+note-path}")
@get
op readRenamed(@path("note-path") notePath: string): string;

/** Mid-position: a literal segment follows the greedy one. */
@route("/vault/{+path}/move")
@post
op move(@path path: string, @body destination: string): string;

/** One reserved and one not, in one route. */
@route("/repo/{owner}/{+ref}")
@get
op tree(@path owner: string, @path ref: string): string;

/**
 * The annotation form, on a required parameter the template does not already name.
 *
 * Naming it in the template as well is what `@typespec/http` refuses with `use-uri-template`, and
 * an optional parameter carrying the annotation is refused the same way, so neither is expressible
 * here. Both were measured rather than assumed.
 */
@route("/annotation")
@get
op annotation(@path(#{ allowReserved: true }) param: string): string;

/** The control: an ordinary path parameter, which must NOT be collected. */
@route("/plain/{id}")
@get
op plain(@path id: string): string;

/** A second control, with no path parameter at all. */
@route("/none")
@get
op none(): string;
