/*
Forge Sync - Obsidian Plugin
Sync your notes with Forge knowledge capsules
*/

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ForgeSyncPlugin
});
module.exports = __toCommonJS(main_exports);

// logger.ts
var Logger = class {
  static formatMessage(level, message) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    return `[${timestamp}] [ForgeSync] [${level}] ${message}`;
  }
  static info(message, ...optionalParams) {
    if (this.debugMode) {
      console.log(this.formatMessage("INFO", message), ...optionalParams);
    }
  }
  static warn(message, ...optionalParams) {
    if (this.debugMode) {
      console.warn(this.formatMessage("WARN", message), ...optionalParams);
    }
  }
  static error(message, ...optionalParams) {
    console.error(this.formatMessage("ERROR", message), ...optionalParams);
  }
};
Logger.debugMode = false;

// main.ts
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  forgeApiUrl: "https://forgecascade.org/api/v1",
  authToken: "",
  authType: "bearer",
  vaultId: null,
  autoSync: false,
  autoSyncInterval: 5,
  syncDirection: "bidirectional",
  conflictResolution: "newest_wins",
  excludeFolders: [".obsidian", ".git", ".trash"],
  excludeTags: ["private", "draft"],
  debugLogging: false
};
var ForgeSyncPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.autoSyncIntervalId = null;
    this.statusBarItem = null;
    this.isSyncing = false;
  }
  async onload() {
    await this.loadPluginData();
    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar("idle");
    this.debouncedSync = (0, import_obsidian.debounce)(() => {
      if (this.settings.autoSync && !this.isSyncing) {
        this.syncAll();
      }
    }, 3e3, true);
    this.addRibbonIcon("refresh-cw", "Sync with Forge", () => this.syncAll());
    this.addCommand({
      id: "forge-sync-all",
      name: "Sync all notes with Forge",
      callback: () => this.syncAll()
    });
    this.addCommand({
      id: "forge-sync-current",
      name: "Sync current note with Forge",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          this.syncAll();
        } else {
          new import_obsidian.Notice("No active file to sync");
        }
      }
    });
    this.addCommand({
      id: "forge-check-conflicts",
      name: "Check sync conflicts",
      callback: () => this.checkConflicts()
    });
    this.addCommand({
      id: "forge-test-connection",
      name: "Test Forge connection",
      callback: async () => {
        const result = await this.testConnection();
        new import_obsidian.Notice(result.ok ? `Connected: ${result.message}` : `Failed: ${result.message}`);
      }
    });
    this.addSettingTab(new ForgeSyncSettingTab(this.app, this));
    if (this.settings.autoSync) {
      this.startAutoSync();
    }
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof import_obsidian.TFile)
          this.onFileModify(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof import_obsidian.TFile)
          this.onFileDelete(file);
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof import_obsidian.TFile)
          this.onFileRename(file, oldPath);
      })
    );
    this.registerObsidianProtocolHandler("forge-sync", async (params) => {
      Logger.info("Forge Sync URI handler triggered", params);
      let changed = false;
      if (params.token) {
        this.settings.authToken = params.token;
        changed = true;
      }
      if (params.url) {
        this.settings.forgeApiUrl = params.url;
        changed = true;
      }
      if (params.authtype === "apikey" || params.authtype === "bearer") {
        this.settings.authType = params.authtype;
        changed = true;
      }
      if (changed) {
        this.settings.autoSync = true;
        this.settings.syncDirection = "bidirectional";
        this.settings.autoSyncInterval = 10;
        await this.saveSettings();
        const result = await this.testConnection();
        if (result.ok) {
          new import_obsidian.Notice("Forge connected successfully! Starting sync...");
          this.startAutoSync();
          await this.syncAll();
        } else {
          new import_obsidian.Notice("Forge connection failed: " + result.message);
        }
      } else {
        new import_obsidian.Notice("Forge Sync: No configuration parameters provided in URL");
      }
    });
    Logger.info("Forge Sync plugin loaded");
  }
  onunload() {
    this.stopAutoSync();
    Logger.info("Forge Sync plugin unloaded");
  }
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Persistence (settings + syncState under separate keys) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async loadPluginData() {
    const raw = await this.loadData() || {};
    if (raw.forgeApiUrl !== void 0 && !raw.settings) {
      const { syncState, ...oldSettings } = raw;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, oldSettings);
      this.syncState = syncState || { lastSyncAt: null, syncedNotes: {}, pendingChanges: [] };
      await this.saveData({ settings: this.settings, syncState: this.syncState });
    } else {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});
      this.syncState = Object.assign(
        { lastSyncAt: null, syncedNotes: {}, pendingChanges: [] },
        raw.syncState || {}
      );
    }
    Logger.debugMode = this.settings.debugLogging;
  }
  async saveSettings() {
    const data = await this.loadData() || {};
    data.settings = { ...this.settings };
    await this.saveData(data);
  }
  async saveSyncState() {
    const data = await this.loadData() || {};
    data.syncState = { ...this.syncState };
    await this.saveData(data);
  }
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Status bar (plain text, no emoji) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  updateStatusBar(status) {
    if (!this.statusBarItem)
      return;
    const labels = {
      idle: "Forge [idle]",
      syncing: "Forge [syncing...]",
      success: "Forge [ok]",
      error: "Forge [error]",
      conflict: "Forge [conflicts]"
    };
    this.statusBarItem.setText(labels[status] || "Forge");
  }
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Auto-sync Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  startAutoSync() {
    if (this.autoSyncIntervalId)
      return;
    this.autoSyncIntervalId = window.setInterval(
      () => this.syncAll(),
      this.settings.autoSyncInterval * 60 * 1e3
    );
    Logger.info(`Auto-sync started (every ${this.settings.autoSyncInterval} min)`);
  }
  stopAutoSync() {
    if (this.autoSyncIntervalId) {
      window.clearInterval(this.autoSyncIntervalId);
      this.autoSyncIntervalId = null;
      Logger.info("Auto-sync stopped");
    }
  }
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ File event handlers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  shouldSyncFile(file) {
    if (file.extension !== "md")
      return false;
    for (const folder of this.settings.excludeFolders) {
      if (file.path.startsWith(folder + "/") || file.path === folder)
        return false;
    }
    return true;
  }
  onFileModify(file) {
    if (!this.shouldSyncFile(file))
      return;
    if (!this.syncState.pendingChanges.includes(file.path)) {
      this.syncState.pendingChanges.push(file.path);
    }
    if (this.settings.autoSync && this.settings.syncDirection !== "pull") {
      this.debouncedSync();
    }
  }
  async onFileDelete(file) {
    if (!this.shouldSyncFile(file))
      return;
    delete this.syncState.syncedNotes[file.path];
    const idx = this.syncState.pendingChanges.indexOf(file.path);
    if (idx !== -1)
      this.syncState.pendingChanges.splice(idx, 1);
    await this.saveSyncState();
  }
  async onFileRename(file, oldPath) {
    if (!this.shouldSyncFile(file))
      return;
    if (this.syncState.syncedNotes[oldPath]) {
      this.syncState.syncedNotes[file.path] = this.syncState.syncedNotes[oldPath];
      delete this.syncState.syncedNotes[oldPath];
      await this.saveSyncState();
    }
  }
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ HTTP helpers (supports Bearer + API Key) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  getAuthHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (this.settings.authType === "apikey") {
      headers["X-API-Key"] = this.settings.authToken;
    } else {
      headers["Authorization"] = `Bearer ${this.settings.authToken}`;
    }
    return headers;
  }
  obsidianApiUrl(path) {
    const base = this.settings.forgeApiUrl.replace(/\/+$/, "");
    return `${base}/obsidian${path}`;
  }
  async apiRequest(method, path, body) {
    const opts = {
      url: this.obsidianApiUrl(path),
      method,
      headers: this.getAuthHeaders()
    };
    if (body !== void 0) {
      opts.body = JSON.stringify(body);
    }
    return (0, import_obsidian.requestUrl)(opts);
  }
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Connection test Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async testConnection() {
    var _a;
    if (!this.settings.authToken) {
      return { ok: false, message: "No auth token configured" };
    }
    try {
      const resp = await this.apiRequest("GET", "/vaults");
      if (resp.status === 200) {
        const vaults = resp.json;
        return { ok: true, message: `${vaults.length} vault(s) registered on server.` };
      }
      return { ok: false, message: `Unexpected status: ${resp.status}` };
    } catch (e) {
      const status = (e == null ? void 0 : e.status) || ((_a = e == null ? void 0 : e.response) == null ? void 0 : _a.status);
      if (status === 401 || status === 403) {
        return { ok: false, message: "Authentication failed. Check your token and auth type." };
      }
      return { ok: false, message: `Connection failed: ${(e == null ? void 0 : e.message) || String(e)}` };
    }
  }
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Vault registration Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async ensureVaultRegistered() {
    if (this.settings.vaultId) {
      try {
        const resp2 = await this.apiRequest("GET", `/vaults/${this.settings.vaultId}`);
        if (resp2.status === 200)
          return this.settings.vaultId;
      } catch (e) {
        Logger.warn("Stored vault ID not found on server, re-registering");
        this.settings.vaultId = null;
      }
    }
    const vaultName = this.app.vault.getName();
    const vaultPath = this.app.vault.adapter.basePath || vaultName;
    const body = {
      name: vaultName,
      path: vaultPath,
      sync_direction: this.settings.syncDirection,
      conflict_resolution: this.settings.conflictResolution,
      exclude_folders: this.settings.excludeFolders,
      exclude_tags: this.settings.excludeTags,
      auto_sync: this.settings.autoSync,
      auto_sync_interval_minutes: this.settings.autoSyncInterval
    };
    const resp = await this.apiRequest("POST", "/vaults", body);
    const vault = resp.json;
    this.settings.vaultId = vault.id;
    await this.saveSettings();
    Logger.info(`Vault registered: ${vault.id}`);
    return vault.id;
  }
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Core sync (uses dedicated Obsidian vault API) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async syncAll() {
    if (!this.settings.authToken) {
      new import_obsidian.Notice("Please configure your Forge API token in settings");
      return;
    }
    if (this.isSyncing) {
      Logger.info("Sync already in progress, skipping");
      return;
    }
    this.isSyncing = true;
    this.updateStatusBar("syncing");
    new import_obsidian.Notice("Syncing with Forge...");
    try {
      const vaultId = await this.ensureVaultRegistered();
      const resp = await this.apiRequest("POST", `/vaults/${vaultId}/sync`);
      const result = resp.json;
      this.syncState.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
      this.syncState.pendingChanges = [];
      await this.saveSyncState();
      const hasConflicts = result.conflicts_found > result.conflicts_resolved;
      if (result.status === "error") {
        this.updateStatusBar("error");
        const errMsg = result.error_messages.length > 0 ? result.error_messages[0] : "Unknown error";
        new import_obsidian.Notice(`Forge sync error: ${errMsg}`);
      } else if (hasConflicts) {
        this.updateStatusBar("conflict");
        new import_obsidian.Notice(
          `Forge sync: ${result.notes_synced} synced, ${result.conflicts_found - result.conflicts_resolved} unresolved conflicts. Use "Check sync conflicts" command to resolve.`
        );
      } else {
        this.updateStatusBar("success");
        new import_obsidian.Notice(
          `Forge sync complete: ${result.notes_synced} synced (${result.notes_created} new, ${result.notes_updated} updated)`
        );
        setTimeout(() => this.updateStatusBar("idle"), 5e3);
      }
      Logger.info("Sync result:", result);
    } catch (e) {
      Logger.error("Sync failed:", e);
      this.updateStatusBar("error");
      new import_obsidian.Notice(`Forge sync failed: ${(e == null ? void 0 : e.message) || String(e)}`);
      setTimeout(() => this.updateStatusBar("idle"), 5e3);
    } finally {
      this.isSyncing = false;
    }
  }
  // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Conflict management Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  async checkConflicts() {
    if (!this.settings.vaultId) {
      new import_obsidian.Notice("No vault registered. Run a sync first.");
      return;
    }
    try {
      const resp = await this.apiRequest("GET", `/vaults/${this.settings.vaultId}/conflicts`);
      const conflicts = resp.json;
      if (conflicts.length === 0) {
        new import_obsidian.Notice("No unresolved conflicts.");
        this.updateStatusBar("idle");
        return;
      }
      const summary = conflicts.slice(0, 5).map((c) => `  - ${c.note_path}`).join("\n");
      const more = conflicts.length > 5 ? `
  ...and ${conflicts.length - 5} more` : "";
      new import_obsidian.Notice(`${conflicts.length} unresolved conflict(s):
${summary}${more}`, 1e4);
    } catch (e) {
      Logger.error("Failed to check conflicts:", e);
      new import_obsidian.Notice(`Failed to check conflicts: ${(e == null ? void 0 : e.message) || String(e)}`);
    }
  }
  async resolveConflict(conflictId, resolution) {
    if (!this.settings.vaultId)
      return false;
    try {
      await this.apiRequest(
        "POST",
        `/vaults/${this.settings.vaultId}/conflicts/${conflictId}/resolve`,
        { resolution }
      );
      return true;
    } catch (e) {
      Logger.error(`Failed to resolve conflict ${conflictId}:`, e);
      return false;
    }
  }
  async getSyncStatus() {
    if (!this.settings.vaultId)
      return null;
    try {
      const resp = await this.apiRequest("GET", `/vaults/${this.settings.vaultId}/status`);
      return resp.json;
    } catch (e) {
      Logger.error("Failed to get sync status:", e);
      return null;
    }
  }
};
var ForgeSyncSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Forge Sync Settings" });
    containerEl.createEl("h3", { text: "Connection" });
    new import_obsidian.Setting(containerEl).setName("Forge API URL").setDesc("Base URL of your Forge instance API").addText((text) => text.setPlaceholder("https://forgecascade.org/api/v1").setValue(this.plugin.settings.forgeApiUrl).onChange(async (value) => {
      this.plugin.settings.forgeApiUrl = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Auth Type").setDesc("Bearer token (user login) or API Key (agent/service)").addDropdown((dropdown) => dropdown.addOption("bearer", "Bearer Token").addOption("apikey", "API Key (X-API-Key)").setValue(this.plugin.settings.authType).onChange(async (value) => {
      this.plugin.settings.authType = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Auth Token").setDesc("Your Forge API token or API key").addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("Enter your token").setValue(this.plugin.settings.authToken).onChange(async (value) => {
        this.plugin.settings.authToken = value;
        await this.plugin.saveSettings();
      });
    });
    const testResultEl = containerEl.createDiv({ cls: "forge-test-result" });
    new import_obsidian.Setting(containerEl).setName("Test Connection").setDesc("Verify API connection and credentials").addButton((button) => button.setButtonText("Test").onClick(async () => {
      button.setButtonText("Testing...");
      button.setDisabled(true);
      const result = await this.plugin.testConnection();
      testResultEl.empty();
      testResultEl.createEl("p", {
        text: result.ok ? result.message : result.message,
        cls: result.ok ? "forge-test-ok" : "forge-test-fail"
      });
      testResultEl.style.color = result.ok ? "var(--text-success)" : "var(--text-error)";
      button.setButtonText("Test");
      button.setDisabled(false);
    }));
    containerEl.createEl("h3", { text: "Sync" });
    new import_obsidian.Setting(containerEl).setName("Sync Direction").setDesc("How notes sync between Obsidian and Forge").addDropdown((dropdown) => dropdown.addOption("push", "Push: Obsidian -> Forge").addOption("pull", "Pull: Forge -> Obsidian").addOption("bidirectional", "Bidirectional").setValue(this.plugin.settings.syncDirection).onChange(async (value) => {
      this.plugin.settings.syncDirection = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Conflict Resolution").setDesc("How to handle conflicts when both sides changed").addDropdown((dropdown) => dropdown.addOption("newest_wins", "Newest Wins").addOption("obsidian_wins", "Obsidian Wins").addOption("forge_wins", "Forge Wins").addOption("manual", "Manual").setValue(this.plugin.settings.conflictResolution).onChange(async (value) => {
      this.plugin.settings.conflictResolution = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Auto Sync").setDesc("Sync automatically on file changes and at regular intervals").addToggle((toggle) => toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => {
      this.plugin.settings.autoSync = value;
      await this.plugin.saveSettings();
      if (value) {
        this.plugin.startAutoSync();
      } else {
        this.plugin.stopAutoSync();
      }
    }));
    new import_obsidian.Setting(containerEl).setName("Auto Sync Interval").setDesc("Minutes between automatic full syncs").addSlider((slider) => slider.setLimits(1, 60, 1).setValue(this.plugin.settings.autoSyncInterval).setDynamicTooltip().onChange(async (value) => {
      this.plugin.settings.autoSyncInterval = value;
      await this.plugin.saveSettings();
      if (this.plugin.settings.autoSync) {
        this.plugin.stopAutoSync();
        this.plugin.startAutoSync();
      }
    }));
    containerEl.createEl("h3", { text: "Filters" });
    new import_obsidian.Setting(containerEl).setName("Exclude Folders").setDesc("Comma-separated folders to exclude from sync").addText((text) => text.setPlaceholder(".obsidian, .git, archive").setValue(this.plugin.settings.excludeFolders.join(", ")).onChange(async (value) => {
      this.plugin.settings.excludeFolders = value.split(",").map((s) => s.trim()).filter(Boolean);
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Exclude Tags").setDesc("Notes with these tags will not be synced").addText((text) => text.setPlaceholder("private, draft").setValue(this.plugin.settings.excludeTags.join(", ")).onChange(async (value) => {
      this.plugin.settings.excludeTags = value.split(",").map((s) => s.trim()).filter(Boolean);
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Debug Logging").setDesc("Enable detailed logging in the developer console").addToggle((toggle) => toggle.setValue(this.plugin.settings.debugLogging).onChange(async (value) => {
      this.plugin.settings.debugLogging = value;
      Logger.debugMode = value;
      await this.plugin.saveSettings();
    }));
    containerEl.createEl("h3", { text: "Status" });
    const statusDiv = containerEl.createDiv({ cls: "forge-sync-status" });
    if (this.plugin.settings.vaultId) {
      statusDiv.createEl("p", { text: `Vault ID: ${this.plugin.settings.vaultId}` });
    } else {
      statusDiv.createEl("p", { text: "Vault: not registered (will register on first sync)" });
    }
    statusDiv.createEl("p", {
      text: `Last sync: ${this.plugin.syncState.lastSyncAt ? new Date(this.plugin.syncState.lastSyncAt).toLocaleString() : "Never"}`
    });
    statusDiv.createEl("p", {
      text: `Synced notes: ${Object.keys(this.plugin.syncState.syncedNotes).length}`
    });
    statusDiv.createEl("p", {
      text: `Pending changes: ${this.plugin.syncState.pendingChanges.length}`
    });
    containerEl.createEl("h3", { text: "Actions" });
    new import_obsidian.Setting(containerEl).setName("Sync Now").setDesc("Trigger a full sync with Forge").addButton((button) => button.setButtonText("Sync Now").setCta().onClick(async () => {
      await this.plugin.syncAll();
      this.display();
    }));
    new import_obsidian.Setting(containerEl).setName("Check Conflicts").setDesc("View unresolved sync conflicts").addButton((button) => button.setButtonText("Check Conflicts").onClick(async () => {
      await this.plugin.checkConflicts();
    }));
    if (this.plugin.settings.vaultId) {
      new import_obsidian.Setting(containerEl).setName("Re-register Vault").setDesc("Unlink this vault from Forge and register fresh on next sync").addButton((button) => button.setButtonText("Re-register").setWarning().onClick(async () => {
        this.plugin.settings.vaultId = null;
        await this.plugin.saveSettings();
        new import_obsidian.Notice("Vault unlinked. Next sync will register a new vault.");
        this.display();
      }));
    }
  }
};
