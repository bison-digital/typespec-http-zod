import "@typespec/http";
using Http;
/**
 * Each property admits `null` where the OpenAPI 3.0 document openapi3 publishes does not, by OAS
 * 3.0.4's `nullable` - see `openapi30.test.ts`.
 */
@service(#{ title: "Refused" })
namespace Refused;
enum Color { red, green }
scalar Code extends string;
model Inner { a: string; }
union Named { string, int32 }
model R {
  inner?: Inner | null;
  color?: Color | null;
  pick?: "a" | "b" | null;
  code?: Code | null;
  pair?: string | int32 | null;
  named?: Named | null;
  bare?: null;
}
@route("/r") @post op r(@body body: R): void;
