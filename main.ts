import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  debounce,
  requestUrl,
} from 'obsidian';

interface ForgeSyncSettings {
  forgeApiUrl: string;
  authToken: string;
  autoSync: boolean;
  autoSyncInterval: number; // minutes
  syncDirection: 'push' | 'pull' | 'bidirectional';
  excludeFolders: string[];
  excludeTags: string[];
}

const DEFAULT_SETTINGS: ForgeSyncSettings = {
  forgeApiUrl: 'https://forgecascade.org/api/v1',
  authToken: '',
  autoSync: false,
  autoSyncInterval: 5,
  syncDirection: 'bidirectional',
  excludeFolders: ['.obsidian', '.git', '.trash'],
  excludeTags: ['private', 'draft'],
};

interface SyncState {
  lastSyncAt: string | null;
  syncedNotes: Record<string, { hash: string; capsuleId: string }>;
  pendingChanges: string[];
}

export default class ForgeSyncPlugin extends Plugin {
  settings: ForgeSyncSettings;
  syncState: SyncState;
  private autoSyncInterval: number | null = null;
  private statusBarItem: HTMLElement | null = null;

  async onload() {
    await this.loadSettings();
    await this.loadSyncState();

    // Add status bar item
    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar('idle');

    // Add ribbon icon for manual sync
    this.addRibbonIcon('refresh-cw', 'Sync with Forge', async () => {
      await this.syncAll();
    });

    // Add commands
    this.addCommand({
      id: 'forge-sync-all',
      name: 'Sync all notes with Forge',
      callback: async () => {
        await this.syncAll();
      },
    });

    this.addCommand({
      id: 'forge-sync-current',
      name: 'Sync current note with Forge',
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          await this.syncFile(file);
        } else {
          new Notice('No active file to sync');
        }
      },
    });

    this.addCommand({
      id: 'forge-push-current',
      name: 'Push current note to Forge',
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          await this.pushFile(file);
        } else {
          new Notice('No active file to push');
        }
      },
    });

    // Add settings tab
    this.addSettingTab(new ForgeSyncSettingTab(this.app, this));

    // Set up file watchers for auto-sync
    if (this.settings.autoSync) {
      this.startAutoSync();
    }

    // Watch for file changes
    this.registerEvent(
      this.app.vault.on('modify', debounce(this.onFileModify.bind(this), 2000, true))
    );

    this.registerEvent(
      this.app.vault.on('create', this.onFileCreate.bind(this))
    );

    this.registerEvent(
      this.app.vault.on('delete', this.onFileDelete.bind(this))
    );

    this.registerEvent(
      this.app.vault.on('rename', this.onFileRename.bind(this))
    );

    console.log('Forge Sync plugin loaded');
  }

  onunload() {
    this.stopAutoSync();
    console.log('Forge Sync plugin unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async loadSyncState() {
    const data = await this.loadData();
    this.syncState = data?.syncState || {
      lastSyncAt: null,
      syncedNotes: {},
      pendingChanges: [],
    };
  }

  async saveSyncState() {
    const data = await this.loadData() || {};
    data.syncState = this.syncState;
    await this.saveData(data);
  }

  updateStatusBar(status: 'idle' | 'syncing' | 'success' | 'error') {
    if (!this.statusBarItem) return;

    const icons: Record<string, string> = {
      idle: '⚪',
      syncing: '🔄',
      success: '✅',
      error: '❌',
    };

    this.statusBarItem.setText(`Forge ${icons[status]}`);
  }

  startAutoSync() {
    if (this.autoSyncInterval) return;

    this.autoSyncInterval = window.setInterval(
      () => this.syncAll(),
      this.settings.autoSyncInterval * 60 * 1000
    );

    console.log(`Auto-sync started (every ${this.settings.autoSyncInterval} minutes)`);
  }

  stopAutoSync() {
    if (this.autoSyncInterval) {
      window.clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
      console.log('Auto-sync stopped');
    }
  }

  private shouldSyncFile(file: TFile): boolean {
    // Only sync markdown files
    if (file.extension !== 'md') return false;

    // Check exclude folders
    for (const folder of this.settings.excludeFolders) {
      if (file.path.startsWith(folder + '/') || file.path === folder) {
        return false;
      }
    }

    return true;
  }

  private async onFileModify(file: TFile) {
    if (!this.shouldSyncFile(file)) return;

    // Add to pending changes
    if (!this.syncState.pendingChanges.includes(file.path)) {
      this.syncState.pendingChanges.push(file.path);
      await this.saveSyncState();
    }

    // Auto-sync if enabled
    if (this.settings.autoSync && this.settings.syncDirection !== 'pull') {
      // Debounced sync handled by event registration
    }
  }

  private async onFileCreate(file: TFile) {
    if (!this.shouldSyncFile(file)) return;

    if (this.settings.autoSync && this.settings.syncDirection !== 'pull') {
      await this.pushFile(file);
    }
  }

  private async onFileDelete(file: TFile) {
    if (!this.shouldSyncFile(file)) return;

    // Remove from sync state
    delete this.syncState.syncedNotes[file.path];
    await this.saveSyncState();
  }

  private async onFileRename(file: TFile, oldPath: string) {
    if (!this.shouldSyncFile(file)) return;

    // Update sync state with new path
    if (this.syncState.syncedNotes[oldPath]) {
      this.syncState.syncedNotes[file.path] = this.syncState.syncedNotes[oldPath];
      delete this.syncState.syncedNotes[oldPath];
      await this.saveSyncState();
    }
  }

  async syncAll(): Promise<void> {
    if (!this.settings.authToken) {
      new Notice('Please configure your Forge API token in settings');
      return;
    }

    this.updateStatusBar('syncing');
    new Notice('Syncing with Forge...');

    try {
      const files = this.app.vault.getMarkdownFiles().filter(f => this.shouldSyncFile(f));
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

      this.syncState.lastSyncAt = new Date().toISOString();
      this.syncState.pendingChanges = [];
      await this.saveSyncState();

      this.updateStatusBar(errors > 0 ? 'error' : 'success');
      new Notice(`Forge sync complete: ${synced} synced, ${errors} errors`);

      // Reset status after a delay
      setTimeout(() => this.updateStatusBar('idle'), 3000);

    } catch (e) {
      console.error('Sync failed:', e);
      this.updateStatusBar('error');
      new Notice(`Forge sync failed: ${e.message}`);
    }
  }

  async syncFile(file: TFile): Promise<void> {
    const content = await this.app.vault.read(file);
    const hash = this.hashContent(content);
    const existing = this.syncState.syncedNotes[file.path];

    if (existing && existing.hash === hash) {
      // No changes
      return;
    }

    if (this.settings.syncDirection === 'push' || this.settings.syncDirection === 'bidirectional') {
      await this.pushFile(file);
    }
  }

  async pushFile(file: TFile): Promise<void> {
    if (!this.settings.authToken) {
      throw new Error('No auth token configured');
    }

    const content = await this.app.vault.read(file);
    const { frontmatter, body } = this.parseFrontmatter(content);

    // Extract tags from content
    const tags = this.extractTags(content);

    // Check exclude tags
    for (const tag of this.settings.excludeTags) {
      if (tags.includes(tag)) {
        console.log(`Skipping ${file.path}: has excluded tag #${tag}`);
        return;
      }
    }

    // Build capsule data
    const capsuleData = {
      content: body,
      title: frontmatter?.title || file.basename,
      tags: tags,
      metadata: {
        source: 'obsidian',
        obsidian_path: file.path,
        ...frontmatter,
      },
    };

    const existing = this.syncState.syncedNotes[file.path];

    try {
      let response;
      if (existing?.capsuleId) {
        // Update existing capsule
        response = await requestUrl({
          url: `${this.settings.forgeApiUrl}/capsules/${existing.capsuleId}`,
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${this.settings.authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(capsuleData),
        });
      } else {
        // Create new capsule
        response = await requestUrl({
          url: `${this.settings.forgeApiUrl}/capsules`,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.settings.authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(capsuleData),
        });
      }

      const result = response.json;

      // Update sync state
      this.syncState.syncedNotes[file.path] = {
        hash: this.hashContent(content),
        capsuleId: result.id,
      };
      await this.saveSyncState();

      console.log(`Pushed ${file.path} to Forge (capsule: ${result.id})`);

    } catch (e) {
      console.error(`Failed to push ${file.path}:`, e);
      throw e;
    }
  }

  private parseFrontmatter(content: string): { frontmatter: Record<string, any> | null; body: string } {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) {
      return { frontmatter: null, body: content };
    }

    try {
      // Simple YAML parsing (for basic key: value pairs)
      const frontmatter: Record<string, any> = {};
      const lines = match[1].split('\n');
      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
          const value = valueParts.join(':').trim();
          // Handle arrays
          if (value.startsWith('[') && value.endsWith(']')) {
            frontmatter[key.trim()] = value.slice(1, -1).split(',').map(s => s.trim());
          } else {
            frontmatter[key.trim()] = value;
          }
        }
      }
      return { frontmatter, body: match[2] };
    } catch (e) {
      console.warn('Failed to parse frontmatter:', e);
      return { frontmatter: null, body: content };
    }
  }

  private extractTags(content: string): string[] {
    const tags = new Set<string>();

    // Extract inline tags (#tag)
    const tagRegex = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/g;
    let match;
    while ((match = tagRegex.exec(content)) !== null) {
      tags.add(match[1].toLowerCase());
    }

    // Extract from frontmatter
    const { frontmatter } = this.parseFrontmatter(content);
    if (frontmatter?.tags) {
      const fmTags = Array.isArray(frontmatter.tags)
        ? frontmatter.tags
        : String(frontmatter.tags).split(',');
      for (const tag of fmTags) {
        tags.add(String(tag).trim().toLowerCase());
      }
    }

    return Array.from(tags);
  }

  private hashContent(content: string): string {
    // Simple hash for change detection
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}

