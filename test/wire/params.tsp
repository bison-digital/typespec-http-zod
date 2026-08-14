import "@typespec/http";

using Http;

/**
 * Every shape a numeric or boolean parameter can take, because a path, query or header value is
 * always a string on the wire and each of these has to be decoded before the document's schema runs.
 *
 * The shapes matter individually: the decision used to be made by inspecting the emitted Zod text, so
 * a shape that did not begin `z.number()` silently lost its decoder while the document and the
 * validator went on agreeing that the parameter was a number.
 */
@service(#{ title: "wire parameters" })
namespace WireParams;

model Page {
  total: int32;
}

@minValue(1)
scalar PetId extends int32;

@route("/plain/{id}")
@get
op plain(@path id: int32, @query limit: int32, @query verbose: boolean): Page;

/** A named scalar carrying its own constraint. */
@route("/named/{petId}")
@get
op named(@path petId: PetId): Page;

/** A union of numeric literals: a size drawn from a fixed set. */
@route("/literals")
@get
op literals(@query size: 10 | 25 | 50): Page;

/** A union of boolean literals, which reduces to one value. */
@route("/boolliteral")
@get
op boolLiteral(@query only: true): Page;

/** Optional and nullable, which wrap the type without changing what arrives. */
@route("/optional")
@get
op optionalNumeric(@query offset?: int32, @query ratio?: float32 | null): Page;

/** A list of numbers, flattened into one value and split before the elements are decoded. */
@route("/list")
@get
op list(
  @query(#{ explode: false })
  ids: int32[],
): Page;

/** A string parameter, so the arm is not measuring a rule applied to everything. */
@route("/text")
@get
op text(@query name: string): Page;
