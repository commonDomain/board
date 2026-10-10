'use strict';

// Keep the CLI entry stable while the application is composed from feature modules.
import('./server/bootstrap.js').catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
