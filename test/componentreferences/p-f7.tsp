import "@typespec/http";
import "@typespec/openapi3";

using Http;

@service(#{ title: "F7" })
namespace F7;

model CatC {
  @visibility(Lifecycle.Create) secret: string;
  name: string;
}
model DogC {
  name: string;
}
@discriminated
union PetC {
  cat: CatC,
  dog: DogC,
}
@route("/c") @post op createC(@body body: PetC): void;
@route("/c") @get op readC(): PetC;
