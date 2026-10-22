import "@typespec/http";

using Http;

/**
 * A service that declares its models first and its interfaces after them, as a spec split across
 * files commonly does, with one model no operation reaches.
 */
@service
namespace Shop;

model Widget {
  id: string;
  gadget_id: string;
}

model Gadget {
  id: string;
  label: string;
}

/** Reached by no operation, so declared from openapi3's walk of the namespace. */
model Shelf {
  widgets: Widget[];
}

@error
model NotFound {
  @statusCode _: 404;
  message: string;
}

@route("/status")
interface Status {
  @get read(): {
    @statusCode _: 200;
    ok: boolean;
  };
}

@route("/widgets")
interface Widgets {
  @get read(@path id: string): Widget | NotFound;
  @post create(@body body: Widget): Widget;
}

@route("/gadgets")
interface Gadgets {
  @get read(@path id: string): Gadget | NotFound;
}
