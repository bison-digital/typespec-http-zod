import "@typespec/http";

using Http;

@service(#{ title: "F3" })
namespace F3;

model L {
  ll?: int32[] | string[];
  lb?: int32[] | boolean;
}

@route("/x") @get op x(@query(#{ explode: true }) f?: L): void;
@route("/r") @get op r(@query(#{ explode: true }) f?: Record<int32[] | string[]>): void;
@route("/fl") @post op fl(@header contentType: "application/x-www-form-urlencoded", @body body: L): void;
