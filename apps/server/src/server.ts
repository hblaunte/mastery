/**
 * Start the API (and, when a web build exists, the web app) on one local port. Used by main.ts
 * for `pnpm start` and by the desktop shell, which passes port 0 and reads back the port it got.
 */
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { HOST, PORT, WEB_DIST } from "./config.js";
import { app } from "./app.js";
import * as library from "./library.js";
import { serveDist } from "./static.js";
import * as store from "./store.js";

export interface RunningServer {
  port: number;
  url: string;
  /** How many legacy sources were moved into the library on this start. */
  migrated: number;
  close: () => Promise<void>;
}

export function startServer(opts: { port?: number; hostname?: string } = {}): Promise<RunningServer> {
  store.ensureDirs();
  library.ensureLibrary();
  const migrated = library.migrateLegacy();
  if (existsSync(WEB_DIST)) app.use("*", serveDist(WEB_DIST));

  const hostname = opts.hostname ?? HOST;
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port: opts.port ?? PORT, hostname }, (info: AddressInfo) => {
      resolve({
        port: info.port,
        url: `http://${hostname}:${info.port}`,
        migrated,
        close: () => new Promise<void>((done, fail) => server.close((err) => (err ? fail(err) : done()))),
      });
    });
    server.once("error", reject);
  });
}
