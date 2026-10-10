const boards = new Map();

const clients = new Set();

const boardCacheStats = { hits: 0, misses: 0, evictions: 0 };

export { boardCacheStats, boards, clients };
