import "@typespec/http";
import "@typespec/openapi3";
using Http;
@service(#{ title: "q1" }) namespace Q1;
@sharedRoute @route("/s") @get op sa(@query q: string): void;
@sharedRoute @route("/s") @get op sb(@query other?: string): void;
@sharedRoute @route("/t") @post op ta(@header h: string, @body body: { a: string }): void;
@sharedRoute @route("/t") @post op tb(@header h: int32, @body body: { b: string }): void;
