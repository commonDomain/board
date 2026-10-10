'use strict';

const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**', '.tmp-*/**', 'data*/**', '.qa-data/**',
      'public/vendor/**', 'public/sheet-formula.js', 'public/sheet-core.js',
      'public/sheet-editor.js', 'public/sheet-view.js', 'public/sheet-xlsx.js', 'public/brush-engine.js',
      'public/account.js', 'public/notes-workspace.js', 'docs/**', 'design-system/**'
    ]
  },
  {
    files: ['backend/**/*.js', 'frontend/**/*.js', 'public/**/*.js', 'scripts/**/*.{js,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.node, ...globals.browser, ...globals.worker,
        PerfectFreehand: 'readonly', WhiteboardBrushEngine: 'readonly',
        SheetCore: 'readonly', SheetFormula: 'readonly', SheetView: 'readonly',
        SheetXlsx: 'readonly', FFlate: 'readonly', Saxes: 'readonly',
        WhiteboardMindMapLayout: 'readonly', WhiteboardXmindParser: 'readonly',
        ConnectorCore: 'readonly', ConnectorRouter: 'readonly'
      }
    },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error'
    }
  }
];
