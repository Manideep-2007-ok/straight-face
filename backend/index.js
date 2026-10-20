import http from 'node:http';
import { parseConfig } from './config/index.js';
import { connectDb, disconnectDb } from './db/connect.js';
import { createApp } from './app.js';
import { RoomRegistry } from './state/roomRegistry.js';
import { attachSockets } from './sockets/index.js';

const config = parseConfig();
const registry = new RoomRegistry(4);
const app = createApp(config, registry);
const server = http.createServer(app);
const { closeAll } = attachSockets(server, config, registry);

await connectDb(config.dbURL, config.DB_NAME);
server.listen(config.PORT, () => console.log(`API listening on :${config.PORT}`));

const shutdown = async () => {
  server.close();
  await closeAll();
  await disconnectDb();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
