/**
 * The desktop shell. It runs the same server as `pnpm start` inside the app, on a random local
 * port with a per-launch token, points it at the OS's per-user application folder, and opens
 * the web app in a window. Nothing about the product lives here: grading, building and the
 * library are the server's; the interface is the web app's.
 */
import { BrowserWindow, app, dialog, nativeTheme, session, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { installMenu } from "./menu.js";

type ServerModule = { startServer: (opts: { port?: number }) => Promise<{ port: number; url: string; close: () => Promise<void> }> };

const userData = app.getPath("userData");
const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "resources");
const logFile = path.join(userData, "logs", "mastery.log");

function log(...parts: unknown[]): void {
  const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack ?? p.message : typeof p === "string" ? p : JSON.stringify(p))).join(" ")}\n`;
  try { mkdirSync(path.dirname(logFile), { recursive: true }); appendFileSync(logFile, line); } catch { /* logging never fails the app */ }
  process.stdout.write(line);
}

/** Prompts are editable in Settings, so they live in user data; the bundle only seeds them. */
function seedPrompts(from: string, to: string): string {
  mkdirSync(to, { recursive: true });
  if (existsSync(from)) for (const name of readdirSync(from)) if (name.endsWith(".md") && !existsSync(path.join(to, name))) copyFileSync(path.join(from, name), path.join(to, name));
  return to;
}

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let server: Awaited<ReturnType<ServerModule["startServer"]>> | null = null;

async function boot(): Promise<void> {
  const token = randomBytes(24).toString("hex");
  process.env.MASTERY_DATA_DIR = path.join(userData, "data");
  process.env.MASTERY_PROMPTS_DIR = seedPrompts(path.join(resources, "prompts"), path.join(userData, "prompts"));
  process.env.MASTERY_WEB_DIST = path.join(resources, "web");
  process.env.MASTERY_PORT = "0";
  process.env.MASTERY_TOKEN = token;
  // Console output from the server goes to the log file too.
  console.log = (...a: unknown[]) => log(...a);
  console.error = (...a: unknown[]) => log("ERROR", ...a);

  const mod = (await import(pathToFileURL(path.join(resources, "server", "server.mjs")).href)) as ServerModule;
  server = await mod.startServer({ port: 0 });
  log(`server up at ${server.url}; data in ${process.env.MASTERY_DATA_DIR}`);

  // Only this window carries the token, so only this window can call the API.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${server.url}/*`] }, (details, callback) => {
    details.requestHeaders["x-mastery-token"] = token;
    callback({ requestHeaders: details.requestHeaders });
  });

  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 720, minHeight: 560,
    title: "Mastery",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0c0f14" : "#f3f1ec",
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => { win = null; });
  // Links leave for the default browser; the window itself stays on the local server.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) void shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(server!.url)) { e.preventDefault(); if (/^https?:/.test(url)) void shell.openExternal(url); } });
  installMenu({ dataDir: process.env.MASTERY_DATA_DIR, logFile, checkForUpdates: () => checkForUpdates(true) });
  await win.loadURL(server.url + "/");

  const smoke = process.env.MASTERY_SMOKE;
  if (smoke) {
    await new Promise((r) => setTimeout(r, 2500));
    const image = await win.webContents.capturePage();
    mkdirSync(path.dirname(path.resolve(smoke)), { recursive: true });
    writeFileSync(path.resolve(smoke), image.toPNG());
    log(`smoke: wrote ${path.resolve(smoke)} (${image.getSize().width}×${image.getSize().height}); title "${win.getTitle()}"`);
    app.quit();
    return;
  }
  if (app.isPackaged) checkForUpdates(false);
}

function checkForUpdates(fromMenu: boolean): void {
  autoUpdater.logger = { info: (m) => log("updater", m), warn: (m) => log("updater", m), error: (m) => log("updater", m), debug: () => {} };
  autoUpdater.autoDownload = true;
  autoUpdater.on("update-downloaded", (info) => {
    void dialog.showMessageBox({ type: "info", message: `Mastery ${info.version} is ready`, detail: "It installs the next time you quit.", buttons: ["Restart now", "Later"], defaultId: 1 })
      .then((r) => { if (r.response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.checkForUpdates().then((r) => {
    if (fromMenu && (!r || r.updateInfo.version === app.getVersion())) void dialog.showMessageBox({ type: "info", message: "You have the latest version.", detail: `Mastery ${app.getVersion()}` });
  }).catch((err: unknown) => {
    // Unsigned builds cannot self-update on macOS; the download page still can.
    log("updater", err instanceof Error ? err.message : String(err));
    if (fromMenu) void dialog.showMessageBox({ type: "info", message: "Could not check for updates", detail: "Download the latest version from the Mastery releases page." });
  });
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("activate", () => { if (!win && server) void boot(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { void server?.close(); });

app.whenReady().then(boot).catch((err: unknown) => {
  log("fatal", err);
  dialog.showErrorBox("Mastery could not start", `${err instanceof Error ? err.message : String(err)}\n\nSee ${logFile}`);
  app.quit();
});
