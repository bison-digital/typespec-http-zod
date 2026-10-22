import "@typespec/http";
using Http;
/** A sealed model extending a record, and the same record spread - see `openapi30.test.ts`. */
@service(#{ title: "Record" })
namespace RecordBase;
model Extends extends Record<string> { name: string; }
model Spreads { name: string; ...Record<string>; }
@route("/e") @post op e(@body body: Extends): void;
@route("/s") @post op s(@body body: Spreads): void;
