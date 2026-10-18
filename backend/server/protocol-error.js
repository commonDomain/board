class ProtocolError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    this.closeCode = options.closeCode;
    this.image = options.image;
  }
}

export { ProtocolError };
