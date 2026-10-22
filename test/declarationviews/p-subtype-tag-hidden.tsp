import "@typespec/http";
import "@typespec/openapi3";
using Http;
@service(#{ title: "p5" }) namespace P5;
@discriminator("kind") model Pet { kind: string; name: string; }
model Cat extends Pet { @visibility(Lifecycle.Read) kind: "cat"; meow?: string; }
model Dog extends Pet { kind: "dog"; }
model Outer { @visibility(Lifecycle.Create) secret: string; cat: Cat; }
@route("/o") @post op create(@body body: Outer): void;
@route("/c") @get op get(): Cat;
