import "@typespec/http";
using Http;
@service(#{ title: "d26" })
namespace D26;

model Tag { name: string; v?: int32 }
model Tag2 { name: string; w?: int32 }
model Tags is Tag[];
model R0 { t: Tags }
model R1 extends R0 { t: Tag2[] }
model R2 { t: Tag[] }
model R3 extends R2 { t: Tags2 }
model Tags2 is Tag2[];
@route("/a") @patch(#{ implicitOptionality: true }) op pa(@body body: R1): void;
@route("/b") @patch(#{ implicitOptionality: true }) op pb(@body body: R3): void;
@route("/c") @post op pc(@body body: R1): void;
