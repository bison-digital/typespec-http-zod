import "@typespec/http";

using Http;

/**
 * One operation per way a request body can reach a handler's input, and each kind of operation
 * `WireInputs` used to leave out.
 *
 * **The contract's input is what a handler receives, so it follows the body placement the server
 * emitters follow.** A model body is merged into the parameters; a body the merge cannot express -
 * an indexer, an absent-able body, a scalar, enum or union - is NAMED under its parameter's name; a
 * `bytes` body is handed over unread. `WireInputs` used to merge every one of them, so for each
 * named body it described an input no handler is given, and it left out an operation that takes no
 * input at all.
 */
@service(#{ title: "Inputs" })
namespace Inputs;

model Thing {
  id: string;
}

model Fixed {
  kind: "fixed";
  amount: string;
}

model Floating {
  kind: "floating";
  coversAll: boolean;
}

union Charge {
  fixed: Fixed,
  floating: Floating,
}

model Event {
  type: string;
  ...Record<unknown>;
}

model AuthorizationRequest {
  scope?: string;
}

enum Colour {
  red,
  green,
}

/** Parameters only: merged. */
@route("/things/{id}") @get op readThing(@path id: string): Thing;

/** A model body: merged, as it always was. */
@route("/things") @post op createThing(@body body: Thing): Thing;

/** No input at all, and no success body: the operation `WireInputs` and `WireOutputs` both dropped. */
@route("/pending") @delete op cancelPending(): void;

/** A union body: named. */
@route("/things/{id}/charges") @post op createCharge(@path id: string, @body body: Charge): Thing;

/** An optional body: named, and optional. */
@route("/authorize") @post op authorize(@body body?: AuthorizationRequest): void;

/** An array body: named, because an array is a model with an indexer. */
@route("/events") @post op ingestEvents(@body body: Event[]): void;

/** A model spreading an indexer: named, for the same reason. */
@route("/event") @post op ingestEvent(@body body: Event): void;

/** An enum body under its own parameter name: named, as `colour`. */
@route("/colour") @put op setColour(@body colour: Colour): void;

/** A text scalar body: named, as `note`. */
@route("/note") @put op setNote(@header contentType: "text/plain", @body note: string): void;

/** A binary `bytes` body: handed over unread, as a stream. */
@route("/upload") @post op upload(
  @header contentType: "application/octet-stream",
  @body body: bytes,
): void;

/** A `bytes` body under JSON: handed over unread, as the text a signature covers. */
@route("/signed") @post op signed(@header contentType: "application/json", @body payload: bytes): void;

/** An optional multipart body: named, and optional. */
@route("/form") @post op submitForm(
  @header contentType: "multipart/form-data",
  @multipartBody body?: {
    title: HttpPart<string>;
  },
): void;

/** A success declared only as a `2XX` range: `WireInputs` skipped every operation without an exact one. */
@route("/ranged") @get op ranged(@query q: string): {
  @minValue(200) @maxValue(299) @statusCode code: int32;
  @body body: Thing;
};

/** An `Http.File` body: handed over unread, with the media type it was sent as. */
@route("/file") @post op uploadFile(@bodyRoot file: Http.File<"image/png" | "image/jpeg">): void;

/**
 * A model under a media type no server can parse it from: handed over as the text that arrived.
 * Nothing derives an XML serialisation from the document, so the handler parses it - the response
 * side already asks a handler for the text of a model served as XML.
 */
@route("/xml") @put op putXml(@header contentType: "application/xml", @body body: Thing): void;

/** Models named only under XML, in both directions: still declared, as the document declares them. */
model XmlRequest {
  note: string;
}

model XmlResponse {
  echo: string;
}

@route("/xml-only") @put op putXmlOnly(@header contentType: "application/xml", @body body: XmlRequest): {
  @header contentType: "application/xml";
  @body body: XmlResponse;
};

model Renaming {
  name: string;
}

model Widget {
  @visibility(Lifecycle.Read) id: string;
  label: string;
}

/**
 * A body key equal to a parameter's name: named, because merged one value would replace the other.
 * The path's `name` was lost, and the handler was given the body's under the path's name.
 */
@route("/renames/{name}") @put op rename(@path name: string, @body body: Renaming): void;

/**
 * The same names, but the body's `id` is read-only, so the body SENT has no `id` and nothing
 * collides: merged.
 */
@route("/widgets/{id}") @put op replaceWidget(@path id: string, @body body: Widget): void;

/** A delimited query list: a style of flattening, not a type - the handler receives the list. */
@route("/colours") @get op listColours(@query @encode(ArrayEncoding.pipeDelimited) colors: string[]): void;
