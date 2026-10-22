import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F8" })
namespace F8;

model InnerJ {
  @visibility(Lifecycle.Read) id: string;
  name: string;
}
@route("/j") @post op createJ(
  @multipartBody body: {
    plain: HttpPart<InnerJ>;
  },
): void;
@route("/j") @get op readJ(): InnerJ;