class ForgeSyncSettingTab extends PluginSettingTab {
  plugin: ForgeSyncPlugin;

  constructor(app: App, plugin: ForgeSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Forge Sync Settings' });

    // API URL
    new Setting(containerEl)
      .setName('Forge API URL')
      .setDesc('The URL of your Forge instance API')
      .addText(text => text
        .setPlaceholder('https://forgecascade.org/api/v1')
        .setValue(this.plugin.settings.forgeApiUrl)
        .onChange(async (value) => {
          this.plugin.settings.forgeApiUrl = value;
          await this.plugin.saveSettings();
        }));

    // Auth Token
    new Setting(containerEl)
      .setName('API Token')
      .setDesc('Your Forge API authentication token')
      .addText(text => text
        .setPlaceholder('Enter your token')
        .setValue(this.plugin.settings.authToken)
        .onChange(async (value) => {
          this.plugin.settings.authToken = value;
          await this.plugin.saveSettings();
        }));

    // Sync Direction
    new Setting(containerEl)
      .setName('Sync Direction')
      .setDesc('Choose how notes sync between Obsidian and Forge')
      .addDropdown(dropdown => dropdown
        .addOption('push', 'Obsidian → Forge')
        .addOption('pull', 'Forge → Obsidian')
        .addOption('bidirectional', 'Bidirectional')
        .setValue(this.plugin.settings.syncDirection)
        .onChange(async (value: 'push' | 'pull' | 'bidirectional') => {
          this.plugin.settings.syncDirection = value;
          await this.plugin.saveSettings();
        }));

    // Auto Sync
    new Setting(containerEl)
      .setName('Auto Sync')
      .setDesc('Automatically sync notes at regular intervals')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoSync)
        .onChange(async (value) => {
          this.plugin.settings.autoSync = value;
          await this.plugin.saveSettings();
          if (value) {
            this.plugin.startAutoSync();
          } else {
            this.plugin.stopAutoSync();
          }
        }));

    // Auto Sync Interval
    new Setting(containerEl)
      .setName('Auto Sync Interval')
      .setDesc('Minutes between automatic syncs')
      .addSlider(slider => slider
        .setLimits(1, 60, 1)
        .setValue(this.plugin.settings.autoSyncInterval)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.autoSyncInterval = value;
          await this.plugin.saveSettings();
          if (this.plugin.settings.autoSync) {
            this.plugin.stopAutoSync();
            this.plugin.startAutoSync();
          }
        }));

    // Exclude Folders
    new Setting(containerEl)
      .setName('Exclude Folders')
      .setDesc('Comma-separated list of folders to exclude from sync')
      .addText(text => text
        .setPlaceholder('.obsidian, .git, archive')
        .setValue(this.plugin.settings.excludeFolders.join(', '))
        .onChange(async (value) => {
          this.plugin.settings.excludeFolders = value.split(',').map(s => s.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        }));

    // Exclude Tags
    new Setting(containerEl)
      .setName('Exclude Tags')
      .setDesc('Notes with these tags will not be synced')
      .addText(text => text
        .setPlaceholder('private, draft')
        .setValue(this.plugin.settings.excludeTags.join(', '))
        .onChange(async (value) => {
          this.plugin.settings.excludeTags = value.split(',').map(s => s.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        }));

    // Sync Status
    containerEl.createEl('h3', { text: 'Sync Status' });

    const statusDiv = containerEl.createDiv({ cls: 'forge-sync-status' });
    statusDiv.createEl('p', {
      text: `Last sync: ${this.plugin.syncState.lastSyncAt
        ? new Date(this.plugin.syncState.lastSyncAt).toLocaleString()
        : 'Never'}`
    });
    statusDiv.createEl('p', {
      text: `Synced notes: ${Object.keys(this.plugin.syncState.syncedNotes).length}`
    });
    statusDiv.createEl('p', {
      text: `Pending changes: ${this.plugin.syncState.pendingChanges.length}`
    });

    // Manual Sync Button
    new Setting(containerEl)
      .setName('Manual Sync')
      .setDesc('Sync all notes now')
      .addButton(button => button
        .setButtonText('Sync Now')
        .setCta()
        .onClick(async () => {
          await this.plugin.syncAll();
          this.display(); // Refresh the display
        }));
  }
}
