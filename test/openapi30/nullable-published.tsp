import "@typespec/http";
using Http;
/**
 * Each property admits `null` where the OpenAPI 3.0 document openapi3 publishes does too: `nullable`
 * beside a `type` - see `openapi30.test.ts`.
 */
@service(#{ title: "Published" })
namespace Published;
model Inner { a: string; }
union NamedNull { string, null }
model P {
  text?: string | null;
  count?: int32 | null;
  list?: string[] | null;
  rec?: Record<string> | null;
  expr?: { a: string } | null;
  anything?: unknown | null;
  namedNull?: NamedNull;
  mixed?: Inner | string | null;
}
@route("/p") @post op p(@body body: P): P;
