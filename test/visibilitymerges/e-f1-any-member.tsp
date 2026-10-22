import "@typespec/http";

using Http;

@service(#{ title: "F1" })
namespace F1;

model M { @maxLength(2) k?: string | unknown; }

@route("/q")
@get
op q(
  @query @maxLength(2) a?: string | unknown,
  @query @minLength(3) b?: string | unknown,
  @header @maxLength(2) h?: string | unknown,
  @cookie @maxLength(2) c?: string | unknown,
  @query m?: M,
  @query(#{ explode: true }) x?: M,
): void;

@route("/f")
@post
op f(@header contentType: "application/x-www-form-urlencoded", @body body: M): void;
scalar Anything;
@route("/p/{p}") @get op pp(@path @maxLength(2) p: string | unknown): void;
@route("/d/{d}") @get op dd(@path @maxLength(2) d: string | Anything): void;
