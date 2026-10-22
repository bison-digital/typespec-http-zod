import "@typespec/http";

using Http;

@service(#{ title: "Banner" })
namespace Banner;

model Thing {
  id: string;
}

@route("/things")
@get
op list(): Thing[];
