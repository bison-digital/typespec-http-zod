import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F11" })
namespace F11;

model ListD<T> is T[];
model ItemD {
  name: string;
}
model HolderD {
  items: ListD<ItemD>;
}
@route("/d") @get op readD(): HolderD;
