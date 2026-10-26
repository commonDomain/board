// Windows desktop launcher: keep the normal server entry and support graceful restarts.
const net = require('node:net');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const token = process.env.MUSEBOARD_LAUNCH_TOKEN;
delete process.env.MUSEBOARD_LAUNCH_TOKEN;
if (!token) throw new Error('Please start this server with restart-desktop.ps1.');

import(pathToFileURL(path.join(__dirname, '../backend/server/bootstrap.js')).href)
  .then(() => {
    const control = net.createServer((socket) => {
      socket.setTimeout(2000, () => socket.destroy());
      socket.unref();
      let input = '';
      socket.on('error', () => {});
      socket.on('data', (data) => {
        input += data.toString();
        if (input.length > 256) return socket.destroy();
        if (!input.includes('\n')) return;
        if (input.trim() !== `stop ${token}`) return socket.destroy();
        socket.end('ok\n');
        control.close();
        process.emit('SIGTERM');
      });
    });
    control.on('error', (error) => {
      console.error('Desktop restart control failed:', error);
      process.emit('SIGTERM');
    });
    control.listen(`\\\\.\\pipe\\museboard-desktop-${process.pid}`, () => control.unref());
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
