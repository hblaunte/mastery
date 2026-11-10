import { Menu, app, shell, type MenuItemConstructorOptions } from "electron";

const RELEASES = "https://github.com/hblaunte/mastery/releases";
const ISSUES = "https://github.com/hblaunte/mastery/issues";

export function installMenu(o: { dataDir: string; logFile: string; checkForUpdates: () => void }): void {
  const mac = process.platform === "darwin";
  const appMenu: MenuItemConstructorOptions = {
    label: app.name,
    submenu: [
      { role: "about" },
      { label: "Check for updates…", click: o.checkForUpdates },
      { type: "separator" },
      ...(mac ? [{ role: "services" } as MenuItemConstructorOptions, { type: "separator" } as MenuItemConstructorOptions, { role: "hide" } as MenuItemConstructorOptions, { role: "hideOthers" } as MenuItemConstructorOptions, { role: "unhide" } as MenuItemConstructorOptions, { type: "separator" } as MenuItemConstructorOptions] : []),
      { role: "quit" },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [appMenu] : []),
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Show my data folder", click: () => void shell.openPath(o.dataDir) },
        { label: "Show log file", click: () => shell.showItemInFolder(o.logFile) },
        { type: "separator" },
        { label: "Releases", click: () => void shell.openExternal(RELEASES) },
        { label: "Report a problem", click: () => void shell.openExternal(ISSUES) },
        ...(mac ? [] : [{ type: "separator" } as MenuItemConstructorOptions, { label: "Check for updates…", click: o.checkForUpdates } as MenuItemConstructorOptions, { role: "about" } as MenuItemConstructorOptions]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
