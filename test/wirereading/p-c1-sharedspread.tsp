import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "C1" })
namespace C1;

model CommonA {
  @query filter: string;
}
model CommonB {
  @query filter: string;
}
@sharedRoute @route("/x") @get op listA(...CommonA): void;
@sharedRoute @route("/x") @get op listB(...CommonB): void;
