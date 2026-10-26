import { global } from './state.js';

const isPhonePasskeyDevice = () =>
  /Android|iPhone|iPad|iPod/i.test(global.navigator.userAgent) ||
  (/Macintosh/i.test(global.navigator.userAgent) && global.navigator.maxTouchPoints > 1);

export { isPhonePasskeyDevice };
