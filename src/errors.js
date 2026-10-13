// An error that carries an HTTP status and a stable machine-readable code.
// The mini app translates the code into the user's language; the message is only a fallback.
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const bad = (message, code) => new HttpError(400, message, code);

module.exports = { HttpError, bad };
