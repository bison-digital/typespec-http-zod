import "@typespec/http";
using Http;
@service(#{ title: "d27" })
namespace D27;

@maxValue(5) scalar Small extends int32;
model A { ...Record<Small> }
model B { k?: int32 }
model B2 { k?: int32 = 7; z?: Small }
model Root { u: B | A }
model Sub extends Root { u: B2 }

@route("/s") @post op s(@body body: Sub): void;
