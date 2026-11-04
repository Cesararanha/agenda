export class BadRequest extends Error {
  readonly statusCode = 400;
}
export class NotFound extends Error {
  readonly statusCode = 404;
}
