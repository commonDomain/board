import { state } from './state.js';

function nextZ() {
  state.zCounter += 1;
  return state.zCounter;
}

function waitForBoardJoin(boardId, timeout = 6000) {
  if (state.boardId === boardId && state.joined) return Promise.resolve(true);
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (state.boardId === boardId && state.joined) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started >= timeout) {
        clearInterval(timer);
        resolve(false);
      }
    }, 50);
  });
}
export { nextZ, waitForBoardJoin };
