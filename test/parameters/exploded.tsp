import "@typespec/http";

using Http;

/**
 * Exploded array parameters, beside the shapes the fix must NOT touch.
 *
 * RFC 6570 explode sends one `key=value` pair per member, so a one-member list is a single pair -
 * and `zValidator` hands a single occurrence over as a bare string, an array only for repeats. The
 * emitted validator has to box the lone string; a delimited list and a plain scalar are the
 * controls proving the boxing reaches only the exploded case.
 */
@service(#{ title: "parameters" })
namespace Parameters;

@route("/search") @get op search(
  /** The defect's shape: `?topics=a` must validate as `["a"]`. */
  @query(#{ name: "topics", explode: true })
  topics?: string[],

  /** Control: a delimited list stays on the split path. */
  @query joined?: string[],

  /** Control: a scalar must NOT be boxed. */
  @query q?: string,
): void;
