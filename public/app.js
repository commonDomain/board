'use strict';

// Load after the classic-script adapters; each feature declares its own imports.
import('./app/bootstrap.js').catch((error) => {
  console.error('Whiteboard modules failed to load', error);
  document.getElementById('connectionText').textContent = '画板加载失败，请刷新后重试';
});
