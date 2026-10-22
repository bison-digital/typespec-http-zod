import "@typespec/http";

using Http;

/**
 * The facts `EmittedService` publishes for a server emitter and writes into no file of its own:
 * which operation each route came from, and the `accept` literal a negotiated operation is chosen
 * by. Graded here as well as by the emitters that read them, so a change to either is seen in the
 * package that owns it.
 */
@service(#{ title: "Emitted" })
namespace Emitted;

model Report {
  text: string;
}

/** A model only ever SENT, so only the response side pairs it with its validator. */
model Receipt {
  id: string;
  issuedAt: string;
}

/** Two operations on one route, chosen by `accept`. */
@sharedRoute
@route("/report")
@get
op reportAsText(@header accept: "text/plain"): {
  @header contentType: "text/plain";
  @body body: string;
};

@sharedRoute
@route("/report")
@get
op reportAsJson(@header accept: "application/json"): Report;

/** An `accept` literal on a route nothing shares: validated as a header, not selected by. */
@route("/status") @get op status(@header accept: "application/json"): Report;

@route("/receipts") @post op issue(): Receipt;
