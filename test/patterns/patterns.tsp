import "@typespec/http";

using Http;

/**
 * **A `@pattern` carrying a forward slash, in both spellings an author writes.**
 *
 * Measured before this fixture existed: not one `@pattern` in this repository contained a
 * forward slash, escaped or bare, and neither does any of the 67 specs in
 * `@typespec/http-specs`. So the emitter's own slash handling had never been exercised by
 * anything, and it was wrong.
 */
@service(#{ title: "Patterns" })
namespace Patterns;

model Routes {
  /** The spelling you get copying a regex out of JavaScript, where the slash is already escaped. */
  @pattern("^\\/api\\/v[0-9]+$")
  escaped: string;

  /** The same expression with bare slashes, which TypeSpec accepts just as readily. */
  @pattern("^/api/v[0-9]+$")
  bare: string;

  /** A backslash immediately before a slash: the backslash is literal and the slash is not escaped. */
  @pattern("^a\\\\/b$")
  literalBackslash: string;

  /** No slash at all, so the arms below are not all the same case. */
  @pattern("^[a-z]+$")
  plain: string;
}

@route("/routes") @post op check(@body body: Routes): void;
