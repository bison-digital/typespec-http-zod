import "@typespec/http";

using Http;

@service(#{ title: "F6" })
namespace F6;

scalar uint8 extends string;
scalar duration extends int32;
scalar bytes extends int32;
model Record { a: int32; }
model File { name: string; }

model M { u?: uint8; d?: duration; b?: bytes; r?: Record; }
model Form { f: HttpPart<File>; }

@route("/m") @post op m(@body body: M): void;
@route("/p") @post op p(@header contentType: "multipart/form-data", @multipartBody body: Form): void;
