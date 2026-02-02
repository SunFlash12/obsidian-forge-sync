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
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  forgeApiUrl: "https://forgecascade.org/api/v1",
  authToken: "",
  autoSync: false,
  autoSyncInterval: 5,
  syncDirection: "bidirectional",
  excludeFolders: [".obsidian", ".git", ".trash"],
  excludeTags: ["private", "draft"]
};
var ForgeSyncPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.autoSyncInterval = null;
    this.statusBarItem = null;
  }
  async onload() {
    await this.loadSettings();
    await this.loadSyncState();
    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar("idle");
    this.addRibbonIcon("refresh-cw", "Sync with Forge", async () => {
      await this.syncAll();
    });
    this.addCommand({
      id: "forge-sync-all",
      name: "Sync all notes with Forge",
      callback: async () => {
        await this.syncAll();
      }
    });
    this.addCommand({
      id: "forge-sync-current",
      name: "Sync current note with Forge",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          await this.syncFile(file);
        } else {
          new import_obsidian.Notice("No active file to sync");
        }
      }
    });
    this.addCommand({
      id: "forge-push-current",
      name: "Push current note to Forge",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          await this.pushFile(file);
        } else {
          new import_obsidian.Notice("No active file to push");
        }
      }
    });
    this.addSettingTab(new ForgeSyncSettingTab(this.app, this));
    if (this.settings.autoSync) {
      this.startAutoSync();
    }
    this.registerEvent(
      this.app.vault.on("modify", (0, import_obsidian.debounce)(this.onFileModify.bind(this), 2e3, true))
    );
    this.registerEvent(
      this.app.vault.on("create", this.onFileCreate.bind(this))
    );
    this.registerEvent(
      this.app.vault.on("delete", this.onFileDelete.bind(this))
    );
    this.registerEvent(
      this.app.vault.on("rename", this.onFileRename.bind(this))
    );
    console.log("Forge Sync plugin loaded");
  }
  onunload() {
    this.stopAutoSync();
    console.log("Forge Sync plugin unloaded");
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async loadSyncState() {
    const data = await this.loadData();
    this.syncState = (data == null ? void 0 : data.syncState) || {
      lastSyncAt: null,
      syncedNotes: {},
      pendingChanges: []
    };
  }
  async saveSyncState() {
    const data = await this.loadData() || {};
    data.syncState = this.syncState;
    await this.saveData(data);
  }
  updateStatusBar(status) {
    if (!this.statusBarItem)
      return;
    const icons = {
      idle: "\u26AA",
      syncing: "\u{1F504}",
      success: "\u2705",
      error: "\u274C"
    };
    this.statusBarItem.setText(`Forge ${icons[status]}`);
  }
  startAutoSync() {
    if (this.autoSyncInterval)
      return;
    this.autoSyncInterval = window.setInterval(
      () => this.syncAll(),
      this.settings.autoSyncInterval * 60 * 1e3
    );
    console.log(`Auto-sync started (every ${this.settings.autoSyncInterval} minutes)`);
  }
  stopAutoSync() {
    if (this.autoSyncInterval) {
      window.clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
      console.log("Auto-sync stopped");
    }
  }
  shouldSyncFile(file) {
    if (file.extension !== "md")
      return false;
    for (const folder of this.settings.excludeFolders) {
      if (file.path.startsWith(folder + "/") || file.path === folder) {
        return false;
      }
    }
    return true;
  }
  async onFileModify(file) {
    if (!this.shouldSyncFile(file))
      return;
    if (!this.syncState.pendingChanges.includes(file.path)) {
      this.syncState.pendingChanges.push(file.path);
      await this.saveSyncState();
    }
    if (this.settings.autoSync && this.settings.syncDirection !== "pull") {
    }
  }
  async onFileCreate(file) {
    if (!this.shouldSyncFile(file))
      return;
    if (this.settings.autoSync && this.settings.syncDirection !== "pull") {
      await this.pushFile(file);
    }
  }
  async onFileDelete(file) {
    if (!this.shouldSyncFile(file))
      return;
    delete this.syncState.syncedNotes[file.path];
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
  async syncAll() {
    if (!this.settings.authToken) {
      new import_obsidian.Notice("Please configure your Forge API token in settings");
      return;
    }
    this.updateStatusBar("syncing");
    new import_obsidian.Notice("Syncing with Forge...");
    try {
      const files = this.app.vault.getMarkdownFiles().filter((f) => this.shouldSyncFile(f));
      let synced = 0;
      let errors = 0;
      for (const file of files) {
        try {
          await this.syncFile(file);
          synced++;
        } catch (e) {
          console.error(`Error syncing ${file.path}:`, e);
          errors++;
        }
      }
      this.syncState.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
      this.syncState.pendingChanges = [];
      await this.saveSyncState();
      this.updateStatusBar(errors > 0 ? "error" : "success");
      new import_obsidian.Notice(`Forge sync complete: ${synced} synced, ${errors} errors`);
      setTimeout(() => this.updateStatusBar("idle"), 3e3);
    } catch (e) {
      console.error("Sync failed:", e);
      this.updateStatusBar("error");
      new import_obsidian.Notice(`Forge sync failed: ${e.message}`);
    }
  }
  async syncFile(file) {
    const content = await this.app.vault.read(file);
    const hash = this.hashContent(content);
    const existing = this.syncState.syncedNotes[file.path];
    if (existing && existing.hash === hash) {
      return;
    }
    if (this.settings.syncDirection === "push" || this.settings.syncDirection === "bidirectional") {
      await this.pushFile(file);
    }
  }
  async pushFile(file) {
    if (!this.settings.authToken) {
      throw new Error("No auth token configured");
    }
    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.parseFrontmatter(content);
    const tags = this.extractTags(content);
    for (const tag of this.settings.excludeTags) {
      if (tags.includes(tag)) {
        console.log(`Skipping ${file.path}: has excluded tag #${tag}`);
        return;
      }
    }
    const capsuleData = {
      content: body,
      title: (frontmatter == null ? void 0 : frontmatter.title) || file.basename,
      tags,
      metadata: {
        source: "obsidian",
        obsidian_path: file.path,
        ...frontmatter
      }
    };
    const existing = this.syncState.syncedNotes[file.path];
    try {
      let response;
      if (existing == null ? void 0 : existing.capsuleId) {
        response = await (0, import_obsidian.requestUrl)({
          url: `${this.settings.forgeApiUrl}/capsules/${existing.capsuleId}`,
          method: "PATCH",
          headers: {
            "Authorization": `Bearer ${this.settings.authToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(capsuleData)
        });
      } else {
        response = await (0, import_obsidian.requestUrl)({
          url: `${this.settings.forgeApiUrl}/capsules`,
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.settings.authToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(capsuleData)
        });
      }
      const result = response.json;
      this.syncState.syncedNotes[file.path] = {
        hash: this.hashContent(content),
        capsuleId: result.id
      };
      await this.saveSyncState();
      console.log(`Pushed ${file.path} to Forge (capsule: ${result.id})`);
    } catch (e) {
      console.error(`Failed to push ${file.path}:`, e);
      throw e;
    }
  }
  parseFrontmatter(content) {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) {
      return { frontmatter: null, body: content };
    }
    try {
      const frontmatter = {};
      const lines = match[1].split("\n");
      for (const line of lines) {
        const [key, ...valueParts] = line.split(":");
        if (key && valueParts.length > 0) {
          const value = valueParts.join(":").trim();
          if (value.startsWith("[") && value.endsWith("]")) {
            frontmatter[key.trim()] = value.slice(1, -1).split(",").map((s) => s.trim());
          } else {
            frontmatter[key.trim()] = value;
          }
        }
      }
      return { frontmatter, body: match[2] };
    } catch (e) {
      console.warn("Failed to parse frontmatter:", e);
      return { frontmatter: null, body: content };
    }
  }
  extractTags(content) {
    const tags = /* @__PURE__ */ new Set();
    const tagRegex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/g;
    let match;
    while ((match = tagRegex.exec(content)) !== null) {
      tags.add(match[1].toLowerCase());
    }
    const { frontmatter } = this.parseFrontmatter(content);
    if (frontmatter == null ? void 0 : frontmatter.tags) {
      const fmTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : String(frontmatter.tags).split(",");
      for (const tag of fmTags) {
        tags.add(String(tag).trim().toLowerCase());
      }
    }
    return Array.from(tags);
  }
  hashContent(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
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
    new import_obsidian.Setting(containerEl).setName("Forge API URL").setDesc("The URL of your Forge instance API").addText((text) => text.setPlaceholder("https://forgecascade.org/api/v1").setValue(this.plugin.settings.forgeApiUrl).onChange(async (value) => {
      this.plugin.settings.forgeApiUrl = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("API Token").setDesc("Your Forge API authentication token").addText((text) => text.setPlaceholder("Enter your token").setValue(this.plugin.settings.authToken).onChange(async (value) => {
      this.plugin.settings.authToken = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Sync Direction").setDesc("Choose how notes sync between Obsidian and Forge").addDropdown((dropdown) => dropdown.addOption("push", "Obsidian \u2192 Forge").addOption("pull", "Forge \u2192 Obsidian").addOption("bidirectional", "Bidirectional").setValue(this.plugin.settings.syncDirection).onChange(async (value) => {
      this.plugin.settings.syncDirection = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Auto Sync").setDesc("Automatically sync notes at regular intervals").addToggle((toggle) => toggle.setValue(this.plugin.settings.autoSync).onChange(async (value) => {
      this.plugin.settings.autoSync = value;
      await this.plugin.saveSettings();
      if (value) {
        this.plugin.startAutoSync();
      } else {
        this.plugin.stopAutoSync();
      }
    }));
    new import_obsidian.Setting(containerEl).setName("Auto Sync Interval").setDesc("Minutes between automatic syncs").addSlider((slider) => slider.setLimits(1, 60, 1).setValue(this.plugin.settings.autoSyncInterval).setDynamicTooltip().onChange(async (value) => {
      this.plugin.settings.autoSyncInterval = value;
      await this.plugin.saveSettings();
      if (this.plugin.settings.autoSync) {
        this.plugin.stopAutoSync();
        this.plugin.startAutoSync();
      }
    }));
    new import_obsidian.Setting(containerEl).setName("Exclude Folders").setDesc("Comma-separated list of folders to exclude from sync").addText((text) => text.setPlaceholder(".obsidian, .git, archive").setValue(this.plugin.settings.excludeFolders.join(", ")).onChange(async (value) => {
      this.plugin.settings.excludeFolders = value.split(",").map((s) => s.trim()).filter(Boolean);
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("Exclude Tags").setDesc("Notes with these tags will not be synced").addText((text) => text.setPlaceholder("private, draft").setValue(this.plugin.settings.excludeTags.join(", ")).onChange(async (value) => {
      this.plugin.settings.excludeTags = value.split(",").map((s) => s.trim()).filter(Boolean);
      await this.plugin.saveSettings();
    }));
    containerEl.createEl("h3", { text: "Sync Status" });
    const statusDiv = containerEl.createDiv({ cls: "forge-sync-status" });
    statusDiv.createEl("p", {
      text: `Last sync: ${this.plugin.syncState.lastSyncAt ? new Date(this.plugin.syncState.lastSyncAt).toLocaleString() : "Never"}`
    });
    statusDiv.createEl("p", {
      text: `Synced notes: ${Object.keys(this.plugin.syncState.syncedNotes).length}`
    });
    statusDiv.createEl("p", {
      text: `Pending changes: ${this.plugin.syncState.pendingChanges.length}`
    });
    new import_obsidian.Setting(containerEl).setName("Manual Sync").setDesc("Sync all notes now").addButton((button) => button.setButtonText("Sync Now").setCta().onClick(async () => {
      await this.plugin.syncAll();
      this.display();
    }));
  }
};
