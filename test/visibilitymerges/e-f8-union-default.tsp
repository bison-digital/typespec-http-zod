import "@typespec/http";

using Http;

@service(#{ title: "F8" })
namespace F8;

model Cat { kind: "cat"; }
model Dog { kind: "dog"; }

model D {
  a?: Cat | Dog = #{ kind: "dog" };
}

@route("/b") @post op b(@body body: D): void;
