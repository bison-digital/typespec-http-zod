import "@typespec/http";

using Http;

/** Declarations TypeScript refuses the name of: predefined types and strict-mode reserved words. */
@service(#{ title: "Refused names" })
namespace RefusedNames;
model `any` { a?: int32; }
model `unknown` { a?: int32; }
model `never` { a?: int32; }
model `undefined` { a?: int32; }
model `string` { a?: int32; }
model `number` { a?: int32; }
model `boolean` { a?: int32; }
model `bigint` { a?: int32; }
model `symbol` { a?: int32; }
model `object` { a?: int32; }
model `interface` { a?: int32; }
model `implements` { a?: int32; }
model `let` { a?: int32; }
model `package` { a?: int32; }
model `private` { a?: int32; }
model `protected` { a?: int32; }
model `public` { a?: int32; }
model `static` { a?: int32; }
model All { p0?: `any`; p1?: `unknown`; p2?: `never`; p3?: `undefined`; p4?: `string`; p5?: `number`; p6?: `boolean`; p7?: `bigint`; p8?: `symbol`; p9?: `object`; p10?: `interface`; p11?: `implements`; p12?: `let`; p13?: `package`; p14?: `private`; p15?: `protected`; p16?: `public`; p17?: `static`; }
@route("/a") @post op a(@body body: All): All;
