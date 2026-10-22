import "@typespec/http";
using Http;

@service(#{ title: "Repro" })
namespace Repro;

// F1: a form-exploded query union of models
model A { kind: "a"; x: string; }
model B { kind: "b"; y: string; }
model Cat { kind: "cat"; lives: int32; }
model Dog { kind: "dog"; good: boolean; }
@discriminated(#{ envelope: "none" }) union Pet { cat: Cat, dog: Dog }
@route("/f1") @get op f1(@query(#{ explode: true }) p?: A | B): void;
@route("/f1b") @get op f1b(@query(#{ explode: true }) p?: Pet): void;
@route("/f1c") @get op f1c(@query(#{ explode: true }) p: A | B): void;

// F2: a value inside an object whose type is a union holding a list
model L { e?: int32 | int32[]; }
@route("/f2") @get op f2(@query(#{ explode: true }) l?: L): void;
@route("/f2b") @get op f2b(@query(#{ explode: true }) r?: Record<int32[] | null>): void;
@route("/f2c") @get op f2c(@header r?: Record<int32[] | null>): void;

// F3: the gatherer claims a property invisible at the operation
model G { @visibility(Lifecycle.Create) secret?: string; a?: int32; }
@route("/f3") @get op f3(@query(#{ explode: true }) g?: G): void;

// F4/F5: multipart
model Address { city: string; }
model Parts { iad?: HttpPart<int32 | Address>; many?: HttpPart<int32>[]; }
@route("/f4") @post op f4(@header contentType: "multipart/form-data", @multipartBody body: Parts): void;

// F6: a record key __proto__
@route("/f6") @get op f6(@query r?: Record<boolean>, @header h?: Record<boolean>): void;
@route("/f6b") @post op f6b(@body body: Record<boolean>): void;

// F7: a default the validator's own check refuses
model D {
  @encode(DateTimeKnownEncoding.unixTimestamp, int32) big?: utcDateTime = utcDateTime.fromISO("2100-01-01T00:00:00Z");
  pd?: plainDate = plainDate.fromISO("2020-02-30");
  u?: url = "not a url";
}
@route("/f7") @post op f7(@body body: D): void;

// F8: one header declared twice, in two cases
@route("/f8") @get op f8(@header("x-foo") a?: int32, @header("X-Foo") b?: string): void;

// F10: a discriminated base as a header
@discriminator("kind") model Snake { kind: string; }
model Cobra extends Snake { kind: "cobra"; length: int32; }
@route("/f10") @get op f10(@header s?: Snake): void;
