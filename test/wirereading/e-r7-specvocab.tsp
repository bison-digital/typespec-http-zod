import "@typespec/http";

using Http;

@service(#{ title: "R7" })
namespace R7;

enum Color { red, blue }

model SPEC_VOCABULARIES { c: Color; }

@route("/w") @get op read(): SPEC_VOCABULARIES;
