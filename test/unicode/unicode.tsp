import "@typespec/http";

using Http;

/**
 * Patterns whose meaning depends on the Unicode flag, which is how a JSON Schema reader compiles a
 * published `pattern`.
 */
@service(#{ title: "Unicode" })
namespace Unicode;

model Names {
  /** A Unicode property escape. Without the flag this is an identity escape for the letter `p`. */
  @pattern("^\\p{L}+$")
  letters: string;

  /** An ordinary pattern the flag REFUSES to compile, which must keep the bare form. */
  @pattern("^\\-?\\d+$")
  signed: string;

  /** Valid under both, and must behave identically either way. */
  @pattern("^[a-z]+$")
  plain: string;
}

@route("/names")
@post
op echo(@body body: Names): Names;

model Astral {
  /** Under the flag `.` matches a whole astral character; without it, a surrogate half. */
  @pattern("^.{3}$")
  three: string;
}

@route("/astral")
@post
op astral(@body body: Astral): Astral;
