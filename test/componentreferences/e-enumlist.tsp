import "@typespec/http";
using Http;
@service(#{ title: "enumlist" })
namespace EnumList;

/** Published as a component, though the list holding it is published as the text it encodes. */
enum Colors {
  blue,
  red,
  green,
}
model Painted {
  @encode(ArrayEncoding.commaDelimited) value: Colors[];
}
@route("/p") @post op paint(@body body: Painted): void;
