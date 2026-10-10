import "@typespec/http";

using Http;

/**
 * A media type declared with a parameter, which is a media type all the same.
 *
 * **Every comparison of a declared media type is of its essence** - `type/subtype`, lowercased, with
 * no parameters (RFC 9110 section 8.3.1). `application/json; charset=utf-8` IS JSON, and
 * `Application/JSON` is the same type. They were compared as whole strings: the body became raw text,
 * the response an unvalidated string, and the header validator, which reduced the REQUEST's value to
 * its essence and compared it with the declared text, refused every request.
 */
@service(#{ title: "Essence" })
namespace Essence;

model Thing {
  id: string;
}

/** Declared with a charset parameter, in both directions. */
@route("/charset")
@post
op withCharset(@header contentType: "application/json; charset=utf-8", @body body: Thing): {
  @header contentType: "application/json; charset=utf-8";
  @body body: Thing;
};

/** Declared in capitals. */
@route("/capitals")
@post
op inCapitals(@header contentType: "Application/JSON", @body body: Thing): void;

/** Declared plainly: the control, whose emitted validator must not change. */
@route("/plain")
@post
op plain(@header contentType: "application/json", @body body: Thing): void;
