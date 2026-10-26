function isWebpBuffer(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 20 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP' &&
    buffer.readUInt32LE(4) + 8 <= buffer.length &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.subarray(12, 16).toString('ascii'))
  );
}

export { isWebpBuffer };
