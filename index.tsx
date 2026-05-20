

import { GoogleGenAI, Chat, GenerateContentResponse, Content } from "@google/genai";
import { registerSW } from "virtual:pwa-register";
import { profanityList } from "./profanity-list";
import { io, Socket } from "socket.io-client";
import localforage from "localforage";

if ('serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegistered(registration) {
      registration?.update();
    },
  });
}

interface ApiKey {
  name: string;
  key: string;
  endpoint?: string;
}

export interface ModelPreset {
    id: string;
    name: string;
    modelName: string;
    useAssociatedApiKey: boolean;
    associatedApiKeyName: string;
    useAssociatedSettings: boolean;
    contextLength: number;
    maxResponseLength: number;
    isStreaming: boolean;
    isShowCoTEnabled: boolean;
    isImageModel?: boolean;
    topK?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    minP?: number;
    dryRepetitionPenalty?: number;
    excludeTopChoices?: number;
}

export interface JailbreakPrompt {
    name?: string;
    role?: string;
    content?: string;
    enabled?: boolean;
    identifier?: string;
    system_prompt?: boolean;
    injection_position?: number;
    injection_depth?: number;
    [key: string]: any;
}

export interface TavernPreset {
    id: string;
    name: string;
    originalJson: any; // Keep the whole JSON
    prompts?: JailbreakPrompt[];
    rawPromptCount?: number;
    enabledFile?: boolean;
}

export interface ContentReplacement {
    id: string;
    type: 'text' | 'regex';
    applyTo?: 'both' | 'user' | 'ai';
    target: string;
    replacement: string;
    enabled: boolean;
}

interface Session {
    id: string;
    name: string;
    createdAt: string;
    history: Content[];
    dataMemory: Record<string, any>;
    scrollTop?: number;

    // Per-session settings
    systemInstruction?: string;
    temperature?: number;
    modelName?: string;
    contextLength?: number;
    maxResponseLength?: number;
    isStreaming?: boolean;
    isShowCoTEnabled?: boolean;
    isContinuousOutputEnabled?: boolean;
    isDataMemoryEnabled?: boolean;
    isAutoAdvanceEnabled?: boolean;
    autoAdvancePrompt?: string;
    isAutoRetryEnabled?: boolean;
    
    // Per-session settings for advanced/unofficial features (optional, depending on architecture)
    topK?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    minP?: number;
    dryRepetitionPenalty?: number;
    excludeTopChoices?: number;
}

type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

const SYNC_LOCAL_STORAGE_KEYS = [
    'apiKeys',
    'activeApiKeyName',
    'activeSessionId',
    'temperature_default',
    'modelName_default',
    'contextLength_default',
    'maxResponseLength_default',
    'isStreaming_default',
    'isShowCoTEnabled_default',
    'isContinuousOutputEnabled_default',
    'isAutoAdvanceEnabled_default',
    'autoAdvancePrompt_default',
    'isAutoRetryEnabled_default',
    'modelPresets',
    'activeModelPresetId',
    'tavernPresets',
    'activeTavernPresetId',
    'contentReplacements',
] as const;

interface ErrorReport {
    id: string;
    time: string;
    context: string;
    severity: ErrorSeverity;
    message: string;
    technicalMessage: string;
    stack?: string;
    status?: number;
    cause?: unknown;
}


class ChatApp {
  private socket: Socket | null = null;
  private isSyncingFromServer = false;
  private syncConnectionNoticeShown = false;
  private syncReconnectNoticeShown = false;
  private defaultSettingsSaveTimer: number | null = null;
  private replacementsSaveTimer: number | null = null;

  private ai: GoogleGenAI | null = null;
  private chat: Chat | null = null;
  private chatContainer: HTMLElement;
  private form: HTMLFormElement;
  private input: HTMLTextAreaElement;
  private submitButton: HTMLButtonElement;
  private cancelButton: HTMLButtonElement;
  private appTitle: HTMLElement;
  
  // Sidebar Elements
  private settingsBtn: HTMLElement;
  private settingsSidebar: HTMLElement;
  private sidebarBackdrop: HTMLElement;
  private closeSidebarBtn: HTMLElement;
  private newChatBtn: HTMLElement;

  // New Session Modal
  private newSessionModal: HTMLElement;
  private newSessionForm: HTMLFormElement;
  private newSessionNameInput: HTMLInputElement;

  // Sidebar Panes & Navigation
  private navButtons: NodeListOf<HTMLButtonElement>;
  private contentPanes: NodeListOf<HTMLElement>;

  // Session Management
  private sessionListContainer: HTMLElement;

  // Chat Settings
  private chatSettingsForm: HTMLFormElement;
  private systemPromptLabel: HTMLElement;
  private systemPromptInput: HTMLTextAreaElement;
  private temperatureSlider: HTMLInputElement;
  private temperatureInputBox: HTMLInputElement;
  private streamingToggle: HTMLInputElement;
  private showCoTToggle: HTMLInputElement;
  private continuousOutputToggle: HTMLInputElement;

  private modelPresetSelect: HTMLSelectElement;
  private editModelPresetBtn: HTMLButtonElement;
  private createModelPresetBtn: HTMLButtonElement;

  // Model Preset Modal
  private modelPresetModal: HTMLElement;
  private closeModelPresetModalBtn: HTMLElement;
  private modelPresetForm: HTMLFormElement;
  private modelPresetOriginalId: HTMLInputElement;
  private presetNameInput: HTMLInputElement;
  private presetIsImageModelToggle: HTMLInputElement;
  private presetBindApiKeyToggle: HTMLInputElement;
  private presetApiKeyContainer: HTMLElement;
  private presetApiKeySelect: HTMLSelectElement;
  private presetBindSettingsToggle: HTMLInputElement;
  private presetSettingsContainer: HTMLElement;
  private presetContextLengthSlider: HTMLInputElement;
  private presetContextLengthInput: HTMLInputElement;
  private presetMaxResponseSlider: HTMLInputElement;
  private presetMaxResponseInput: HTMLInputElement;
  private presetStreamingToggle: HTMLInputElement;
  private presetShowCoTToggle: HTMLInputElement;
  
  private presetAdvancedToggle: HTMLInputElement;
  private presetAdvancedContainer: HTMLElement;
  private presetTopKSlider: HTMLInputElement;
  private presetTopKInput: HTMLInputElement;
  private presetTopPSlider: HTMLInputElement;
  private presetTopPInput: HTMLInputElement;
  private presetFrequencyPenaltySlider: HTMLInputElement;
  private presetFrequencyPenaltyInput: HTMLInputElement;
  private presetPresencePenaltySlider: HTMLInputElement;
  private presetPresencePenaltyInput: HTMLInputElement;

  private presetUnofficialToggle: HTMLInputElement;
  private presetUnofficialContainer: HTMLElement;
  private presetMinPSlider: HTMLInputElement;
  private presetMinPInput: HTMLInputElement;
  private presetDryPenaltySlider: HTMLInputElement;
  private presetDryPenaltyInput: HTMLInputElement;
  private presetExcludeTopSlider: HTMLInputElement;
  private presetExcludeTopInput: HTMLInputElement;
  
  private modalPresetListContainer: HTMLElement;
  private modalPresetFormWrapper: HTMLElement;
  private modalCreatePresetBtn: HTMLButtonElement;
  private editingModelPresetId: string | null = null;
  private debouncePresetSaveTimer: number | null = null;

  // File Handlers
  private attachFileBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;
  private filePreviewContainer: HTMLElement;
  private pendingFiles: { file: File, dataUrl: string }[] = [];

  // API Key Manager
  private addApiKeyForm: HTMLFormElement;
  private toggleAddApiKeyBtn: HTMLButtonElement;
  private apiKeyNameInput: HTMLInputElement;
  private apiKeyInput: HTMLInputElement;
  private apiKeyEndpointInput: HTMLInputElement;
  private apiKeyListContainer: HTMLElement;

  // Data Memory
  private dataMemoryToggle: HTMLInputElement;
  private dataMemoryDisplayWrapper: HTMLElement;
  private dataMemoryJsonTextarea: HTMLTextAreaElement;
  private saveMemoryBtn: HTMLButtonElement;

  // Accessibility
  private autoAdvanceToggle: HTMLInputElement;
  private autoAdvanceControls: HTMLElement;
  private autoAdvancePromptInput: HTMLTextAreaElement;
  private autoAdvanceBtn: HTMLButtonElement;
  private autoRetryToggle: HTMLInputElement;

  // Preset Manager
  private importPresetInput: HTMLInputElement;
  private importPresetBtn: HTMLButtonElement;
  private presetManagerList: HTMLElement;
  private presetSettingListView: HTMLElement;
  private presetSettingSettingsView: HTMLElement;
  private presetSettingTitle: HTMLElement;
  private closePresetSettingBtn: HTMLElement;
  private presetSettingPromptList: HTMLElement;
  private applyPresetBtn: HTMLButtonElement;
  private deletePresetBtn: HTMLButtonElement;
  
  private tavernPresets: TavernPreset[] = [];
  private activeTavernPresetId: string | null = null;
  private editingTavernPresetId: string | null = null;

  // Replacements
  private addReplacementBtn: HTMLButtonElement;
  private replacementsList: HTMLElement;
  private contentReplacements: ContentReplacement[] = [];

  // Data Management
  private exportDataBtn: HTMLButtonElement;
  private importDataBtn: HTMLButtonElement;
  private importDataInput: HTMLInputElement;
  private importAiStudioBtn: HTMLButtonElement;
  private importAiStudioInput: HTMLInputElement;


  // App State
  private apiKeys: ApiKey[] = [];
  private activeApiKeyName: string | null = null;
  private pendingDeletionApiKeyName: string | null = null;
  private isCustomEndpoint: boolean = false;
  private modelPresets: ModelPreset[] = [];
  private activeModelPresetId: string = "default";

  // Settings state (defaults for new sessions, reflects active session's state)
  private systemInstruction: string = "";
  private temperature: number = 1.0;
  private modelName: string = "gemini-2.5-pro";
  private contextLength: number = 0;
  private maxResponseLength: number = 0;
  private isStreaming: boolean = false;
  private isShowCoTEnabled: boolean = true;
  private isContinuousOutputEnabled: boolean = false;
  private isDataMemoryEnabled: boolean = false;
  private isAutoAdvanceEnabled: boolean = false;
  private autoAdvancePrompt: string = '继续';
  private isAutoRetryEnabled: boolean = false;
  
  private topK: number = 0;
  private topP: number = 1;
  private frequencyPenalty: number = 0;
  private presencePenalty: number = 0;
  private minP: number = 0;
  private dryRepetitionPenalty: number = 0;
  private excludeTopChoices: number = 0;
  
  private isAutoAdvanceRunning: boolean = false;
  private autoRetryAttemptedKeys: string[] = [];
  private errorReports: ErrorReport[] = [];
  private readonly maxErrorReports = 50;
  
  private sessions: Record<string, Session> = {};
  private activeSessionId: string | null = null;
  private pendingDeletionSessionId: string | null = null;
  private boundCancelDeleteHandler: (event: MouseEvent) => void;

  private systemPromptClickCount: number = 0;
  private systemPromptClickTimer: number | null = null;
  private isEasterEggActive: boolean = false;
  private easterEggPreviewInput: HTMLTextAreaElement;

  private scrollDebounceTimer: number | null = null;
  private settingsUpdateDebounceTimer: number | null = null;
  private activeAbortController: AbortController | null = null;
  private isSubmittingMessage: boolean = false;
  private lastSyncErrorAt: number = 0;
  private readonly maxPendingFiles = 8;
  private readonly maxPendingFileSize = 10 * 1024 * 1024;

  constructor() {
    this.chatContainer = document.getElementById('chat-container')!;
    this.form = document.getElementById('chat-form') as HTMLFormElement;
    this.input = document.getElementById('message-input') as HTMLTextAreaElement;
    this.submitButton = document.getElementById('submit-btn') as HTMLButtonElement;
    this.cancelButton = document.getElementById('cancel-btn') as HTMLButtonElement;
    this.appTitle = document.getElementById('app-title')!;

    this.settingsBtn = document.getElementById('settings-btn')!;
    this.newChatBtn = document.getElementById('new-chat-btn')!;
    this.settingsSidebar = document.getElementById('settings-sidebar')!;
    this.sidebarBackdrop = document.getElementById('sidebar-backdrop')!;
    this.closeSidebarBtn = document.getElementById('close-sidebar-btn')!;
    
    this.newSessionModal = document.getElementById('new-session-modal')!;
    this.newSessionForm = document.getElementById('new-session-form') as HTMLFormElement;
    this.newSessionNameInput = document.getElementById('new-session-name-input') as HTMLInputElement;

    this.navButtons = document.querySelectorAll('.sidebar-nav .nav-button');
    this.contentPanes = document.querySelectorAll('.sidebar-content .content-pane');

    this.sessionListContainer = document.getElementById('session-list-container')!;

    this.chatSettingsForm = document.getElementById('chat-settings-form') as HTMLFormElement;
    this.systemPromptLabel = document.getElementById('system-prompt-label')!;
    this.systemPromptInput = document.getElementById('system-prompt-input') as HTMLTextAreaElement;
    this.easterEggPreviewInput = document.getElementById('easter-egg-preview-input') as HTMLTextAreaElement;
    this.temperatureSlider = document.getElementById('temperature-slider') as HTMLInputElement;
    this.temperatureInputBox = document.getElementById('temperature-input-box') as HTMLInputElement;
    this.modelPresetSelect = document.getElementById('model-preset-select') as HTMLSelectElement;
    this.editModelPresetBtn = document.getElementById('edit-model-preset-btn') as HTMLButtonElement;
    this.createModelPresetBtn = document.getElementById('create-model-preset-btn') as HTMLButtonElement;
    this.streamingToggle = document.getElementById('streaming-toggle') as HTMLInputElement;
    this.showCoTToggle = document.getElementById('show-cot-toggle') as HTMLInputElement;
    this.continuousOutputToggle = document.getElementById('continuous-output-toggle') as HTMLInputElement;

    this.modelPresetModal = document.getElementById('model-preset-modal')!;
    this.modelPresetForm = document.getElementById('model-preset-form') as HTMLFormElement;
    this.modelPresetOriginalId = document.getElementById('model-preset-original-id') as HTMLInputElement;
    this.presetNameInput = document.getElementById('preset-name-input') as HTMLInputElement;
    this.presetIsImageModelToggle = document.getElementById('preset-is-image-model-toggle') as HTMLInputElement;
    this.presetBindApiKeyToggle = document.getElementById('preset-bind-api-key-toggle') as HTMLInputElement;
    this.presetApiKeyContainer = document.getElementById('preset-api-key-container')!;
    this.presetApiKeySelect = document.getElementById('preset-api-key-select') as HTMLSelectElement;
    this.presetBindSettingsToggle = document.getElementById('preset-bind-settings-toggle') as HTMLInputElement;
    this.presetSettingsContainer = document.getElementById('preset-settings-container')!;
    this.presetContextLengthSlider = document.getElementById('preset-context-length-slider') as HTMLInputElement;
    this.presetContextLengthInput = document.getElementById('preset-context-length-input') as HTMLInputElement;
    this.presetMaxResponseSlider = document.getElementById('preset-max-response-slider') as HTMLInputElement;
    this.presetMaxResponseInput = document.getElementById('preset-max-response-input') as HTMLInputElement;
    this.presetStreamingToggle = document.getElementById('preset-streaming-toggle') as HTMLInputElement;
    this.presetShowCoTToggle = document.getElementById('preset-show-cot-toggle') as HTMLInputElement;
    
    this.presetAdvancedToggle = document.getElementById('preset-advanced-toggle') as HTMLInputElement;
    this.presetAdvancedContainer = document.getElementById('preset-advanced-container')!;
    this.presetTopKSlider = document.getElementById('preset-top-k-slider') as HTMLInputElement;
    this.presetTopKInput = document.getElementById('preset-top-k-input') as HTMLInputElement;
    this.presetTopPSlider = document.getElementById('preset-top-p-slider') as HTMLInputElement;
    this.presetTopPInput = document.getElementById('preset-top-p-input') as HTMLInputElement;
    this.presetFrequencyPenaltySlider = document.getElementById('preset-frequency-penalty-slider') as HTMLInputElement;
    this.presetFrequencyPenaltyInput = document.getElementById('preset-frequency-penalty-input') as HTMLInputElement;
    this.presetPresencePenaltySlider = document.getElementById('preset-presence-penalty-slider') as HTMLInputElement;
    this.presetPresencePenaltyInput = document.getElementById('preset-presence-penalty-input') as HTMLInputElement;

    this.presetUnofficialToggle = document.getElementById('preset-unofficial-toggle') as HTMLInputElement;
    this.presetUnofficialContainer = document.getElementById('preset-unofficial-container')!;
    this.presetMinPSlider = document.getElementById('preset-min-p-slider') as HTMLInputElement;
    this.presetMinPInput = document.getElementById('preset-min-p-input') as HTMLInputElement;
    this.presetDryPenaltySlider = document.getElementById('preset-dry-penalty-slider') as HTMLInputElement;
    this.presetDryPenaltyInput = document.getElementById('preset-dry-penalty-input') as HTMLInputElement;
    this.presetExcludeTopSlider = document.getElementById('preset-exclude-top-slider') as HTMLInputElement;
    this.presetExcludeTopInput = document.getElementById('preset-exclude-top-input') as HTMLInputElement;
    
    this.modalPresetListContainer = document.getElementById('modal-preset-list-container')!;
    this.modalPresetFormWrapper = document.getElementById('modal-preset-form-wrapper')!;
    this.modalCreatePresetBtn = document.getElementById('modal-create-preset-btn') as HTMLButtonElement;
    this.closeModelPresetModalBtn = document.getElementById('close-model-preset-modal-btn')!;

    this.attachFileBtn = document.getElementById('attach-file-btn') as HTMLButtonElement;
    this.fileInput = document.getElementById('file-input') as HTMLInputElement;
    this.filePreviewContainer = document.getElementById('file-preview-container') as HTMLElement;

    this.addApiKeyForm = document.getElementById('add-api-key-form') as HTMLFormElement;
    this.toggleAddApiKeyBtn = document.getElementById('toggle-add-api-key-btn') as HTMLButtonElement;
    this.apiKeyNameInput = document.getElementById('api-key-name-input') as HTMLInputElement;
    this.apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
    this.apiKeyEndpointInput = document.getElementById('api-key-endpoint-input') as HTMLInputElement;
    this.apiKeyListContainer = document.getElementById('api-key-list-container')!;
    
    this.dataMemoryToggle = document.getElementById('data-memory-toggle') as HTMLInputElement;
    this.dataMemoryDisplayWrapper = document.getElementById('data-memory-display-wrapper')!;
    this.dataMemoryJsonTextarea = document.getElementById('data-memory-json') as HTMLTextAreaElement;
    this.saveMemoryBtn = document.getElementById('save-memory-btn') as HTMLButtonElement;

    this.autoAdvanceToggle = document.getElementById('auto-advance-toggle') as HTMLInputElement;
    this.autoAdvanceControls = document.getElementById('auto-advance-controls')!;
    this.autoAdvancePromptInput = document.getElementById('auto-advance-prompt-input') as HTMLTextAreaElement;
    this.autoAdvanceBtn = document.getElementById('auto-advance-btn') as HTMLButtonElement;
    this.autoRetryToggle = document.getElementById('auto-retry-toggle') as HTMLInputElement;

    this.addReplacementBtn = document.getElementById('add-replacement-btn') as HTMLButtonElement;
    this.replacementsList = document.getElementById('replacements-list') as HTMLElement;

    this.importPresetInput = document.getElementById('import-preset-input') as HTMLInputElement;
    this.importPresetBtn = document.getElementById('import-preset-btn') as HTMLButtonElement;
    this.presetManagerList = document.getElementById('preset-manager-list')!;
    this.presetSettingListView = document.getElementById('preset-manager-list-view')!;
    this.presetSettingSettingsView = document.getElementById('preset-manager-settings-view')!;
    this.closePresetSettingBtn = document.getElementById('close-preset-setting-btn')!;
    this.presetSettingTitle = document.getElementById('preset-setting-title')!;
    this.presetSettingPromptList = document.getElementById('preset-setting-prompt-list')!;
    this.applyPresetBtn = document.getElementById('apply-preset-btn') as HTMLButtonElement;
    this.deletePresetBtn = document.getElementById('delete-preset-btn') as HTMLButtonElement;

    this.exportDataBtn = document.getElementById('export-data-btn') as HTMLButtonElement;
    this.importDataBtn = document.getElementById('import-data-btn') as HTMLButtonElement;
    this.importDataInput = document.getElementById('import-data-input') as HTMLInputElement;
    this.importAiStudioBtn = document.getElementById('import-ai-studio-btn') as HTMLButtonElement;
    this.importAiStudioInput = document.getElementById('import-ai-studio-input') as HTMLInputElement;

    this.boundCancelDeleteHandler = this.handleDocumentClickForCancel.bind(this);
    window.addEventListener('beforeunload', () => this.flushPendingSaves());
    this.bindGlobalErrorHandlers();
    this.initSocket();
    this.init();
  }

  private flushPendingSaves(): void {
      if (this.defaultSettingsSaveTimer) {
          clearTimeout(this.defaultSettingsSaveTimer);
          this.defaultSettingsSaveTimer = null;
          this.saveDefaultSettings();
      }
      if (this.replacementsSaveTimer) {
          this.saveReplacementsNow();
      }
      if (this.saveSessionsTimer) {
          clearTimeout(this.saveSessionsTimer);
          this.saveSessionsTimer = null;
          this.saveSessionsNow();
      }
  }

  private initSocket(): void {
      this.socket = io({ reconnectionDelayMax: 30_000, timeout: 5_000 });

      this.socket.on("connect", () => {
          if (this.syncConnectionNoticeShown && !this.syncReconnectNoticeShown) {
              this.appendSystemNotification('局域网同步已重新连接。');
              this.syncReconnectNoticeShown = true;
          }
          this.syncConnectionNoticeShown = false;
      });

      this.socket.on("connect_error", (error) => {
          this.reportSyncError(error, '局域网同步连接失败');
      });

      this.socket.on("disconnect", (reason) => {
          if (reason !== 'io client disconnect') {
              this.reportSyncError(new Error(reason), '局域网同步已断开', 'warning');
          }
      });

      this.socket.on("sync_init", async (serverState: Record<string, string>) => {
          try {
          if (Object.keys(serverState).length === 0) {
              const payload = await this.createFullSyncPayload();
              if (Object.keys(payload).length > 0) { this.socket?.emit("sync_full", payload); }
          } else {
              await this.applySyncedState(serverState);
          }
          } catch (error) {
              this.isSyncingFromServer = false;
              this.reportSyncError(error, '同步初始化失败');
          }
      });

      this.socket.on("sync_full", async (serverState: Record<string, string>) => {
          try {
              await this.applySyncedState(serverState);
          } catch (error) {
              this.isSyncingFromServer = false;
              this.reportSyncError(error, '同步全量更新失败');
          }
      });

      this.socket.on("sync_update", async (data: { key: string, value: string }) => {
          try {
              this.isSyncingFromServer = true;
              if (data.key === 'sessions') {
                  if (data.value === null) {
                      await localforage.removeItem(data.key);
                  } else {
                      await localforage.setItem(data.key, JSON.parse(data.value));
                  }
              } else {
                  if (data.value === null) {
                      localStorage.removeItem(data.key);
                  } else {
                      localStorage.setItem(data.key, data.value);
                  }
              }
              this.loadLightweightState();
              await this.loadSessionsState();
              this.renderAll();
              this.initializeChat();
              this.isSyncingFromServer = false;
          } catch (error) {
              this.isSyncingFromServer = false;
              this.reportSyncError(error, '同步更新失败');
          }
      });
  }

  private async createFullSyncPayload(): Promise<Record<string, string>> {
      const payload: Record<string, string> = {};
      SYNC_LOCAL_STORAGE_KEYS.forEach((key) => {
          const value = localStorage.getItem(key);
          if (value !== null) payload[key] = value;
      });

      const sessions = await localforage.getItem('sessions');
      if (sessions && Object.keys(sessions as Record<string, Session>).length > 0) {
          payload.sessions = JSON.stringify(sessions);
      }

      return payload;
  }

  private async applySyncedState(serverState: Record<string, string | null>): Promise<void> {
      this.isSyncingFromServer = true;
      for (const [key, value] of Object.entries(serverState)) {
          if (key === 'sessions') {
              if (value === null || value === '') {
                  await localforage.removeItem('sessions');
              } else {
                  await localforage.setItem('sessions', JSON.parse(value || '{}'));
              }
          } else if (value === null) {
              localStorage.removeItem(key);
          } else {
              localStorage.setItem(key, value);
          }
      }
      this.loadLightweightState();
      await this.loadSessionsState();
      this.renderAll();
      this.initializeChat();
      this.isSyncingFromServer = false;
  }

  private reportSyncError(error: unknown, context: string, severity: ErrorSeverity = 'error'): void {
      const now = Date.now();
      const report = this.recordError(error, context, severity);
      if (!this.syncConnectionNoticeShown) {
          this.appendSystemNotification(`${context}：${report.message}`);
          this.syncConnectionNoticeShown = true;
          this.syncReconnectNoticeShown = false;
          this.lastSyncErrorAt = now;
      }
  }

  private clampNumber(value: number, min: number, max: number): number {
      return Math.min(max, Math.max(min, value));
  }

  private normalizeNumberInput(value: string, fallback: number, min: number, max: number, precision?: number): string {
      let parsedValue = Number.parseFloat(value);
      if (Number.isNaN(parsedValue)) parsedValue = fallback;
      parsedValue = this.clampNumber(parsedValue, min, max);
      if (precision !== undefined) parsedValue = Number.parseFloat(parsedValue.toFixed(precision));
      return parsedValue.toString();
  }

  private parseNumberOrDefault(value: string, fallback: number): number {
      const parsedValue = Number.parseFloat(value);
      return Number.isNaN(parsedValue) ? fallback : parsedValue;
  }

  private bindRangeInputPair(
      slider: HTMLInputElement,
      input: HTMLInputElement,
      options: { min: number; max: number; fallback: number; precision?: number; onInput?: () => void; onCommit?: () => void }
  ): void {
      const syncFromSlider = () => {
          input.value = slider.value;
          options.onInput?.();
      };
      const syncFromInput = () => {
          const parsedValue = Number.parseFloat(input.value);
          if (!Number.isNaN(parsedValue)) {
              slider.value = this.clampNumber(parsedValue, options.min, options.max).toString();
              options.onInput?.();
          }
      };
      const commitInput = () => {
          input.value = this.normalizeNumberInput(input.value, options.fallback, options.min, options.max, options.precision);
          slider.value = input.value;
          options.onInput?.();
          options.onCommit?.();
      };

      slider.addEventListener('input', syncFromSlider);
      input.addEventListener('input', syncFromInput);
      input.addEventListener('change', commitInput);
      input.addEventListener('blur', commitInput);
  }

  private handleGlobalKeydown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'TEXTAREA' && !this.isSubmittingMessage && !this.isAutoAdvanceRunning) return;

      if (this.isSubmittingMessage || this.isAutoAdvanceRunning || this.activeAbortController) {
          event.preventDefault();
          this.handleCancel();
          return;
      }

      if (this.modelPresetModal.classList.contains('visible')) {
          event.preventDefault();
          this.closeModelPresetModal();
          return;
      }

      if (this.newSessionModal.classList.contains('visible')) {
          event.preventDefault();
          this.hideNewSessionModal();
          return;
      }

      if (this.settingsSidebar.classList.contains('is-open')) {
          event.preventDefault();
          this.closeSettingsSidebar();
      }
  }
  
  private async init(): Promise<void> {
    const loadingOverlay = document.getElementById('loading-overlay')!;
    try {
      this.loadLightweightState();
      this.bindEvents();

      await this.loadSessionsState();

      this.renderAll();
      this.initializeChat();

      if (this.apiKeys.length === 0 || !this.activeApiKeyName) {
        this.openSettingsSidebar('api-keys-pane');
        this.appendMessage('欢迎！请在侧边栏的 "API密钥" 中添加并激活一个API密钥以开始使用。', 'ai');
      } else if (Object.keys(this.sessions).length === 0) {
        this.showNewSessionModal();
      }
    } catch (error) {
      const report = this.recordError(error, '应用初始化', 'critical');
      this.appendMessage(this.formatErrorForUser(report), 'error');
    } finally {
      loadingOverlay.classList.remove('is-visible');
    }
  }

  private bindEvents(): void {
    this.form.addEventListener('submit', this.handleSubmit.bind(this));
    this.cancelButton.addEventListener('click', this.handleCancel.bind(this));
    this.chatContainer.addEventListener('scroll', this.handleChatScroll.bind(this));
    
    this.input.addEventListener('input', () => {
        this.autoGrowTextarea();
        this.updateRegenerateCapability();
    });
    this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            if (e.isComposing) return; // Prevent IME composition from submitting
            e.preventDefault();
            if (!this.isSubmittingMessage && !this.submitButton.disabled && this.submitButton.style.display !== 'none') {
                this.form.requestSubmit();
            }
        }
    });
    document.addEventListener('keydown', this.handleGlobalKeydown.bind(this));

    // Sidebar events
    this.settingsBtn.addEventListener('click', () => this.openSettingsSidebar());
    this.newChatBtn.addEventListener('click', () => this.showNewSessionModal());
    this.closeSidebarBtn.addEventListener('click', () => this.closeSettingsSidebar());
    this.sidebarBackdrop.addEventListener('click', () => this.closeSettingsSidebar());
    
    // New Session Modal Events
    this.newSessionForm.addEventListener('submit', this.handleCreateNewSession.bind(this));

    this.navButtons.forEach(button => {
        button.addEventListener('click', () => {
            const paneId = button.dataset.pane;
            if (paneId) this.switchPane(paneId);
        });
    });

    // --- Settings & Forms ---
    
    // API Key Form
    this.toggleAddApiKeyBtn.addEventListener('click', () => {
        const isHidden = this.addApiKeyForm.style.display === 'none';
        if (!isHidden && this.addApiKeyForm.dataset.originalName) {
            delete this.addApiKeyForm.dataset.originalName;
            this.addApiKeyForm.reset();
            this.toggleAddApiKeyBtn.textContent = '添加新密钥';
            this.addApiKeyForm.style.display = 'none';
            return;
        }
        this.addApiKeyForm.style.display = isHidden ? 'block' : 'none';
        if (isHidden) this.apiKeyNameInput.focus();
    });
    this.addApiKeyForm.addEventListener('submit', this.handleAddApiKey.bind(this));

    this.systemPromptLabel.addEventListener('click', this.handleSystemPromptClick.bind(this));

    // Chat Settings (Auto-saving)
    this.systemPromptInput.addEventListener('input', this.debouncedSettingsUpdate.bind(this));
    
    this.modelPresetSelect.addEventListener('change', () => {
        this.activeModelPresetId = this.modelPresetSelect.value;
        this.applySelectedModelPreset();
    });

    this.editModelPresetBtn.addEventListener('click', () => {
        this.openModelPresetModal(this.activeModelPresetId);
    });

    this.closeModelPresetModalBtn.addEventListener('click', () => {
        this.closeModelPresetModal();
    });

    this.attachFileBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', this.handleFileAttachments.bind(this));
    this.input.addEventListener('paste', this.handlePaste.bind(this));
    
    // Drag and drop for chat container
    this.chatContainer.addEventListener('dragover', (e) => { e.preventDefault(); this.chatContainer.style.background = 'var(--background-light)'; });
    this.chatContainer.addEventListener('dragleave', (e) => { e.preventDefault(); this.chatContainer.style.background = ''; });
    this.chatContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        this.chatContainer.style.background = '';
        if (e.dataTransfer && e.dataTransfer.files) {
            this.handleFiles(e.dataTransfer.files);
        }
    });

    this.modelPresetModal.addEventListener('click', (e) => {
        if (e.target === this.modelPresetModal) {
            this.closeModelPresetModal();
        }
    });

    this.importPresetBtn.addEventListener('click', () => this.importPresetInput.click());
    this.importPresetInput.addEventListener('change', this.handleImportTavernPreset.bind(this));
    this.closePresetSettingBtn.addEventListener('click', () => this.closePresetSettingModal());
    this.applyPresetBtn.addEventListener('click', () => this.closePresetSettingModal());
    this.deletePresetBtn.addEventListener('click', () => this.handleDeleteTavernPreset());

    this.presetBindApiKeyToggle.addEventListener('change', () => {
        this.presetApiKeyContainer.style.display = this.presetBindApiKeyToggle.checked ? 'block' : 'none';
    });

    this.presetBindSettingsToggle.addEventListener('change', () => {
        this.presetSettingsContainer.style.display = this.presetBindSettingsToggle.checked ? 'block' : 'none';
    });
    
    this.presetAdvancedToggle.addEventListener('change', () => {
        this.presetAdvancedContainer.style.display = this.presetAdvancedToggle.checked ? 'block' : 'none';
    });
    this.presetUnofficialToggle.addEventListener('change', () => {
        this.presetUnofficialContainer.style.display = this.presetUnofficialToggle.checked ? 'block' : 'none';
    });
    
    this.bindRangeInputPair(this.presetTopKSlider, this.presetTopKInput, { min: 0, max: 100, fallback: 0 });
    this.bindRangeInputPair(this.presetTopPSlider, this.presetTopPInput, {
        min: 0,
        max: 1,
        fallback: 1,
        precision: 2,
        onInput: () => {
            if (this.parseNumberOrDefault(this.presetTopPInput.value, 1) !== 1) {
                this.presetMinPInput.value = '0';
                this.presetMinPSlider.value = '0';
            }
        },
    });
    this.bindRangeInputPair(this.presetMinPSlider, this.presetMinPInput, {
        min: 0,
        max: 1,
        fallback: 0,
        precision: 2,
        onInput: () => {
            if (this.parseNumberOrDefault(this.presetMinPInput.value, 0) !== 0) {
                this.presetTopPInput.value = '1';
                this.presetTopPSlider.value = '1';
            }
        },
    });
    this.bindRangeInputPair(this.presetFrequencyPenaltySlider, this.presetFrequencyPenaltyInput, { min: 0, max: 2, fallback: 0, precision: 2 });
    this.bindRangeInputPair(this.presetPresencePenaltySlider, this.presetPresencePenaltyInput, { min: 0, max: 2, fallback: 0, precision: 2 });
    this.bindRangeInputPair(this.presetDryPenaltySlider, this.presetDryPenaltyInput, { min: 0, max: 5, fallback: 0, precision: 2 });
    this.bindRangeInputPair(this.presetExcludeTopSlider, this.presetExcludeTopInput, { min: 0, max: 20, fallback: 0 });
    this.bindRangeInputPair(this.presetContextLengthSlider, this.presetContextLengthInput, { min: 0, max: 9999999, fallback: 0 });
    this.bindRangeInputPair(this.presetMaxResponseSlider, this.presetMaxResponseInput, { min: 0, max: 9999999, fallback: 0 });

    this.modelPresetForm.addEventListener('input', this.debouncedSaveModelPreset.bind(this));
    this.modelPresetForm.addEventListener('change', this.debouncedSaveModelPreset.bind(this));
    this.modelPresetForm.addEventListener('submit', (e) => e.preventDefault());
    this.modalCreatePresetBtn.addEventListener('click', () => {
        const id = 'preset_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const newPreset: ModelPreset = {
            id,
            name: '新预设_' + Math.floor(Math.random() * 1000),
            modelName: 'gemini-2.5-pro',
            isImageModel: false,
            useAssociatedApiKey: false,
            associatedApiKeyName: '',
            useAssociatedSettings: false,
            contextLength: 0,
            maxResponseLength: 0,
            isStreaming: false,
            isShowCoTEnabled: true,
            topK: 0,
            topP: 1,
            frequencyPenalty: 0,
            presencePenalty: 0,
            minP: 0,
            dryRepetitionPenalty: 0,
            excludeTopChoices: 0
        };
        this.modelPresets.push(newPreset);
        this.saveModelPresets();
        this.editingModelPresetId = id;
        if (!this.activeModelPresetId) this.activeModelPresetId = id;
        this.renderModelPresets();
    });
    
    this.continuousOutputToggle.addEventListener('change', () => {
        this.isContinuousOutputEnabled = this.continuousOutputToggle.checked;
        this.debouncedSettingsUpdate();
    });

    this.streamingToggle.addEventListener('change', this.debouncedSettingsUpdate.bind(this));
    this.showCoTToggle.addEventListener('change', this.debouncedSettingsUpdate.bind(this));

    this.bindRangeInputPair(this.temperatureSlider, this.temperatureInputBox, {
        min: 0,
        max: 2,
        fallback: 1,
        precision: 2,
        onInput: () => this.debouncedSettingsUpdate(),
        onCommit: () => this.debouncedSettingsUpdate(),
    });
    
    // Data Memory Events
    this.dataMemoryToggle.addEventListener('change', this.handleDataMemoryToggle.bind(this));
    this.saveMemoryBtn.addEventListener('click', this.handleSaveMemory.bind(this));

    // Accessibility Events
    this.autoAdvanceToggle.addEventListener('change', this.handleAutoAdvanceToggle.bind(this));
    this.autoAdvanceBtn.addEventListener('click', this.handleAutoAdvanceButtonClick.bind(this));
    this.autoAdvancePromptInput.addEventListener('input', () => {
        if (!this.activeSessionId) return;
        this.autoAdvancePrompt = this.autoAdvancePromptInput.value;
        this.sessions[this.activeSessionId].autoAdvancePrompt = this.autoAdvancePrompt;
        this.saveSessions();
    });
    this.autoRetryToggle.addEventListener('change', () => {
        if (!this.activeSessionId) return;
        this.isAutoRetryEnabled = this.autoRetryToggle.checked;
        this.sessions[this.activeSessionId].isAutoRetryEnabled = this.isAutoRetryEnabled;
        this.saveSessions();
    });

    this.addReplacementBtn.addEventListener('click', this.handleAddReplacement.bind(this));
      
    // Data Management Events
    this.exportDataBtn.addEventListener('click', this.handleExportData.bind(this));
    this.importDataBtn.addEventListener('click', () => this.importDataInput.click());
    this.importDataInput.addEventListener('change', this.handleImportData.bind(this));
    this.importAiStudioBtn.addEventListener('click', () => this.importAiStudioInput.click());
    this.importAiStudioInput.addEventListener('change', this.handleImportAiStudio.bind(this));
  }

  // --- State Management ---
  private loadLightweightState(): void {
      this.apiKeys = JSON.parse(localStorage.getItem('apiKeys') || '[]');
      this.activeApiKeyName = localStorage.getItem('activeApiKeyName');
      
      // Load global settings from local storage to be used as defaults for new sessions
      this.systemInstruction = '';
      this.temperature = parseFloat(localStorage.getItem('temperature_default') || '1.0');
      this.modelName = localStorage.getItem('modelName_default') || 'gemini-2.5-pro';
      this.contextLength = parseInt(localStorage.getItem('contextLength_default') || '0', 10);
      this.maxResponseLength = parseInt(localStorage.getItem('maxResponseLength_default') || '0', 10);
      this.isStreaming = localStorage.getItem('isStreaming_default') === 'true';
      this.isShowCoTEnabled = localStorage.getItem('isShowCoTEnabled_default') !== 'false';
      this.isContinuousOutputEnabled = localStorage.getItem('isContinuousOutputEnabled_default') === 'true';
      this.isDataMemoryEnabled = false;
      this.isAutoAdvanceEnabled = localStorage.getItem('isAutoAdvanceEnabled_default') === 'true';
      this.autoAdvancePrompt = localStorage.getItem('autoAdvancePrompt_default') || '继续';
      this.isAutoRetryEnabled = localStorage.getItem('isAutoRetryEnabled_default') === 'true';

      this.isAutoAdvanceRunning = false; // Always start as not running
      
      const rawPresets = JSON.parse(localStorage.getItem('modelPresets') || '[]');
      this.modelPresets = rawPresets.map((p: any) => {
          if (typeof p === 'string') {
              return {
                  id: 'preset_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                  name: p,
                  modelName: p,
                  isImageModel: false,
                  useAssociatedApiKey: false,
                  associatedApiKeyName: '',
                  useAssociatedSettings: false,
                  temperature: 1.0,
                  contextLength: 0,
                  maxResponseLength: 0,
                  isStreaming: false,
                  isShowCoTEnabled: true
              } as ModelPreset;
          }
          return p;
      }).filter((p: ModelPreset) => p.name !== '默认 Gemini 预设');
      
      this.activeModelPresetId = localStorage.getItem('activeModelPresetId') || "";

      if (!this.modelPresets.find(p => p.id === this.activeModelPresetId)) {
          this.activeModelPresetId = this.modelPresets.length > 0 ? this.modelPresets[0].id : "";
      }

      this.tavernPresets = JSON.parse(localStorage.getItem('tavernPresets') || '[]');
      this.tavernPresets.forEach(preset => this.getPresetPrompts(preset));
      this.activeTavernPresetId = localStorage.getItem('activeTavernPresetId');
      
      this.contentReplacements = JSON.parse(localStorage.getItem('contentReplacements') || '[]');
  }
  
  private async loadSessionsState(): Promise<void> {
      const lsSessions = localStorage.getItem('sessions');
      if (lsSessions && lsSessions !== '{}') {
          try {
              this.sessions = JSON.parse(lsSessions);
              await localforage.setItem('sessions', this.sessions);
              localStorage.removeItem('sessions');
          } catch(e) {
              this.sessions = (await localforage.getItem('sessions')) as Record<string, Session> || {};
          }
      } else {
          this.sessions = (await localforage.getItem('sessions')) as Record<string, Session> || {};
      }
      
      // Migration logic for per-session settings
      Object.values(this.sessions).forEach(session => {
          if (!session.dataMemory) session.dataMemory = {};
          if (session.systemInstruction === undefined) session.systemInstruction = this.systemInstruction;
          if (session.temperature === undefined) session.temperature = this.temperature;
          if (session.modelName === undefined) session.modelName = this.modelName;
          if (session.contextLength === undefined) session.contextLength = this.contextLength;
          if (session.maxResponseLength === undefined) session.maxResponseLength = this.maxResponseLength;
          if (session.isStreaming === undefined) session.isStreaming = this.isStreaming;
          if (session.isShowCoTEnabled === undefined) session.isShowCoTEnabled = this.isShowCoTEnabled;
          if (session.isContinuousOutputEnabled === undefined) session.isContinuousOutputEnabled = this.isContinuousOutputEnabled;
          if (session.isDataMemoryEnabled === undefined) session.isDataMemoryEnabled = false;
          if (session.isAutoAdvanceEnabled === undefined) session.isAutoAdvanceEnabled = this.isAutoAdvanceEnabled;
          if (session.autoAdvancePrompt === undefined) session.autoAdvancePrompt = this.autoAdvancePrompt;
          if (session.isAutoRetryEnabled === undefined) session.isAutoRetryEnabled = this.isAutoRetryEnabled;
      });

      this.activeSessionId = localStorage.getItem('activeSessionId');
      if (this.activeSessionId && !this.sessions[this.activeSessionId]) {
          this.activeSessionId = null;
      }
      if (!this.activeSessionId && Object.keys(this.sessions).length > 0) {
          this.activeSessionId = Object.values(this.sessions).sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0].id;
      }
      
      if (this.activeSessionId) {
          this.loadSettingsFromSession(this.activeSessionId);
      }
  }

  private loadSettingsFromSession(sessionId: string): void {
      const session = this.sessions[sessionId];
      if (!session) return;
      
      this.systemInstruction = session.systemInstruction ?? '';
      this.temperature = session.temperature ?? 1.0;
      this.modelName = session.modelName ?? 'gemini-2.5-pro';
      this.contextLength = session.contextLength ?? 0;
      this.maxResponseLength = session.maxResponseLength ?? 0;
      this.isStreaming = session.isStreaming ?? false;
      this.isShowCoTEnabled = session.isShowCoTEnabled ?? true;
      this.isContinuousOutputEnabled = session.isContinuousOutputEnabled ?? false;
      this.isDataMemoryEnabled = session.isDataMemoryEnabled ?? false;
      this.isAutoAdvanceEnabled = session.isAutoAdvanceEnabled ?? false;
      this.autoAdvancePrompt = session.autoAdvancePrompt ?? '继续';
      this.isAutoRetryEnabled = session.isAutoRetryEnabled ?? false;
  }

  private emitSync(key: string, value: string | null) {
      if (this.isSyncingFromServer) return;
      if (!this.socket?.connected) return;
      this.socket?.emit("sync_update", { key, value });
  }

  private saveApiKeys(): void { 
      const val = JSON.stringify(this.apiKeys);
      localStorage.setItem('apiKeys', val); 
      this.emitSync('apiKeys', val);
  }
  private saveActiveApiKeyName(): void {
    if (this.activeApiKeyName) { 
        localStorage.setItem('activeApiKeyName', this.activeApiKeyName); 
        this.emitSync('activeApiKeyName', this.activeApiKeyName);
    } 
    else { 
        localStorage.removeItem('activeApiKeyName'); 
        this.emitSync('activeApiKeyName', null);
    }
  }
  private saveDefaultSettings(): void {
    // Save current settings as the new defaults for future sessions
    // systemInstruction is NOT saved as a default, to ensure complete independence between sessions
    localStorage.setItem('temperature_default', this.temperature.toString());
    this.emitSync('temperature_default', this.temperature.toString());
    localStorage.setItem('modelName_default', this.modelName);
    this.emitSync('modelName_default', this.modelName);
    localStorage.setItem('contextLength_default', this.contextLength.toString());
    this.emitSync('contextLength_default', this.contextLength.toString());
    localStorage.setItem('maxResponseLength_default', this.maxResponseLength.toString());
    this.emitSync('maxResponseLength_default', this.maxResponseLength.toString());
    localStorage.setItem('isStreaming_default', this.isStreaming.toString());
    this.emitSync('isStreaming_default', this.isStreaming.toString());
    localStorage.setItem('isShowCoTEnabled_default', this.isShowCoTEnabled.toString());
    this.emitSync('isShowCoTEnabled_default', this.isShowCoTEnabled.toString());
    localStorage.setItem('isContinuousOutputEnabled_default', this.isContinuousOutputEnabled.toString());
    this.emitSync('isContinuousOutputEnabled_default', this.isContinuousOutputEnabled.toString());
    localStorage.setItem('isAutoAdvanceEnabled_default', this.isAutoAdvanceEnabled.toString());
    this.emitSync('isAutoAdvanceEnabled_default', this.isAutoAdvanceEnabled.toString());
    localStorage.setItem('autoAdvancePrompt_default', this.autoAdvancePrompt);
    this.emitSync('autoAdvancePrompt_default', this.autoAdvancePrompt);
    localStorage.setItem('isAutoRetryEnabled_default', this.isAutoRetryEnabled.toString());
    this.emitSync('isAutoRetryEnabled_default', this.isAutoRetryEnabled.toString());
  }

  private saveDefaultSettingsDebounced(): void {
      if (this.defaultSettingsSaveTimer) clearTimeout(this.defaultSettingsSaveTimer);
      this.defaultSettingsSaveTimer = window.setTimeout(() => {
          this.saveDefaultSettings();
          this.defaultSettingsSaveTimer = null;
      }, 300);
  }

  private saveSessionsTimer: number | null = null;
  private saveSessions(immediate = false): void { 
      if (this.saveSessionsTimer) {
          clearTimeout(this.saveSessionsTimer);
      }
      const doSave = async () => {
          this.saveSessionsTimer = null;
          await this.saveSessionsNow();
      };

      if (immediate) {
          doSave();
      } else {
          this.saveSessionsTimer = window.setTimeout(doSave, 800);
      }
  }

  private async saveSessionsNow(): Promise<void> {
          await localforage.setItem('sessions', this.sessions);
          if (this.socket?.connected && !this.isSyncingFromServer) {
              const workerCode = `
                  self.addEventListener('message', function(e) {
                      try {
                          var result = JSON.stringify(e.data);
                          self.postMessage({str: result});
                      } catch(err) { self.postMessage({str: null}); } 
                  });
              `;
              const blob = new Blob([workerCode], {type: "application/javascript"});
              const worker = new Worker(URL.createObjectURL(blob));
              worker.onmessage = (e) => {
                  if (e.data.str) {
                      this.socket?.emit("sync_update", { key: 'sessions', value: e.data.str });
                  }
                  worker.terminate();
              };
              worker.postMessage(this.sessions);
          }
  }
  private saveActiveSessionId(): void {
    if (this.activeSessionId) { 
        localStorage.setItem('activeSessionId', this.activeSessionId); 
        this.emitSync('activeSessionId', this.activeSessionId);
    }
    else { 
        localStorage.removeItem('activeSessionId'); 
        this.emitSync('activeSessionId', null);
    }
  }

  private supportsGoogleThinkingConfig(modelName: string): boolean {
    return (/^gemini-2\.5-(flash|pro)/.test(modelName) && !/-image(-preview)?$/.test(modelName)) || /^gemini-3[.\d]*-(flash|pro)/.test(modelName);
  }

  private buildGoogleGenerationConfig(systemInstruction: string): any {
    const modelName = this.modelName || 'gemini-2.5-pro';
    const config: any = {
      temperature: this.temperature,
      systemInstruction,
      maxOutputTokens: this.maxResponseLength > 0 ? this.maxResponseLength : 65536,
    };

    if (this.supportsGoogleThinkingConfig(modelName)) {
      config.thinkingConfig = { thinkingBudget: 32768 };
    }

    if (this.topK !== undefined && this.topK !== null && this.topK !== 0) config.topK = this.topK;
    if (this.topP !== undefined && this.topP !== null && this.topP !== 1) config.topP = this.topP;
    if (this.frequencyPenalty !== undefined && this.frequencyPenalty !== null && this.frequencyPenalty !== 0) config.frequencyPenalty = this.frequencyPenalty;
    if (this.presencePenalty !== undefined && this.presencePenalty !== null && this.presencePenalty !== 0) config.presencePenalty = this.presencePenalty;
    if (this.minP !== undefined && this.minP !== null && this.minP !== 0) config.minP = this.minP;
    if (this.dryRepetitionPenalty !== undefined && this.dryRepetitionPenalty !== null && this.dryRepetitionPenalty !== 0) config.dryRepetitionPenalty = this.dryRepetitionPenalty;
    if (this.excludeTopChoices !== undefined && this.excludeTopChoices !== null && this.excludeTopChoices !== 0) config.excludeTopChoices = this.excludeTopChoices;

    return config;
  }

  private extractOpenAICompatibleError(data: any, fallback: string): string {
    if (!data) return fallback;
    const requestId = data.error?.requestId ? `（代理请求编号：${data.error.requestId}）` : '';
    if (typeof data.error === 'string') return `${data.error}${requestId}`;
    if (data.error?.message) return `${data.error.message}${requestId}`;
    if (data.message) return data.message;
    return fallback;
  }

  private parseOpenAICompatibleMessage(data: any): { content: string; reasoning: string } {
    const message = data?.choices?.[0]?.message;
    if (!message) {
      throw new Error(this.extractOpenAICompatibleError(data, '未知的 API 响应格式'));
    }

    return {
      content: typeof message.content === 'string' ? message.content : '',
      reasoning: typeof message.reasoning_content === 'string' ? message.reasoning_content : '',
    };
  }

  private readOpenAICompatibleDelta(data: any): { content: string; reasoning: string } {
    const delta = data?.choices?.[0]?.delta || {};
    return {
      content: typeof delta.content === 'string' ? delta.content : '',
      reasoning: typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '',
    };
  }

  private normalizeApiKey(apiKey: string): string {
    return apiKey
      .trim()
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/^Bearer\s+/i, '')
      .trim();
  }

  private buildAuthorizationHeader(apiKey: string): string {
    const normalizedKey = this.normalizeApiKey(apiKey);
    if (!/^[\x21-\x7E]+$/.test(normalizedKey)) {
      throw new Error('API 密钥包含空格、换行、中文或其它非法字符，请只填写纯密钥，例如 meow_7IVbAfcdCrZVy-GxhIFAI2d5EBemgD6N。');
    }
    return `Bearer ${normalizedKey}`;
  }

  private buildOpenAICompatibleChatUrl(endpoint: string): string {
    const rawEndpoint = endpoint.trim();
    const parsedUrl = new URL(rawEndpoint);
    const path = parsedUrl.pathname.replace(/\/+$/, '');
    const lowerPath = path.toLowerCase();

    if (!path || path === '/') {
      parsedUrl.pathname = '/v1/chat/completions';
    } else if (lowerPath === '/v1') {
      parsedUrl.pathname = `${path}/chat/completions`;
    } else if (lowerPath.endsWith('/v1')) {
      parsedUrl.pathname = `${path}/chat/completions`;
    } else if (lowerPath.endsWith('/chat/completions') || lowerPath.endsWith('/completions')) {
      parsedUrl.pathname = path;
    } else {
      parsedUrl.pathname = path;
    }

    return parsedUrl.toString();
  }

  private isFetchNetworkError(error: unknown): boolean {
    return error instanceof TypeError && /Failed to fetch|fetch failed|NetworkError/i.test(error.message);
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error) || '发生未知错误。';
    } catch {
      return '发生未知错误。';
    }
  }

  private getErrorStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack : undefined;
  }

  private getErrorStatus(error: unknown): number | undefined {
    const status = (error as { status?: unknown; statusCode?: unknown })?.status ?? (error as { statusCode?: unknown })?.statusCode;
    return typeof status === 'number' ? status : undefined;
  }

  private createErrorReport(error: unknown, context: string, severity: ErrorSeverity = 'error'): ErrorReport {
    const technicalMessage = this.getErrorMessage(error);
    const normalizedMessage = this.normalizeRequestErrorMessage(error);
    const errorLike = error as { cause?: unknown } | null | undefined;
    return {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      time: new Date().toISOString(),
      context,
      severity,
      message: normalizedMessage,
      technicalMessage,
      stack: this.getErrorStack(error),
      status: this.getErrorStatus(error),
      cause: errorLike?.cause,
    };
  }

  private recordError(error: unknown, context: string, severity: ErrorSeverity = 'error'): ErrorReport {
    const report = this.createErrorReport(error, context, severity);
    this.errorReports.unshift(report);
    if (this.errorReports.length > this.maxErrorReports) {
      this.errorReports.length = this.maxErrorReports;
    }
    console.groupCollapsed(`[${report.severity.toUpperCase()}] ${report.context}: ${report.message}`);
    console.error(error);
    console.info('Error report:', report);
    console.groupEnd();
    this.writeErrorReportToLog(report);
    return report;
  }

  private writeErrorReportToLog(report: ErrorReport): void {
    void fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        time: report.time,
        level: report.severity,
        context: report.context,
        message: report.message,
        technicalMessage: report.technicalMessage,
        stack: report.stack,
        status: report.status,
        requestId: report.id,
        source: 'client',
      }),
    }).catch((logError) => {
      console.warn('Failed to write client error log:', logError);
    });
  }

  private formatErrorForUser(report: ErrorReport, includeHint: boolean = true): string {
    const hint = includeHint ? `\n错误编号：${report.id}。详细信息已写入 logs/app.log 和浏览器控制台。` : '';
    return `错误: ${report.message}${hint}`;
  }

  private bindGlobalErrorHandlers(): void {
    window.addEventListener('error', (event) => {
      const report = this.recordError(event.error || event.message, '全局脚本错误', 'critical');
      this.appendMessage(this.formatErrorForUser(report), 'error');
    });

    window.addEventListener('unhandledrejection', (event) => {
      const report = this.recordError(event.reason, '未处理的异步错误', 'critical');
      this.appendMessage(this.formatErrorForUser(report), 'error');
    });
  }

  private normalizeRequestErrorMessage(error: unknown): string {
    const rawMessage = this.getErrorMessage(error);
    const status = this.getErrorStatus(error);
    if (status === 400) {
      return `请求参数错误（400）：${rawMessage}`;
    }
    if (status === 403) {
      return '访问被拒绝（403）：请检查密钥权限、模型权限或服务商额度策略。';
    }
    if (status === 408 || status === 504 || /timeout|timed out|aborted/i.test(rawMessage)) {
      return '请求超时或已中断：请稍后重试，或检查代理/端点是否响应过慢。';
    }
    if (status === 429 || /rate limit|RESOURCE_EXHAUSTED|quota/i.test(rawMessage)) {
      return 'API 速率限制或额度不足（429/quota）：请稍后重试、降低频率，或切换可用密钥。';
    }
    if (status && status >= 500) {
      return `服务端错误（${status}）：上游服务暂时不可用，请稍后重试。`;
    }
    if (/API key not valid|INVALID_API_KEY|invalid api key|incorrect api key|unauthorized|401/i.test(rawMessage)) {
      return 'API 密钥无效或无权限：请确认当前密钥属于所选端点/模型，且密钥只填写纯文本本体（例如 meow_...，不要加 Bearer）。';
    }
    if (/not found|404/i.test(rawMessage)) {
      return '接口地址不存在（not found）：请检查自定义端点。若填写的是基础地址请用 https://域名/v1；若服务商给的是完整接口地址，请直接填写完整的 /chat/completions 地址。';
    }
    if (/Invalid URL/i.test(rawMessage)) {
      return '自定义端点地址格式无效，请填写完整地址，例如 https://api.example.com/v1。';
    }
    if (/Failed to fetch|fetch failed|NetworkError/i.test(rawMessage)) {
      return this.isCustomEndpoint
        ? '网络连接失败：无法连接到自定义 API 端点或本地代理。请检查服务地址、端口、协议以及 CORS/防火墙设置。'
        : '网络连接失败，请检查您的设备是否已连接到互联网 (Network connection failed)。';
    }
    return rawMessage;
  }

  private async throwOpenAICompatibleHttpError(response: Response): Promise<never> {
    let message = `HTTP error! status: ${response.status}`;
    try {
      const text = await response.text();
      if (text) {
        try {
          message = this.extractOpenAICompatibleError(JSON.parse(text), message);
        } catch {
          message = `${message}: ${text.slice(0, 500)}`;
        }
      }
    } catch {
      // Keep the status-only message when the body cannot be read.
    }

    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  // --- Chat Initialization ---
  private initializeChat(): void {
    const activeKey = this.apiKeys.find(k => k.name === this.activeApiKeyName);
    if (!activeKey) {
      this.ai = null;
      this.chat = null;
      this.isCustomEndpoint = false;
      this.setFormState(true, '请在设置中激活一个API密钥');
      return;
    }
    if (!this.activeSessionId || !this.sessions[this.activeSessionId]) {
        this.setFormState(true, '请创建或选择一个会话');
        return;
    }

    if (activeKey.endpoint) {
        this.isCustomEndpoint = true;
        this.ai = null;
        this.chat = null;
        this.setFormState(false);
        return;
    }

    this.isCustomEndpoint = false;
    try {
      this.ai = new GoogleGenAI({ apiKey: activeKey.key.trim() });
      const activeSession = this.sessions[this.activeSessionId];
      let userSystemInstruction = (activeSession.systemInstruction || '').trim();
      const tavernPrompts = this.compileTavernPrompts();
      if (tavernPrompts) {
          userSystemInstruction += (userSystemInstruction ? '\n\n' : '') + tavernPrompts;
      }
      
      const config = this.buildGoogleGenerationConfig(userSystemInstruction);

      let initialHistory = this.sessions[this.activeSessionId].history;
      if (this.contextLength > 0) {
          initialHistory = initialHistory.slice(-this.contextLength);
      }
      
      // Sanitize history to alternate strictly and ensure no consecutive identical roles
      const sanitizedHistory: Content[] = [];
      for (const msg of initialHistory) {
          const hasContent = msg.parts.some(p => (p.text !== undefined && p.text.trim() !== '') || p.inlineData);
          if (!hasContent) continue;

          const role = msg.role === 'model' ? 'model' : 'user';
          if (sanitizedHistory.length === 0 || sanitizedHistory[sanitizedHistory.length - 1].role !== role) {
              sanitizedHistory.push({ role, parts: [...msg.parts] });
          } else {
              // Combine consecutive messages of the same role
              const prev = sanitizedHistory[sanitizedHistory.length - 1];
              const t1 = prev.parts[0]?.text || '';
              const t2 = msg.parts[0]?.text || '';
              prev.parts[0].text = t1 + (t1 && t2 ? '\n\n' : '') + t2;
          }
      }
      
      // GoogleGenAI chat expects history to optionally end in a model message, 
      // but if it ends in user, we might get an error if we try to send *another* user message.
      // However, the SDK might handle a trailing user message if it's awaiting a reply, 
      // but to be safe, if we are initializing a chat that ended abruptly, we can let it be, 
      // as combining consecutive messages prevents the "consecutive user" crash.

      this.chat = this.ai.chats.create({
        model: this.modelName || 'gemini-2.5-pro',
        config: config,
        history: sanitizedHistory,
      });
      this.setFormState(false);
    } catch(error) {
        this.ai = null;
        this.chat = null;
        const errorMessage = error instanceof Error ? error.message : '无效的API密钥或配置。';
        this.appendMessage(`初始化错误: ${errorMessage}`, 'error', () => this.initializeChat());
        this.setFormState(true, '初始化失败，请检查密钥和设置');
    }
  }
  
  private saveModelPresets(): void {
      localStorage.setItem('modelPresets', JSON.stringify(this.modelPresets));
      localStorage.setItem('activeModelPresetId', this.activeModelPresetId);
      this.emitSync('modelPresets', JSON.stringify(this.modelPresets));
      this.emitSync('activeModelPresetId', this.activeModelPresetId);
  }

  private saveTavernPresetsState(): void {
      localStorage.setItem('tavernPresets', JSON.stringify(this.tavernPresets));
      if (this.activeTavernPresetId) {
          localStorage.setItem('activeTavernPresetId', this.activeTavernPresetId);
      } else {
          localStorage.removeItem('activeTavernPresetId');
      }
      this.emitSync('tavernPresets', JSON.stringify(this.tavernPresets));
      this.emitSync('activeTavernPresetId', this.activeTavernPresetId || '');
  }

  private compileTavernPrompts(): string {
      let combined = '';
      this.getEnabledTavernPromptEntries().forEach((p: any) => {
          combined += `\n\n--- [${p.name || 'Prompt'}] ---\n${p.content}`;
      });
      return combined;
  }

  private getEnabledTavernPromptEntries(): JailbreakPrompt[] {
      return this.tavernPresets
          .filter(preset => preset.enabledFile)
          .flatMap(preset => this.getPresetPrompts(preset))
          .filter((prompt: any) => prompt.enabled && prompt.content && prompt.content.trim() !== '');
  }

  private compileTavernPromptMessages(): { role: string; content: string }[] {
      return this.getEnabledTavernPromptEntries().map((prompt: any) => ({
          role: ['system', 'user', 'assistant'].includes(prompt.role) ? prompt.role : 'system',
          content: `--- [${prompt.name || 'Prompt'}] ---\n${prompt.content}`,
      }));
  }

  private normalizeRegexFlags(flags: string, fallback: string = 'gm'): string {
      const allowedFlags = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y']);
      const normalized = Array.from(new Set((flags || fallback).split('')))
          .filter(flag => allowedFlags.has(flag))
          .join('');
      return normalized.includes('g') ? normalized : normalized + 'g';
  }

  private isPlainMemoryObject(value: any): value is Record<string, any> {
      return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private sanitizeMemoryValue(value: any, depth: number = 0): any {
      if (depth > 8) return undefined;
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;

      if (Array.isArray(value)) {
          return value
              .slice(0, 100)
              .map(item => this.sanitizeMemoryValue(item, depth + 1))
              .filter(item => item !== undefined);
      }

      if (this.isPlainMemoryObject(value)) {
          const sanitized: Record<string, any> = {};
          Object.entries(value).slice(0, 100).forEach(([key, nestedValue]) => {
              if (!key || ['__proto__', 'constructor', 'prototype'].includes(key)) return;
              const sanitizedValue = this.sanitizeMemoryValue(nestedValue, depth + 1);
              if (sanitizedValue !== undefined) sanitized[key] = sanitizedValue;
          });
          return sanitized;
      }

      return undefined;
  }

  private sanitizeMemoryObject(value: any): Record<string, any> | null {
      if (!this.isPlainMemoryObject(value)) return null;
      const sanitized = this.sanitizeMemoryValue(value);
      if (!this.isPlainMemoryObject(sanitized)) return null;
      return JSON.stringify(sanitized).length <= 20000 ? sanitized : null;
  }

  private buildDataMemoryInstruction(memory: Record<string, any>): string {
      const memoryString = JSON.stringify(memory || {}, null, 2);
      return `\n\n# DATA MEMORY\nYou have a session-scoped JSON memory. Treat it as low-priority background context: use it only when directly relevant, and never mention these rules.\n\nCurrent Memory:\n${memoryString}\n\nMemory update policy:\n- Do NOT output a memory update during normal replies.\n- Only update memory when the user explicitly asks you to remember/change/delete something, or when the conversation contains a stable long-term fact that is clearly worth preserving.\n- Never rewrite, summarize, reorganize, or "improve" existing memory without a clear reason.\n- Never infer uncertain facts, temporary states, one-off preferences, or hidden thoughts.\n- If no update is needed, output no memory block at all.\n\nWhen an update is truly needed, append exactly one final block after your answer:\n\`\`\`json_memory\n{\"key\": \"value\"}\n\`\`\`\nThe block must contain only the minimal keys to add or change.`;
  }

  private deepMergeMemory(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
      const merged = { ...(target || {}) };
      Object.entries(source || {}).forEach(([key, value]) => {
          if (!key || ['__proto__', 'constructor', 'prototype'].includes(key)) return;
          const current = merged[key];
          if (
              value && typeof value === 'object' && !Array.isArray(value) &&
              current && typeof current === 'object' && !Array.isArray(current)
          ) {
              merged[key] = this.deepMergeMemory(current, value);
          } else {
              merged[key] = value;
          }
      });
      return merged;
  }

  private extractJsonMemoryBlock(text: string): { data: Record<string, any>; cleanedText: string } | null {
      const match = text.match(/(?:^|\n)```json_memory\s*\n?([\s\S]*?)\n?```\s*$/i);
      if (!match?.[1]) return null;

      try {
          const parsed = JSON.parse(match[1].trim());
          const sanitized = this.sanitizeMemoryObject(parsed);
          if (sanitized && Object.keys(sanitized).length > 0) {
              return { data: sanitized, cleanedText: text.slice(0, match.index).trim() };
          }
      } catch (error) {
          console.error('Failed to parse data memory JSON from AI response:', error);
      }

      return null;
  }

  private getPresetPrompts(preset: TavernPreset): JailbreakPrompt[] {
      if (Array.isArray(preset.prompts)) return preset.prompts;
      const normalized = this.normalizeTavernPreset(preset.originalJson);
      preset.prompts = normalized.prompts;
      preset.rawPromptCount = normalized.rawPromptCount;
      return preset.prompts;
  }

  private normalizeTavernPreset(json: any): { prompts: JailbreakPrompt[]; rawPromptCount: number } {
      const rawPrompts = Array.isArray(json?.prompts) ? json.prompts : [];
      const orderItems = this.getTavernPromptOrder(json);
      const promptById = new Map<string, any>();
      rawPrompts.forEach((prompt: any) => {
          if (prompt?.identifier) promptById.set(prompt.identifier, prompt);
      });

      const orderedPrompts: any[] = [];
      const usedIds = new Set<string>();
      orderItems.forEach((item: any) => {
          const prompt = promptById.get(item?.identifier);
          if (!prompt) return;
          orderedPrompts.push({ ...prompt, enabled: item.enabled !== false });
          usedIds.add(item.identifier);
      });

      rawPrompts.forEach((prompt: any) => {
          if (prompt?.identifier && usedIds.has(prompt.identifier)) return;
          orderedPrompts.push({ ...prompt, enabled: prompt.enabled === true });
      });

      orderedPrompts.forEach((prompt: any) => this.hydrateTavernPromptContent(prompt));

      return {
          prompts: orderedPrompts,
          rawPromptCount: rawPrompts.length,
      };
  }

  private getTavernPromptOrder(json: any): any[] {
      if (!Array.isArray(json?.prompt_order)) return [];
      const orders = json.prompt_order
          .map((entry: any) => Array.isArray(entry?.order) ? entry.order : [])
          .filter((order: any[]) => order.length > 0);
      return orders.sort((a: any[], b: any[]) => b.length - a.length)[0] || [];
  }

  private hydrateTavernPromptContent(prompt: any): void {
      if (!prompt || prompt.content !== undefined) return;
      const contentKeys = ['text', 'prompt', 'value', 'message', 'template'];
      const sourceKey = contentKeys.find(key => typeof prompt[key] === 'string');
      if (sourceKey) {
          prompt.content = prompt[sourceKey];
          return;
      }
      prompt.content = '';
  }

  private shouldExcludeTavernPrompt(prompt: any): boolean {
      return false;
  }

  private syncNormalizedPromptToOriginal(preset: TavernPreset, prompt: JailbreakPrompt): void {
      if (!prompt.identifier || !Array.isArray(preset.originalJson?.prompts)) return;
      const originalPrompt = preset.originalJson.prompts.find((item: any) => item?.identifier === prompt.identifier);
      if (originalPrompt) {
          originalPrompt.enabled = prompt.enabled;
          originalPrompt.content = prompt.content;
      }

      if (!Array.isArray(preset.originalJson?.prompt_order)) return;
      preset.originalJson.prompt_order.forEach((entry: any) => {
          const orderItem = Array.isArray(entry?.order)
              ? entry.order.find((item: any) => item?.identifier === prompt.identifier)
              : null;
          if (orderItem) orderItem.enabled = prompt.enabled;
      });
  }

  private applySelectedModelPreset(): void {
      const preset = this.modelPresets.find(p => p.id === this.activeModelPresetId);
      if (!preset) return;

      this.modelName = preset.modelName;

      if (preset.useAssociatedApiKey && preset.associatedApiKeyName) {
          const keyExists = this.apiKeys.some(k => k.name === preset.associatedApiKeyName);
          if (keyExists) {
              this.activeApiKeyName = preset.associatedApiKeyName;
              this.saveActiveApiKeyName();
              this.renderApiKeyList();
          }
      }

      this.contextLength = preset.contextLength;
      this.maxResponseLength = preset.maxResponseLength;

      if (preset.useAssociatedSettings) {
          this.isStreaming = preset.isStreaming;
          this.isShowCoTEnabled = preset.isShowCoTEnabled;
          this.topK = preset.topK || 0;
          this.topP = preset.topP !== undefined ? preset.topP : 1;
          this.frequencyPenalty = preset.frequencyPenalty || 0;
          this.presencePenalty = preset.presencePenalty || 0;
          this.minP = preset.minP || 0;
          this.dryRepetitionPenalty = preset.dryRepetitionPenalty || 0;
          this.excludeTopChoices = preset.excludeTopChoices || 0;
      }

      this.updateChatSettingsForm();
      this.debouncedSettingsUpdate();
      
      this.saveModelPresets();
      this.initializeChat();
  }

// Replacement logic for model preset methods.
  private openModelPresetModal(presetId: string | null): void {
      this.modelPresetModal.classList.add('visible');
      if (presetId) {
          this.editingModelPresetId = presetId;
      } else if (this.modelPresets.length > 0) {
          this.editingModelPresetId = this.activeModelPresetId || this.modelPresets[0].id;
      }
      this.renderModelPresets();
  }

  private closeModelPresetModal(): void {
      this.modelPresetModal.classList.remove('visible');
  }

  private populatePresetForm(): void {
      if (!this.editingModelPresetId) {
          this.modalPresetFormWrapper.style.display = 'none';
          return;
      }
      this.modalPresetFormWrapper.style.display = 'block';

      this.presetApiKeySelect.innerHTML = '<option value="">(选择密钥)</option>';
      this.apiKeys.forEach(k => {
          const opt = document.createElement('option');
          opt.value = k.name;
          opt.textContent = k.name;
          this.presetApiKeySelect.appendChild(opt);
      });

      const preset = this.modelPresets.find(p => p.id === this.editingModelPresetId);
      if (preset) {
          this.modelPresetOriginalId.value = preset.id;
          this.presetNameInput.value = preset.modelName || preset.name;
          
          this.presetIsImageModelToggle.checked = preset.isImageModel || false;
          
          this.presetBindApiKeyToggle.checked = preset.useAssociatedApiKey || false;
          this.presetApiKeyContainer.style.display = preset.useAssociatedApiKey ? 'block' : 'none';
          this.presetApiKeySelect.value = preset.associatedApiKeyName || '';
          
          this.presetBindSettingsToggle.checked = preset.useAssociatedSettings || false;
          this.presetSettingsContainer.style.display = preset.useAssociatedSettings ? 'block' : 'none';
          
          this.presetContextLengthSlider.value = (preset.contextLength || 0).toString();
          this.presetContextLengthInput.value = (preset.contextLength || 0).toString();
          this.presetMaxResponseSlider.value = (preset.maxResponseLength || 0).toString();
          this.presetMaxResponseInput.value = (preset.maxResponseLength || 0).toString();
          this.presetStreamingToggle.checked = preset.isStreaming || false;
          this.presetShowCoTToggle.checked = preset.isShowCoTEnabled ?? true;

          this.presetTopKSlider.value = (preset.topK || 0).toString();
          this.presetTopKInput.value = (preset.topK || 0).toString();
          this.presetTopPSlider.value = (preset.topP !== undefined ? preset.topP : 1).toString();
          this.presetTopPInput.value = (preset.topP !== undefined ? preset.topP : 1).toString();
          this.presetFrequencyPenaltySlider.value = (preset.frequencyPenalty || 0).toString();
          this.presetFrequencyPenaltyInput.value = (preset.frequencyPenalty || 0).toString();
          this.presetPresencePenaltySlider.value = (preset.presencePenalty || 0).toString();
          this.presetPresencePenaltyInput.value = (preset.presencePenalty || 0).toString();
          this.presetMinPSlider.value = (preset.minP || 0).toString();
          this.presetMinPInput.value = (preset.minP || 0).toString();
          this.presetDryPenaltySlider.value = (preset.dryRepetitionPenalty || 0).toString();
          this.presetDryPenaltyInput.value = (preset.dryRepetitionPenalty || 0).toString();
          this.presetExcludeTopSlider.value = (preset.excludeTopChoices || 0).toString();
          this.presetExcludeTopInput.value = (preset.excludeTopChoices || 0).toString();

          const hasAdvanced = (preset.topK !== 0 && preset.topK !== undefined) ||
                              (preset.topP !== 1 && preset.topP !== undefined) ||
                              (preset.frequencyPenalty !== 0 && preset.frequencyPenalty !== undefined) || 
                              (preset.presencePenalty !== 0 && preset.presencePenalty !== undefined);
                              
          const hasUnofficial = (preset.minP !== 0 && preset.minP !== undefined) ||
                                (preset.dryRepetitionPenalty !== 0 && preset.dryRepetitionPenalty !== undefined) ||
                                (preset.excludeTopChoices !== 0 && preset.excludeTopChoices !== undefined);

          this.presetAdvancedToggle.checked = hasAdvanced;
          this.presetAdvancedContainer.style.display = hasAdvanced ? 'block' : 'none';
          this.presetUnofficialToggle.checked = hasUnofficial;
          this.presetUnofficialContainer.style.display = hasUnofficial ? 'block' : 'none';
      }
  }

  private debouncedSaveModelPreset(): void {
      if (!this.editingModelPresetId) return;
      if (this.debouncePresetSaveTimer) clearTimeout(this.debouncePresetSaveTimer);
      
      this.debouncePresetSaveTimer = window.setTimeout(() => {
          this.handleAutoSaveModelPreset();
      }, 300);
  }

  private handleAutoSaveModelPreset(): void {
      if (!this.editingModelPresetId) return;
      const index = this.modelPresets.findIndex(p => p.id === this.editingModelPresetId);
      if (index === -1) return;
      
      const nameStr = this.presetNameInput.value.trim() || '未命名预设';
      
      const preset: ModelPreset = {
          id: this.editingModelPresetId,
          name: nameStr,
          modelName: nameStr,
          isImageModel: this.presetIsImageModelToggle.checked,
          useAssociatedApiKey: this.presetBindApiKeyToggle.checked,
          associatedApiKeyName: this.presetApiKeySelect.value,
          useAssociatedSettings: this.presetBindSettingsToggle.checked,
          contextLength: parseInt(this.presetContextLengthInput.value) || 0,
          maxResponseLength: parseInt(this.presetMaxResponseInput.value) || 0,
          isStreaming: this.presetStreamingToggle.checked,
          isShowCoTEnabled: this.presetShowCoTToggle.checked,
          topK: parseInt(this.presetTopKInput.value) || 0,
          topP: parseFloat(this.presetTopPInput.value) ?? 1,
          frequencyPenalty: parseFloat(this.presetFrequencyPenaltyInput.value) || 0,
          presencePenalty: parseFloat(this.presetPresencePenaltyInput.value) || 0,
          minP: parseFloat(this.presetMinPInput.value) || 0,
          dryRepetitionPenalty: parseFloat(this.presetDryPenaltyInput.value) || 0,
          excludeTopChoices: parseInt(this.presetExcludeTopInput.value) || 0
      };

      this.modelPresets[index] = preset;
      this.saveModelPresets();
      
      // Update select option quickly without full re-render
      const opt = Array.from(this.modelPresetSelect.options).find(o => o.value === this.editingModelPresetId);
      if (opt) opt.textContent = preset.name;
      
      // Re-render list
      this.renderPresetListItems();
      
      if (this.activeModelPresetId === this.editingModelPresetId) {
          this.applySelectedModelPreset();
      }
  }

  private duplicateModelPreset(presetId: string): void {
      const preset = this.modelPresets.find(p => p.id === presetId);
      if (!preset) return;
      
      const newId = 'preset_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      const newPreset: ModelPreset = {
          ...preset,
          id: newId,
          name: preset.name + ' (1)',
          modelName: preset.modelName + ' (1)'
      };
      
      this.modelPresets.push(newPreset);
      this.saveModelPresets();
      this.editingModelPresetId = newId;
      if (!this.activeModelPresetId) this.activeModelPresetId = newId;
      this.renderModelPresets();
  }

  private deleteModelPreset(presetId: string): void {
      if (confirm('确定要删除此预设吗？')) {
          this.modelPresets = this.modelPresets.filter(p => p.id !== presetId);
          if (this.activeModelPresetId === presetId) {
              this.activeModelPresetId = this.modelPresets.length > 0 ? this.modelPresets[0].id : "";
          }
          if (this.editingModelPresetId === presetId) {
              this.editingModelPresetId = this.modelPresets.length > 0 ? this.modelPresets[0].id : null;
          }
          
          this.saveModelPresets();
          this.renderModelPresets();
          this.applySelectedModelPreset();
      }
  }
  // --- File Handlers ---
  private async handleFileAttachments(event: Event): Promise<void> {
      const input = event.target as HTMLInputElement;
      if (input.files) {
          await this.handleFiles(input.files);
      }
      input.value = '';
  }

  private handlePaste(event: ClipboardEvent): void {
      if (event.clipboardData && event.clipboardData.files.length > 0) {
          event.preventDefault();
          this.handleFiles(event.clipboardData.files);
      }
  }

  private async handleFiles(files: FileList): Promise<void> {
      const incomingFiles = Array.from(files);
      const existingKeys = new Set(this.pendingFiles.map(fileObj => `${fileObj.file.name}:${fileObj.file.size}:${fileObj.file.lastModified}`));
      const acceptedFiles: { file: File; dataUrl: string }[] = [];
      const rejectedMessages: string[] = [];

      for (const file of incomingFiles) {
          if (this.pendingFiles.length + acceptedFiles.length >= this.maxPendingFiles) {
              rejectedMessages.push(`已达到最多 ${this.maxPendingFiles} 个附件限制。`);
              break;
          }

          const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
          if (existingKeys.has(fileKey) || acceptedFiles.some(item => `${item.file.name}:${item.file.size}:${item.file.lastModified}` === fileKey)) {
              rejectedMessages.push(`已跳过重复文件：${file.name}`);
              continue;
          }

          if (file.size > this.maxPendingFileSize) {
              rejectedMessages.push(`已跳过过大文件：${file.name}（超过 ${Math.round(this.maxPendingFileSize / 1024 / 1024)}MB）`);
              continue;
          }

          try {
              const dataUrl = await this.readFileAsDataURL(file);
              acceptedFiles.push({ file, dataUrl });
          } catch (error) {
              rejectedMessages.push(`读取失败：${file.name}`);
              this.recordError(error, `读取附件失败：${file.name}`, 'warning');
          }
      }

      this.pendingFiles.push(...acceptedFiles);
      this.renderFilePreview();
      if (rejectedMessages.length > 0) {
          this.appendSystemNotification(rejectedMessages.slice(0, 3).join('；'));
      }
  }

  private readFileAsDataURL(file: File): Promise<string> {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = () => reject(new Error("File read error"));
          reader.readAsDataURL(file);
      });
  }

  private renderFilePreview(): void {
      this.filePreviewContainer.innerHTML = '';
      if (this.pendingFiles.length > 0) {
          this.filePreviewContainer.style.display = 'flex';
          this.filePreviewContainer.style.flexWrap = 'wrap';
          this.filePreviewContainer.style.gap = '8px';
          this.pendingFiles.forEach((fileObj, index) => {
              const previewItem = document.createElement('div');
              previewItem.className = 'file-preview-item';
              previewItem.title = `${fileObj.file.name}\n${Math.round(fileObj.file.size / 1024)} KB`;
              
              if (fileObj.file.type.startsWith('image/')) {
                  const img = document.createElement('img');
                  img.src = fileObj.dataUrl;
                  img.alt = fileObj.file.name;
                  previewItem.appendChild(img);
              } else {
                  const text = document.createElement('span');
                  text.className = 'file-preview-label';
                  text.textContent = fileObj.file.name;
                  previewItem.appendChild(text);
              }

              const removeBtn = document.createElement('button');
              removeBtn.type = 'button';
              removeBtn.textContent = '×';
              removeBtn.title = `移除 ${fileObj.file.name}`;
              removeBtn.className = 'file-preview-remove';
              removeBtn.onclick = () => {
                  this.pendingFiles.splice(index, 1);
                  this.renderFilePreview();
              };
              previewItem.appendChild(removeBtn);

              this.filePreviewContainer.appendChild(previewItem);
          });
      } else {
          this.filePreviewContainer.style.display = 'none';
      }
  }

  // --- UI Rendering ---
  private renderAll(): void {
      this.renderApiKeyList();
      this.renderModelPresets();
      this.updateChatSettingsForm();
      this.renderSessionList();
      this.renderTavernPresetList();
      this.renderChatHistory();
      this.updateAppTitle();
      this.renderDataMemoryPane();
      this.renderAccessibilityPane();
      this.renderReplacementsList();
      this.updateRegenerateCapability();
  }

  private renderModelPresets(): void {
      this.modelPresetSelect.innerHTML = '';
      this.modelPresets.forEach(preset => {
          const option = document.createElement('option');
          option.value = preset.id;
          option.textContent = preset.name;
          this.modelPresetSelect.appendChild(option);
      });
      const exists = this.modelPresets.some(p => p.id === this.activeModelPresetId);
      if (exists) {
          this.modelPresetSelect.value = this.activeModelPresetId;
      } else if (this.modelPresets.length > 0) {
          this.modelPresetSelect.value = this.modelPresets[0].id;
          this.activeModelPresetId = this.modelPresets[0].id;
          this.saveModelPresets();
      }
      this.renderPresetListItems();
      this.populatePresetForm();
  }

  private renderPresetListItems(): void {
      if (!this.modalPresetListContainer) return;
      this.modalPresetListContainer.innerHTML = '';
      this.modelPresets.forEach(preset => {
          const item = document.createElement('div');
          item.className = 'preset-item';
          if (preset.id === this.editingModelPresetId) {
              item.classList.add('active');
          }
          item.dataset.id = preset.id;
          
          const info = document.createElement('div');
          info.className = 'preset-item-info';
          info.innerHTML = `<span class="preset-item-name">${preset.name}</span>`;
          item.appendChild(info);
          
          const actions = document.createElement('div');
          actions.className = 'preset-item-actions';
          const isDefault = preset.id.includes('default');
          
          if (!isDefault) {
              const dupBtn = document.createElement('button');
              dupBtn.title = '复制预设';
              dupBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
              dupBtn.onclick = (e) => { e.stopPropagation(); this.duplicateModelPreset(preset.id); };
              actions.appendChild(dupBtn);
              
              const delBtn = document.createElement('button');
              delBtn.title = '删除预设';
              delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6l-2 14H7L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M5 6l1-3h12l1 3"></path></svg>`;
              delBtn.onclick = (e) => { e.stopPropagation(); this.deleteModelPreset(preset.id); };
              actions.appendChild(delBtn);
          }
          item.appendChild(actions);
          
          item.onclick = () => {
              this.editingModelPresetId = preset.id;
              this.renderPresetListItems();
              this.populatePresetForm();
          };
          this.modalPresetListContainer.appendChild(item);
      });
  }

  
  private updateAppTitle(): void {
      if (this.activeSessionId && this.sessions[this.activeSessionId]) {
        this.appTitle.textContent = this.sessions[this.activeSessionId].name;
      } else {
        this.appTitle.textContent = '个人AI助手';
      }
  }

  private openSettingsSidebar(paneId?: string): void {
      this.settingsSidebar.classList.add('is-open');
      this.sidebarBackdrop.classList.add('is-visible');
      if (paneId) { this.switchPane(paneId); }
  }
  private closeSettingsSidebar(): void {
      this.settingsSidebar.classList.remove('is-open');
      this.sidebarBackdrop.classList.remove('is-visible');
  }
  private switchPane(paneId: string): void {
      this.contentPanes.forEach(pane => { pane.classList.toggle('active', pane.id === paneId); });
      this.navButtons.forEach(button => { button.classList.toggle('active', button.dataset.pane === paneId); });
      if (paneId === 'data-memory-pane') {
          this.renderDataMemoryPane();
      }
  }
  private updateChatSettingsForm(): void {
      this.systemPromptInput.value = this.systemInstruction;
      this.temperatureSlider.value = this.temperature.toString();
      this.temperatureInputBox.value = parseFloat(this.temperature.toFixed(2)).toString();
      this.streamingToggle.checked = this.isStreaming;
      this.showCoTToggle.checked = this.isShowCoTEnabled;
      this.continuousOutputToggle.checked = this.isContinuousOutputEnabled;
  }
  
  private filterProfanity(text: string): string {
    // Sort by length descending to handle substrings correctly
    const sortedList = [...profanityList].sort((a, b) => b.length - a.length);
    let processedText = text;

    for (const word of sortedList) {
        if (!word) continue; // Skip empty strings in the list

        // Escape special regex characters in the word to ensure it's treated as a literal string
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedWord, 'g');
        const replacement = word.split('').join('.');
        
        processedText = processedText.replace(regex, replacement);
    }
    return processedText;
  }

  private debouncedSettingsUpdate() {
      if (this.settingsUpdateDebounceTimer) {
          clearTimeout(this.settingsUpdateDebounceTimer);
      }
      this.settingsUpdateDebounceTimer = window.setTimeout(() => {
          if (!this.isEasterEggActive) {
              const rawSystemInstruction = this.systemPromptInput.value;
              const filteredInstruction = this.filterProfanity(rawSystemInstruction);
              
              if (rawSystemInstruction !== filteredInstruction) {
                  this.systemPromptInput.value = filteredInstruction;
              }
              this.systemInstruction = filteredInstruction;
          }
          
          this.temperature = parseFloat(this.temperatureSlider.value);
          this.isStreaming = this.streamingToggle.checked;
          this.isShowCoTEnabled = this.showCoTToggle.checked;
          this.isContinuousOutputEnabled = this.continuousOutputToggle.checked;
          
          if (this.activeSessionId) {
              const session = this.sessions[this.activeSessionId];
              session.systemInstruction = this.systemInstruction;
              session.temperature = this.temperature;
              session.modelName = this.modelName;
              session.contextLength = this.contextLength;
              session.maxResponseLength = this.maxResponseLength;
              session.isStreaming = this.isStreaming;
              session.isShowCoTEnabled = this.isShowCoTEnabled;
              session.isContinuousOutputEnabled = this.isContinuousOutputEnabled;
              this.saveSessions();
          }

          this.saveDefaultSettingsDebounced(); // Update defaults for new sessions
          this.initializeChat();
          this.updateEasterEggPreview();
          // Only show notification if a chat is active.
          if(this.chat) {
             this.appendSystemNotification('聊天设置已更新并生效。');
          }
      }, 500);
  }

  // --- API Key Management ---
  private renderApiKeyList(): void {
    this.apiKeyListContainer.innerHTML = '';
    if (this.apiKeys.length === 0) {
        this.apiKeyListContainer.innerHTML = '<p class="form-hint">您还没有添加任何API密钥。</p>';
        return;
    }
    this.apiKeys.forEach(apiKey => {
        const item = document.createElement('div');
        item.className = 'api-key-item';
        const isPendingDeletion = apiKey.name === this.pendingDeletionApiKeyName;

        if (apiKey.name === this.activeApiKeyName) { item.classList.add('active'); }
        if (isPendingDeletion) { item.classList.add('is-pending-deletion'); }
        
        const partialKey = `${apiKey.key.substring(0, 4)}...${apiKey.key.slice(-4)}`;
        
        let actionsHtml = '';
        if (isPendingDeletion) {
            actionsHtml = `
                <div class="api-key-actions confirm-delete">
                    <button class="confirm-delete-key-btn" title="确认删除">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </button>
                    <button class="cancel-delete-key-btn" title="取消">
                         <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>`;
        } else {
            actionsHtml = `
                <div class="api-key-actions">
                    <button class="activate-key-btn" title="激活此密钥" data-name="${apiKey.name}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </button>
                    <button class="edit-key-btn" title="编辑此密钥" data-name="${apiKey.name}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="delete-key-btn" title="删除此密钥" data-name="${apiKey.name}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                </div>`;
        }

        item.innerHTML = `
            <div class="api-key-info">
                <span class="api-key-name">${apiKey.name}</span>
                <span class="api-key-partial">${partialKey}</span>
            </div>
            ${actionsHtml}`;
            
        if (isPendingDeletion) {
            item.querySelector('.confirm-delete-key-btn')?.addEventListener('click', () => this.executeDeleteKey(apiKey.name));
            item.querySelector('.cancel-delete-key-btn')?.addEventListener('click', () => this.cancelDeleteKey());
        } else {
            item.querySelector('.activate-key-btn')?.addEventListener('click', () => this.handleSetActiveKey(apiKey.name));
            item.querySelector('.edit-key-btn')?.addEventListener('click', () => this.handleEditKey(apiKey.name));
            item.querySelector('.delete-key-btn')?.addEventListener('click', () => this.handleDeleteKey(apiKey.name));
        }
        this.apiKeyListContainer.appendChild(item);
    });
  }
  private handleAddApiKey(event: Event): void {
      event.preventDefault();
      const name = this.apiKeyNameInput.value.trim();
      const key = this.normalizeApiKey(this.apiKeyInput.value);
      const endpoint = this.apiKeyEndpointInput.value.trim();
      if (!name || !key) { alert('密钥名称和值不能为空。'); return; }
      if (!/^[\x21-\x7E]+$/.test(key)) { alert('API 密钥包含空格、换行、中文或其它非法字符，请只填写纯密钥。'); return; }
      
      const originalName = this.addApiKeyForm.dataset.originalName;
      if (this.apiKeys.some(k => k.name === name && k.name !== originalName)) { alert('已存在同名密钥。'); return; }
      
      const newKey: ApiKey = { name, key };
      if (endpoint) newKey.endpoint = endpoint;
      
      if (originalName) {
          const index = this.apiKeys.findIndex(k => k.name === originalName);
          if (index !== -1) {
              this.apiKeys[index] = newKey;
              if (this.activeApiKeyName === originalName) {
                  this.activeApiKeyName = name; 
                  this.saveActiveApiKeyName();
              }
          }
          delete this.addApiKeyForm.dataset.originalName;
          this.toggleAddApiKeyBtn.textContent = '添加新密钥';
      } else {
          this.apiKeys.push(newKey);
      }
      
      this.saveApiKeys();
      if (this.apiKeys.length === 1 && !originalName) { this.handleSetActiveKey(name); }
      this.renderApiKeyList();
      this.addApiKeyForm.reset();
      this.addApiKeyForm.style.display = 'none';
  }
  
  private handleEditKey(name: string): void {
      const apiKey = this.apiKeys.find(k => k.name === name);
      if (!apiKey) return;
      
      this.apiKeyNameInput.value = apiKey.name;
      this.apiKeyInput.value = apiKey.key;
      this.apiKeyEndpointInput.value = apiKey.endpoint || '';
      
      this.addApiKeyForm.style.display = 'block';
      this.toggleAddApiKeyBtn.textContent = '取消编辑';
      this.addApiKeyForm.dataset.originalName = name;
  }
  private handleSetActiveKey(name: string, silent: boolean = false): void {
      this.activeApiKeyName = name;
      this.saveActiveApiKeyName();
      this.renderApiKeyList();
      this.initializeChat();
      if ((this.chat || this.isCustomEndpoint) && !silent) {
        this.appendSystemNotification(`密钥 "${name}" 已激活。`);
      }
  }
  private handleDeleteKey(name: string): void {
      this.pendingDeletionApiKeyName = name;
      this.renderApiKeyList();
  }

  private cancelDeleteKey(): void {
      this.pendingDeletionApiKeyName = null;
      this.renderApiKeyList();
  }

  private executeDeleteKey(name: string): void {
      this.apiKeys = this.apiKeys.filter(k => k.name !== name);
      this.pendingDeletionApiKeyName = null;
      this.saveApiKeys();
      if (this.activeApiKeyName === name) {
          this.activeApiKeyName = null;
          this.saveActiveApiKeyName();
          this.clearChatUI();
          this.initializeChat();
      }
      this.renderApiKeyList();
  }

    // --- Session Management ---
    private renderSessionList(): void {
        this.sessionListContainer.innerHTML = '';
        const sortedSessions = Object.values(this.sessions).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        
        if (sortedSessions.length === 0) {
            this.sessionListContainer.innerHTML = '<p class="form-hint">还没有会话。点击标题栏的“+”按钮创建一个。</p>';
            return;
        }

        sortedSessions.forEach(session => {
            const item = document.createElement('div');
            item.className = 'session-item';
            item.dataset.sessionId = session.id;
            const isPendingDeletion = session.id === this.pendingDeletionSessionId;

            if (session.id === this.activeSessionId) {
                item.classList.add('active');
            }
            if (isPendingDeletion) {
                item.classList.add('is-pending-deletion');
            }

            const date = new Date(session.createdAt).toLocaleDateString();

            const infoHtml = `
                <div class="session-item-info">
                    <span class="session-item-name">${session.name}</span>
                    <span class="session-item-date">${date}</span>
                </div>`;

            let actionsHtml: string;
            if (isPendingDeletion) {
                actionsHtml = `
                    <div class="session-item-actions confirm-delete">
                        <button class="confirm-delete-btn" title="确认删除">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        </button>
                        <button class="cancel-delete-btn" title="取消">
                             <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>`;
            } else {
                actionsHtml = `
                    <div class="session-item-actions">
                        <button class="rename-session-btn" title="重命名">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                        </button>
                        <button class="delete-session-btn" title="删除">
                             <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>`;
            }

            item.innerHTML = infoHtml + actionsHtml;

            item.addEventListener('click', (e) => {
                if (!(e.target as HTMLElement).closest('.session-item-actions')) {
                   this.switchSession(session.id);
                }
            });

            if (isPendingDeletion) {
                item.querySelector('.confirm-delete-btn')?.addEventListener('click', () => this.executeDeleteSession(session.id));
                item.querySelector('.cancel-delete-btn')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.cancelDeleteConfirmation()
                });
            } else {
                item.querySelector('.rename-session-btn')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleRenameSession(session.id)
                });
                item.querySelector('.delete-session-btn')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleDeleteSession(session.id)
                });
            }
            this.sessionListContainer.appendChild(item);
        });
    }

    private handleCreateNewSession(event: Event): void {
        event.preventDefault();
        const form = event.target as HTMLFormElement;
        const submitButton = form.querySelector('button[type="submit"]') as HTMLButtonElement;
        const name = this.newSessionNameInput.value.trim();
        if (!name || submitButton.classList.contains('is-loading')) return;

        submitButton.classList.add('is-loading');

        // Artificial delay for user feedback
        setTimeout(() => {
            const id = Date.now().toString();
            this.sessions[id] = {
                id,
                name,
                createdAt: new Date().toISOString(),
                history: [],
                dataMemory: {},
                scrollTop: 0,
                // Initialize with current default settings, except system prompt which should be independent
                systemInstruction: "",
                temperature: this.temperature,
                modelName: this.modelName,
                contextLength: this.contextLength,
                maxResponseLength: this.maxResponseLength,
                isStreaming: this.isStreaming,
                isDataMemoryEnabled: false,
                isAutoAdvanceEnabled: this.isAutoAdvanceEnabled,
                autoAdvancePrompt: this.autoAdvancePrompt,
                isAutoRetryEnabled: this.isAutoRetryEnabled
            };
            this.activeSessionId = id;
            
            this.saveSessions();
            this.saveActiveSessionId();
            
            // Explicitly load settings from the newly created session
            this.loadSettingsFromSession(id);
            this.renderAll();
            this.clearChatUI();
            this.initializeChat();
            
            this.newSessionForm.reset();
            this.hideNewSessionModal();
            
            // Remove loading state after modal is hidden
            setTimeout(() => {
               submitButton.classList.remove('is-loading');
            }, 300);

        }, 400);
    }
    
    private switchSession(sessionId: string): void {
        if (this.pendingDeletionSessionId) {
            this.cancelDeleteConfirmation();
        }
        if (this.activeSessionId === sessionId) return;

        // Save scroll position of the old session before switching
        if (this.activeSessionId && this.sessions[this.activeSessionId]) {
            this.sessions[this.activeSessionId].scrollTop = this.chatContainer.scrollTop;
            this.saveSessions();
        }

        this.activeSessionId = sessionId;
        this.loadSettingsFromSession(sessionId);
        this.saveActiveSessionId();
        this.renderAll();
        this.initializeChat();
        this.updateEasterEggPreview();
        this.closeSettingsSidebar();
    }
    
    private handleRenameSession(sessionId: string): void {
        if (this.pendingDeletionSessionId) {
            this.cancelDeleteConfirmation();
        }
        const sessionItem = this.sessionListContainer.querySelector(`.session-item[data-session-id="${sessionId}"]`);
        const nameSpan = sessionItem?.querySelector('.session-item-name');
        if (!sessionItem || !nameSpan) return;

        const currentName = this.sessions[sessionId].name;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'session-item-name-input';
        input.value = currentName;

        nameSpan.replaceWith(input);
        input.focus();
        input.select();

        const saveRename = () => {
            const newName = input.value.trim();
            if (newName && newName !== currentName) {
                this.sessions[sessionId].name = newName;
                this.saveSessions();
                this.renderSessionList();
                this.updateAppTitle();
            } else {
                input.replaceWith(nameSpan);
            }
        };

        input.addEventListener('blur', saveRename);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') {
                input.value = currentName;
                input.blur();
            }
        });
    }

    private handleDeleteSession(sessionId: string): void {
        if (this.pendingDeletionSessionId === sessionId) {
            this.cancelDeleteConfirmation();
            return;
        }
        
        if (this.pendingDeletionSessionId) {
            this.cancelDeleteConfirmation();
        }
    
        this.pendingDeletionSessionId = sessionId;
    
        document.addEventListener('mousedown', this.boundCancelDeleteHandler);
        
        this.renderSessionList();
    }

    private handleDocumentClickForCancel(event: MouseEvent): void {
        const target = event.target as HTMLElement;
        const clickedItem = target.closest(`.session-item[data-session-id="${this.pendingDeletionSessionId}"]`);
        
        if (!clickedItem) {
            this.cancelDeleteConfirmation();
        }
    }
    
    private cancelDeleteConfirmation(): void {
        if (!this.pendingDeletionSessionId) return;
        this.pendingDeletionSessionId = null;
        document.removeEventListener('mousedown', this.boundCancelDeleteHandler);
        this.renderSessionList();
    }

    private executeDeleteSession(sessionId: string): void {
        document.removeEventListener('mousedown', this.boundCancelDeleteHandler);

        delete this.sessions[sessionId];
        this.saveSessions();
        
        this.pendingDeletionSessionId = null;

        if (this.activeSessionId === sessionId) {
            this.activeSessionId = null;
            // Try to switch to the most recent session
            const sortedSessions = Object.values(this.sessions).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            if (sortedSessions.length > 0) {
                this.activeSessionId = sortedSessions[0].id;
                this.loadSettingsFromSession(this.activeSessionId);
            }
            this.saveActiveSessionId();
            this.renderChatHistory();
            this.initializeChat();
            if(!this.activeSessionId){
                 this.showNewSessionModal();
            }
        }
        
        this.renderSessionList();
        this.updateAppTitle();
        this.updateRegenerateCapability();
    }

  // --- Data Memory ---
    private renderDataMemoryPane(): void {
        this.dataMemoryToggle.checked = this.isDataMemoryEnabled;

        if (this.dataMemoryDisplayWrapper.hasAttribute('style')) {
            this.dataMemoryDisplayWrapper.removeAttribute('style');
        }
        this.dataMemoryDisplayWrapper.classList.toggle('visible', this.isDataMemoryEnabled);
        
        if (this.isDataMemoryEnabled) {
            if (this.activeSessionId && this.sessions[this.activeSessionId]) {
                const memory = this.sessions[this.activeSessionId].dataMemory;
                this.dataMemoryJsonTextarea.value = JSON.stringify(memory, null, 2);
                this.dataMemoryJsonTextarea.disabled = false;
                this.saveMemoryBtn.disabled = false;
            } else {
                this.dataMemoryJsonTextarea.value = '没有活动的会话。';
                this.dataMemoryJsonTextarea.disabled = true;
                this.saveMemoryBtn.disabled = true;
            }
        }
    }

    private handleDataMemoryToggle(): void {
        this.isDataMemoryEnabled = this.dataMemoryToggle.checked;
        if (this.activeSessionId) {
            this.sessions[this.activeSessionId].isDataMemoryEnabled = this.isDataMemoryEnabled;
            this.saveSessions();
        }
        this.renderDataMemoryPane();
        if (this.chat) {
          this.appendSystemNotification(`数据记忆已${this.isDataMemoryEnabled ? '开启' : '关闭'}。`);
        }
    }

    private handleSaveMemory(): void {
        if (!this.activeSessionId) return;
        try {
            const newData = JSON.parse(this.dataMemoryJsonTextarea.value);
            const sanitizedData = this.sanitizeMemoryObject(newData);
            if (!sanitizedData) {
                alert('保存失败：记忆必须是大小不超过20KB的JSON对象。');
                return;
            }
            this.sessions[this.activeSessionId].dataMemory = sanitizedData;
            this.saveSessions();
            this.updateEasterEggPreview();
            alert('记忆已保存！');
        } catch (e) {
            alert('保存失败：无效的JSON格式。');
            console.error("Invalid JSON in memory textarea:", e);
        }
    }

    // --- Accessibility ---
    private renderAccessibilityPane(): void {
        this.autoAdvanceToggle.checked = this.isAutoAdvanceEnabled;
        this.autoAdvancePromptInput.value = this.autoAdvancePrompt;
        this.autoRetryToggle.checked = this.isAutoRetryEnabled;

        if (this.autoAdvanceControls.hasAttribute('style')) {
            this.autoAdvanceControls.removeAttribute('style');
        }
        this.autoAdvanceControls.classList.toggle('visible', this.isAutoAdvanceEnabled);
        this.updateAutoAdvanceButton();
    }

    private updateAutoAdvanceButton(): void {
        if (this.isAutoAdvanceRunning) {
            this.autoAdvanceBtn.textContent = '结束';
            this.autoAdvanceBtn.classList.add('btn-danger');
            this.autoAdvancePromptInput.disabled = true;
            this.setFormState(true, '自动推进中...');
        } else {
            this.autoAdvanceBtn.textContent = '开始';
            this.autoAdvanceBtn.classList.remove('btn-danger');
            this.autoAdvancePromptInput.disabled = false;
            // Only re-enable form if a chat is actually active
            if (this.chat) {
                this.setFormState(false);
            }
        }
    }

    private handleAutoAdvanceToggle(): void {
        this.isAutoAdvanceEnabled = this.autoAdvanceToggle.checked;
        if (this.activeSessionId) {
            this.sessions[this.activeSessionId].isAutoAdvanceEnabled = this.isAutoAdvanceEnabled;
            this.saveSessions();
        }
        this.saveDefaultSettings();
        this.renderAccessibilityPane();
        if (!this.isAutoAdvanceEnabled && this.isAutoAdvanceRunning) {
            this.isAutoAdvanceRunning = false;
            this.updateAutoAdvanceButton();
            this.appendMessage('自动推进已停止。', 'ai');
        }
    }

    private handleAddReplacement(): void {
        const id = 'rep_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.contentReplacements.push({
            id,
            type: 'text',
            applyTo: 'both',
            target: '',
            replacement: '',
            enabled: true
        });
        this.saveReplacements();
        this.renderReplacementsList();
    }

    private saveReplacements(): void {
        if (this.replacementsSaveTimer) clearTimeout(this.replacementsSaveTimer);
        this.replacementsSaveTimer = window.setTimeout(() => this.saveReplacementsNow(), 300);
    }

    private saveReplacementsNow(): void {
        if (this.replacementsSaveTimer) {
            clearTimeout(this.replacementsSaveTimer);
            this.replacementsSaveTimer = null;
        }
        localStorage.setItem('contentReplacements', JSON.stringify(this.contentReplacements));
        this.emitSync('contentReplacements', JSON.stringify(this.contentReplacements));
    }

    private renderReplacementsList(): void {
        if (!this.replacementsList) return;
        this.replacementsList.innerHTML = '';
        this.contentReplacements.forEach((rep, index) => {
            const item = document.createElement('div');
            item.className = 'replacement-item';

            const topRow = document.createElement('div');
            topRow.className = 'replacement-row';

            const typeSelect = document.createElement('select');
            typeSelect.className = 'select-control';
            const textOpt = document.createElement('option');
            textOpt.value = 'text';
            textOpt.textContent = '纯文本';
            const regexOpt = document.createElement('option');
            regexOpt.value = 'regex';
            regexOpt.textContent = '正则表达式';
            typeSelect.appendChild(textOpt);
            typeSelect.appendChild(regexOpt);
            typeSelect.value = rep.type;
            typeSelect.onchange = () => {
                rep.type = typeSelect.value as 'text' | 'regex';
                this.saveReplacements();
            };

            const rightControls = document.createElement('div');
            rightControls.className = 'replacement-right-controls';

            const toggleWrapper = document.createElement('div');
            toggleWrapper.className = 'replacement-right-controls';
            const toggleInput = document.createElement('input');
            toggleInput.type = 'checkbox';
            toggleInput.className = 'toggle-switch';
            toggleInput.id = `rep-toggle-${index}`;
            toggleInput.checked = rep.enabled;
            toggleInput.onchange = () => {
                rep.enabled = toggleInput.checked;
                this.saveReplacements();
            };
            const toggleLabel = document.createElement('label');
            toggleLabel.setAttribute('for', toggleInput.id);
            toggleLabel.className = 'toggle-switch-label';
            toggleWrapper.appendChild(toggleInput);
            toggleWrapper.appendChild(toggleLabel);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'nav-button';
            deleteBtn.classList.add('replacement-delete-btn');
            deleteBtn.innerHTML = '×';
            deleteBtn.onclick = () => {
                this.contentReplacements.splice(index, 1);
                this.saveReplacements();
                this.renderReplacementsList();
            };

            rightControls.appendChild(toggleWrapper);
            rightControls.appendChild(deleteBtn);

            const leftControls = document.createElement('div');
            leftControls.className = 'replacement-left-controls';
            
            const applySelect = document.createElement('select');
            applySelect.className = 'select-control';
            applySelect.style.width = 'auto';
            const bothOpt = document.createElement('option'); bothOpt.value = 'both'; bothOpt.textContent = '全部消息';
            const userOpt = document.createElement('option'); userOpt.value = 'user'; userOpt.textContent = '仅用户消息';
            const aiOpt = document.createElement('option'); aiOpt.value = 'ai'; aiOpt.textContent = '仅AI消息';
            applySelect.appendChild(bothOpt); applySelect.appendChild(userOpt); applySelect.appendChild(aiOpt);
            applySelect.value = rep.applyTo || 'both';
            applySelect.onchange = () => { rep.applyTo = applySelect.value as 'both'|'user'|'ai'; this.saveReplacements(); };

            leftControls.appendChild(typeSelect);
            leftControls.appendChild(applySelect);

            topRow.appendChild(leftControls);
            topRow.appendChild(rightControls);

            const sourceInput = document.createElement('textarea');
            sourceInput.className = 'input-control';
            sourceInput.classList.add('replacement-input');
            sourceInput.placeholder = '需要被替换的文本 (支持正则)';
            sourceInput.rows = 2;
            sourceInput.value = rep.target;
            sourceInput.oninput = () => {
                rep.target = sourceInput.value;
                this.saveReplacements();
            };

            const destInput = document.createElement('textarea');
            destInput.className = 'input-control';
            destInput.classList.add('replacement-input');
            destInput.placeholder = '指定的替换内容';
            destInput.rows = 2;
            destInput.value = rep.replacement;
            destInput.oninput = () => {
                rep.replacement = destInput.value;
                this.saveReplacements();
            };

            item.appendChild(topRow);
            item.appendChild(sourceInput);
            item.appendChild(destInput);

            this.replacementsList.appendChild(item);
        });
    }

    private applyContentReplacements(text: string, role: 'user' | 'ai' | 'both' = 'both'): string {
        if (!text || this.contentReplacements.length === 0) return text;
        let result = text;
        for (const rep of this.contentReplacements) {
            if (!rep.enabled || !rep.target) continue;
            
            const applyTo = rep.applyTo || 'both';
            if (role !== 'both' && applyTo !== 'both' && applyTo !== role) continue;

            try {
                if (rep.type === 'regex') {
                    // Try to parse regex flags if user inputted them like /pattern/g
                    let pattern = rep.target;
                    let flags = 'g';
                    if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
                        const lastSlash = pattern.lastIndexOf('/');
                        flags = this.normalizeRegexFlags(pattern.substring(lastSlash + 1));
                        pattern = pattern.substring(1, lastSlash);
                    } else {
                        flags = this.normalizeRegexFlags(flags);
                    }
                    const regex = new RegExp(pattern, flags);
                    result = result.replace(regex, rep.replacement);
                } else {
                    result = result.split(rep.target).join(rep.replacement);
                }
            } catch (e) {
                console.error("Content replacement error:", e);
            }
        }
        return result;
    }

    private async handleAutoAdvanceButtonClick(): Promise<void> {
        if (this.isAutoAdvanceRunning) {
            // Stop the loop
            this.isAutoAdvanceRunning = false;
            this.updateAutoAdvanceButton();
            this.appendMessage('自动推进已停止。', 'ai');
        } else {
            // Start the loop
            const prompt = this.autoAdvancePrompt;
            if ((!this.chat && !this.isCustomEndpoint) || !this.activeSessionId) {
                alert('请先激活密钥并选择一个会话以开始。');
                return;
            }
            
            this.isAutoAdvanceRunning = true;
            this.autoRetryAttemptedKeys = []; // Reset retry cycle tracker
            this.updateAutoAdvanceButton();
            if (prompt.trim()) {
                this.appendMessage(`自动推进已开始，循环提示词: "${prompt}"`, 'ai');
            } else {
                this.appendMessage(`自动推进已开始 (空消息模式)`, 'ai');
            }
            
            await this.sendAutoAdvanceMessage();
        }
    }

    private handleChatScroll(): void {
        if (this.scrollDebounceTimer) {
            window.clearTimeout(this.scrollDebounceTimer);
        }
        this.scrollDebounceTimer = window.setTimeout(() => {
            if (this.activeSessionId && this.sessions[this.activeSessionId]) {
                this.sessions[this.activeSessionId].scrollTop = this.chatContainer.scrollTop;
                this.saveSessions();
            }
        }, 300);
    }

    private async sendAutoAdvanceMessage(sessionIdToAdvance?: string): Promise<void> {
        const sessionId = sessionIdToAdvance || this.activeSessionId;
        const prompt = this.autoAdvancePrompt;

        if (!this.isAutoAdvanceRunning || (!this.chat && !this.isCustomEndpoint) || !sessionId) {
            if (this.isAutoAdvanceRunning) {
                this.isAutoAdvanceRunning = false;
                if (this.activeSessionId === sessionId) {
                   this.updateAutoAdvanceButton();
                }
            }
            return;
        }

        const sessionToAdvance = this.sessions[sessionId];
        if (!sessionToAdvance) {
            this.isAutoAdvanceRunning = false;
            return;
        }

        const promptToSend = prompt.trim() === '' ? ' ' : prompt;
        sessionToAdvance.history.push({ role: 'user', parts: [{ text: promptToSend }] });
        this.saveSessions();
        
        if (this.activeSessionId === sessionId) {
            this.appendMessage(promptToSend, 'user');
        }
        
        await this._sendMessageAndHandleResponse([{ text: promptToSend }], sessionId, true);
    }


  private handleSystemPromptClick(): void {
      this.systemPromptClickCount++;
      if (this.systemPromptClickTimer !== null) {
          clearTimeout(this.systemPromptClickTimer);
      }
      
      if (this.systemPromptClickCount >= 3) {
          this.systemPromptClickCount = 0;
          this.toggleEasterEgg();
      } else {
          this.systemPromptClickTimer = window.setTimeout(() => {
              this.systemPromptClickCount = 0;
          }, 500);
      }
  }

  private toggleEasterEgg(): void {
      this.isEasterEggActive = !this.isEasterEggActive;
      
      if (this.isEasterEggActive) {
          this.systemPromptLabel.classList.add('easter-egg-active');
          this.systemPromptInput.style.display = 'none';
          this.easterEggPreviewInput.style.display = 'block';
          this.updateEasterEggPreview();
      } else {
          this.systemPromptLabel.classList.remove('easter-egg-active');
          this.systemPromptInput.style.display = 'block';
          this.easterEggPreviewInput.style.display = 'none';
          this.systemPromptInput.value = this.systemInstruction;
      }
  }

  private updateEasterEggPreview(): void {
      if (!this.isEasterEggActive) return;
      
      let previewText = "[实时内部系统提示词预览 - 实际调用时会动态附加到所有提示词中]\n\n";
      previewText += "【基础系统提示词】:\n" + (this.systemInstruction || "(无)") + "\n\n";
      
      const originalSession = this.activeSessionId ? this.sessions[this.activeSessionId] : null;
      const memoryInstruction = this.isDataMemoryEnabled && originalSession ? this.buildDataMemoryInstruction(originalSession.dataMemory).trim() : '';
      
      previewText += "【数据记忆功能附加提示词】:\n" + (memoryInstruction || "(未启用/无)") + "\n\n";
      
      const continuousInstruction = this.isContinuousOutputEnabled ? "[System Rule]: 你拥有连续输出的主动权。如果需要进行多次输出以完成任务，请在当前回复的末尾精确输出 '[CONTINUE]' 标记。" : "";
      
      previewText += "【连续输出功能附加提示词】:\n" + (continuousInstruction || "(未启用/无)");
      
      this.easterEggPreviewInput.value = previewText;
  }

  // --- Data Management ---
  private handleExportData(): void {
      const exportData = {
          version: 3, // Bump version for new settings structure
          exportedAt: new Date().toISOString(),
          settings: { // Default settings for new sessions
              systemInstruction: this.systemInstruction,
              temperature: this.temperature,
          },
          apiKeys: this.apiKeys,
          activeApiKeyName: this.activeApiKeyName,
          sessions: this.sessions,
          activeSessionId: this.activeSessionId
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `personal-ai-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  }
  private handleImportTavernPreset(event: Event): void {
      const input = event.target as HTMLInputElement;
      if (!input.files || input.files.length === 0) return;

      const file = input.files[0];
      const reader = new FileReader();

      reader.onload = (e) => {
          try {
              const content = e.target?.result as string;
              const json = JSON.parse(content);
              if (json && Array.isArray(json.prompts)) {
                  const id = 'tavern_preset_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                  const normalized = this.normalizeTavernPreset(json);
                  const preset: TavernPreset = {
                      id,
                      name: file.name.replace('.json', ''),
                      originalJson: json,
                      prompts: normalized.prompts,
                      rawPromptCount: normalized.rawPromptCount,
                      enabledFile: false
                  };
                  this.tavernPresets.push(preset);
                  this.saveTavernPresetsState();
                  this.renderTavernPresetList();
                  alert(`成功导入酒馆预设: ${preset.name}`);
              } else {
                  alert('无效的酒馆预设文件结构。找不到 prompts 数组。');
              }
          } catch (err) {
              alert('解析预设文件失败: ' + err);
          } finally {
              input.value = ''; // Reset
          }
      };
      reader.readAsText(file);
  }

  private renderTavernPresetList(): void {
      this.presetManagerList.innerHTML = '';
      this.tavernPresets.forEach(preset => {
          const div = document.createElement('div');
          div.className = `session-item`;
          if (preset.enabledFile) {
              div.style.borderLeft = '4px solid var(--primary-color)';
          }
          
          const label = document.createElement('div');
          label.style.fontWeight = '500';
          label.style.flex = '1';
          label.style.overflow = 'hidden';
          label.style.textOverflow = 'ellipsis';
          label.style.whiteSpace = 'nowrap';
          const promptCount = this.getPresetPrompts(preset).length;
          const rawPromptCount = preset.rawPromptCount ?? (Array.isArray(preset.originalJson.prompts) ? preset.originalJson.prompts.length : promptCount);
          label.textContent = `${preset.name} (${promptCount}/${rawPromptCount} 条)`;
          
          const btnGroup = document.createElement('div');
          btnGroup.style.display = 'flex';
          btnGroup.style.gap = '8px';

          const editBtn = document.createElement('button');
          editBtn.className = 'btn-secondary';
          editBtn.style.padding = '4px 8px';
          editBtn.style.fontSize = '12px';
          editBtn.textContent = '设置';
          editBtn.onclick = (e) => {
              e.stopPropagation();
              this.openPresetSettingModal(preset.id);
          };

          const toggleBtn = document.createElement('button');
          toggleBtn.className = preset.enabledFile ? 'btn-primary' : 'btn-secondary';
          toggleBtn.style.padding = '4px 8px';
          toggleBtn.style.fontSize = '12px';
          toggleBtn.textContent = preset.enabledFile ? '已启用' : '启用';
          toggleBtn.onclick = (e) => {
              e.stopPropagation();
              preset.enabledFile = !preset.enabledFile;
              this.saveTavernPresetsState();
              this.renderTavernPresetList();
          };

          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'btn-secondary';
          deleteBtn.style.padding = '4px 8px';
          deleteBtn.style.fontSize = '12px';
          deleteBtn.style.color = '#ef4444';
          deleteBtn.textContent = '删除';
          deleteBtn.onclick = (e) => {
              e.stopPropagation();
              if (confirm('确定要删除此预设文件吗？')) {
                  this.tavernPresets = this.tavernPresets.filter(p => p.id !== preset.id);
                  this.saveTavernPresetsState();
                  this.renderTavernPresetList();
              }
          };

          btnGroup.appendChild(deleteBtn);
          btnGroup.appendChild(editBtn);
          btnGroup.appendChild(toggleBtn);
          
          div.appendChild(label);
          div.appendChild(btnGroup);
          
          this.presetManagerList.appendChild(div);
      });
  }

  private openPresetSettingModal(id: string): void {
      const preset = this.tavernPresets.find(p => p.id === id);
      if (!preset) return;
      this.editingTavernPresetId = id;
      this.presetSettingTitle.textContent = `设置预设: ${preset.name}`;
      this.renderPresetPrompts(preset);
      this.presetSettingListView.style.display = 'none';
      this.presetSettingSettingsView.style.display = 'flex';
  }

  private closePresetSettingModal(): void {
      this.editingTavernPresetId = null;
      this.presetSettingSettingsView.style.display = 'none';
      this.presetSettingListView.style.display = 'block';
      this.saveTavernPresetsState();
  }

  private handleDeleteTavernPreset(): void {
      if (!this.editingTavernPresetId) return;
      if (confirm('确定要删除此预设吗？')) {
          this.tavernPresets = this.tavernPresets.filter(p => p.id !== this.editingTavernPresetId);
          if (this.activeTavernPresetId === this.editingTavernPresetId) {
              this.activeTavernPresetId = this.tavernPresets.length > 0 ? this.tavernPresets[0].id : null;
          }
          this.saveTavernPresetsState();
          this.renderTavernPresetList();
          this.closePresetSettingModal();
      }
  }

  private renderPresetPrompts(preset: TavernPreset): void {
      this.presetSettingPromptList.innerHTML = '';
      const prompts = this.getPresetPrompts(preset);
      if (prompts.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'form-hint';
          empty.textContent = '没有可用的破限/提示词条目。占位、前端界面与 MVU 变量项已自动剔除。';
          this.presetSettingPromptList.appendChild(empty);
          return;
      }
      
      prompts.forEach((prompt: any, index: number) => {
          // Omit UI beautification prompts if needed or keep all and let user choose.
          // By user requirement: "没有提示词内容的分类用提示词选项". Wait, it means for category headers if `content` is empty, just display it as a specific header option.
          
          const box = document.createElement('div');
          box.className = 'tavern-prompt-card';
          box.style.background = 'var(--background-light, #ffffff)';
          box.style.border = '1px solid var(--border-color)';
          box.style.padding = '12px';
          box.style.borderRadius = '8px';
          box.style.display = 'flex';
          box.style.flexDirection = 'column';
          box.style.gap = '8px';

          const topRow = document.createElement('div');
          topRow.className = 'label-and-control';
          
          const labelWrapper = document.createElement('div');
          const title = document.createElement('div');
          title.className = 'tavern-prompt-title';
          title.style.fontWeight = 'bold';
          title.textContent = prompt.name || `选项 ${index + 1}`;
          const subTitle = document.createElement('div');
          subTitle.className = 'form-hint';
          
          let roleDesc = prompt.role || '未指定';
          if (prompt.role === 'system') roleDesc = 'System Prompt (系统提示)';
          if (prompt.role === 'user') roleDesc = 'User Prompt (用户提示)';
          if (prompt.role === 'assistant') roleDesc = 'Assistant Prefill (AI预填充)';
          
          subTitle.textContent = `角色: ${roleDesc} | 注入位置: ${prompt.injection_position ?? '未指定'} | 深度: ${prompt.injection_depth ?? '未指定'}`;
          
          labelWrapper.appendChild(title);
          labelWrapper.appendChild(subTitle);

          const toggleWrapper = document.createElement('div');
          const toggleInput = document.createElement('input');
          toggleInput.type = 'checkbox';
          toggleInput.className = 'toggle-switch';
          toggleInput.id = `preset-prompt-toggle-${index}`;
          toggleInput.checked = !!prompt.enabled;
          toggleInput.onchange = () => {
              prompt.enabled = toggleInput.checked;
              this.syncNormalizedPromptToOriginal(preset, prompt);
          };

          const toggleLabel = document.createElement('label');
          toggleLabel.setAttribute('for', toggleInput.id);
          toggleLabel.className = 'toggle-switch-label';

          toggleWrapper.appendChild(toggleInput);
          toggleWrapper.appendChild(toggleLabel);
          
          topRow.appendChild(labelWrapper);
          topRow.appendChild(toggleWrapper);
          box.appendChild(topRow);

          if (prompt.content !== undefined) {
              const contentInput = document.createElement('textarea');
              contentInput.className = 'input-control';
              contentInput.style.fontSize = '12px';
              contentInput.style.marginTop = '4px';
              contentInput.style.resize = 'vertical';
              contentInput.rows = 3;
              contentInput.value = prompt.content;
              contentInput.placeholder = '提示词内容...';
              contentInput.oninput = () => {
                  prompt.content = contentInput.value;
                  this.syncNormalizedPromptToOriginal(preset, prompt);
              };
              box.appendChild(contentInput);
          }

          this.presetSettingPromptList.appendChild(box);
      });
  }

  private handleImportData(event: Event): void {
      const input = event.target as HTMLInputElement;
      if (!input.files || input.files.length === 0) return;
      
      const file = input.files[0];
      if (!confirm(`确定要从 "${file.name}" 导入数据吗？\n这将覆盖所有现有设置、API密钥和会话记录。此操作无法撤销。`)) {
          input.value = ''; // Reset file input
          return;
      }
      
      const reader = new FileReader();
      reader.onload = (e) => {
          try {
              const data = JSON.parse(e.target?.result as string);
              if (!data.apiKeys || !data.sessions) {
                  throw new Error('无效的导入文件格式。');
              }

              // Load default settings if they exist in the backup
              if (data.settings) {
                  this.systemInstruction = data.settings.systemInstruction ?? '';
                  this.temperature = data.settings.temperature ?? 1.0;
                  this.isDataMemoryEnabled = false;
              }

              this.apiKeys = data.apiKeys;
              this.activeApiKeyName = data.activeApiKeyName;
              this.sessions = data.sessions;
              this.activeSessionId = data.activeSessionId;

              this.saveDefaultSettings();
              this.saveApiKeys();
              this.saveActiveApiKeyName();
              this.saveActiveSessionId();

              // Migration logic for per-session settings just in case
              Object.values(this.sessions).forEach(session => {
                  if (!session.dataMemory) session.dataMemory = {};
                  if (session.systemInstruction === undefined) session.systemInstruction = this.systemInstruction;
                  if (session.temperature === undefined) session.temperature = this.temperature;
                  if (session.modelName === undefined) session.modelName = this.modelName;
                  if (session.contextLength === undefined) session.contextLength = this.contextLength;
                  if (session.maxResponseLength === undefined) session.maxResponseLength = this.maxResponseLength;
                  if (session.isStreaming === undefined) session.isStreaming = this.isStreaming;
                  if (session.isShowCoTEnabled === undefined) session.isShowCoTEnabled = this.isShowCoTEnabled;
                  if (session.isDataMemoryEnabled === undefined) session.isDataMemoryEnabled = false;
                  if (session.isAutoAdvanceEnabled === undefined) session.isAutoAdvanceEnabled = this.isAutoAdvanceEnabled;
                  if (session.autoAdvancePrompt === undefined) session.autoAdvancePrompt = this.autoAdvancePrompt;
                  if (session.isAutoRetryEnabled === undefined) session.isAutoRetryEnabled = this.isAutoRetryEnabled;
              });

              this.saveSessions(true);

              this.renderAll();
              this.initializeChat();

              this.appendMessage('数据导入成功！已加载所有设置和会话记录。', 'ai');
              this.closeSettingsSidebar();

          } catch (error) {
              const errorMessage = error instanceof Error ? error.message : '未知错误';
              alert(`导入失败: ${errorMessage}`);
          } finally {
              input.value = '';
          }
      };
      reader.readAsText(file);
  }

  private async handleImportAiStudio(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
        input.value = '';
        return;
    }

    const file = input.files[0];
    const LARGE_FILE_THRESHOLD = 500 * 1024; // 500 KB
    const isMobile = window.innerWidth < 768;

    if (!isMobile || file.size < LARGE_FILE_THRESHOLD) {
        // Original synchronous logic for desktop or small files
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);
                if (!data.chunkedPrompt || !Array.isArray(data.chunkedPrompt.chunks)) {
                    throw new Error('无效的 AI Studio 文件格式：缺少 chunkedPrompt.chunks 数组。');
                }

                const isSystemInstruction = (text: string) => {
                    return text.includes('Output integrity guard:') || 
                           text.includes('Reasoning Effort:') || 
                           text.includes('<agent_instructions>') || 
                           text.includes('<environment_constraints>');
                };

                const history: Content[] = data.chunkedPrompt.chunks
                    .filter((chunk: any) => !chunk.isThought && chunk.text && (chunk.role === 'user' || chunk.role === 'model') && !isSystemInstruction(chunk.text))
                    .map((chunk: any) => ({ role: chunk.role, parts: [{ text: chunk.text }] }));

                if (history.length === 0) {
                    throw new Error('在文件中未找到有效的对话历史记录。');
                }

                const sessionName = file.name.replace(/\.txt$|\.json$/i, '') || '导入的会话';
                const id = Date.now().toString();

                this.sessions[id] = {
                    id, name: sessionName, createdAt: new Date().toISOString(),
                    history, dataMemory: {}
                    // No scrollTop, so it defaults to bottom
                };

                this.saveSessions();
                this.switchSession(id);
                this.appendSystemNotification(`成功从 "${file.name}" 导入会话。`);

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : '未知错误。';
                alert(`导入 AI Studio 文件失败: ${errorMessage}`);
                console.error(error);
            } finally {
                input.value = '';
            }
        };
        reader.readAsText(file);
        return;
    }

    // New asynchronous logic for large files on mobile
    let notification: HTMLElement | null = null;
    try {
        notification = this.appendSystemNotification(`正在读取大文件 "${file.name}"...`);
        this.closeSettingsSidebar();

        const fileContent = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = () => reject(new Error("文件读取失败。"));
            reader.readAsText(file);
        });

        notification.textContent = `正在解析文件内容...`;
        await new Promise(resolve => setTimeout(resolve, 50));

        const data = JSON.parse(fileContent);
        if (!data.chunkedPrompt || !Array.isArray(data.chunkedPrompt.chunks)) {
            throw new Error('无效的 AI Studio 文件格式：缺少 chunkedPrompt.chunks 数组。');
        }

        notification.textContent = '正在处理对话记录 (0%)...';
        await new Promise(resolve => setTimeout(resolve, 50));

        const sourceChunks = data.chunkedPrompt.chunks;
        const history: Content[] = [];
        const batchSize = 1000;

        for (let i = 0; i < sourceChunks.length; i += batchSize) {
            const batch = sourceChunks.slice(i, i + batchSize);

        const isSystemInstruction = (text: string) => {
            if (!text) return false;
            const lowerText = text.toLowerCase();
            return lowerText.includes('output integrity guard') || 
                   lowerText.includes('reasoning effort:') || 
                   lowerText.includes('<agent_instructions>') || 
                   lowerText.includes('<environment_constraints>') ||
                   lowerText.includes('continue from the latest state in the attached') ||
                   lowerText.includes('treat it as the current working state') ||
                   lowerText.includes('system prompt:') ||
                   lowerText.includes('<system_instructions>');
        };

        const processedBatch = batch
            .filter((chunk: any) => !chunk.isThought && chunk.text && (chunk.role === 'user' || chunk.role === 'model') && !isSystemInstruction(chunk.text))
            .map((chunk: any) => ({ role: chunk.role, parts: [{ text: chunk.text }] }));

            history.push(...processedBatch);

            const progress = Math.min(100, Math.round(((i + batchSize) / sourceChunks.length) * 100));
            notification.textContent = `正在处理对话记录 (${progress}%)...`;

            await new Promise(resolve => setTimeout(resolve, 20));
        }

        if (history.length === 0) {
            throw new Error('在文件中未找到有效的对话历史记录。');
        }

        const sessionName = file.name.replace(/\.txt$|\.json$/i, '') || '导入的会话';
        const id = Date.now().toString();

        this.sessions[id] = {
            id, name: sessionName, createdAt: new Date().toISOString(),
            history, dataMemory: {}
             // No scrollTop, so it defaults to bottom
        };

        this.saveSessions();
        this.switchSession(id);

        notification.textContent = `成功从 "${file.name}" 导入会话。`;
        notification.style.backgroundColor = 'var(--accent-green)';
        notification.style.color = 'white';

        setTimeout(() => {
            if (notification) {
                notification.style.opacity = '0';
                setTimeout(() => notification.remove(), 500);
            }
        }, 4000);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '未知错误。';
        alert(`导入 AI Studio 文件失败: ${errorMessage}`);
        if (notification) {
            notification.textContent = `导入失败: ${errorMessage}`;
            notification.style.backgroundColor = 'var(--accent-red)';
            notification.style.color = 'white';
        }
        console.error(error);
    } finally {
        input.value = '';
    }
  }

  // --- Modal Logic ---
  private showNewSessionModal(): void {
    this.newSessionModal.classList.add('visible');
    this.newSessionNameInput.focus();
  }

  private hideNewSessionModal(): void {
      this.newSessionModal.classList.remove('visible');
  }
  
  // --- Text Formatting ---
  private convertAiMarkupToHtml(text: string): string {
    // 1. Extract <thinking> blocks first before escaping
    const thinkingBlocks: string[] = [];
    let processedText = text.replace(/<(?:thinking|think|thought|Think|Thought)>([\s\S]*?)<\/(?:thinking|think|thought|Think|Thought)>/g, (match, p1) => {
        thinkingBlocks.push(p1);
        return `@@@THINKING_BLOCK_${thinkingBlocks.length - 1}@@@`;
    });

    // Handle partial open thinking blocks during streaming
    processedText = processedText.replace(/<(?:thinking|think|thought|Think|Thought)>([\s\S]*)$/g, (match, p1) => {
        thinkingBlocks.push(p1);
        return `@@@THINKING_BLOCK_${thinkingBlocks.length - 1}@@@`;
    });

    // Basic safety: escaping initial HTML to prevent injection
    let html = processedText.replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;')
                   .replace(/"/g, '&quot;')
                   .replace(/'/g, '&#039;');

    // Markdown-like syntax
    html = html.replace(/\*\*(.*?)\*\*/gs, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/gs, '<em>$1</em>');
    html = html.replace(/__(.*?)__/gs, '<u>$1</u>');
    html = html.replace(/~~(.*?)~~/gs, '<s>$1</s>');
    
    // Convert newlines to <br> tags
    html = html.replace(/\n/g, '<br>');

    // Restore thinking blocks with proper UI IF enabled
    thinkingBlocks.forEach((thinkingText, index) => {
        if (this.isShowCoTEnabled) {
            let escapedThinking = thinkingText.replace(/&/g, '&amp;')
                   .replace(/</g, '&lt;')
                   .replace(/>/g, '&gt;')
                   .replace(/"/g, '&quot;')
                   .replace(/'/g, '&#039;');
            escapedThinking = escapedThinking.replace(/\n/g, '<br>');
            html = html.replace(`@@@THINKING_BLOCK_${index}@@@`, `<details class="cot-block" open><summary>思维链</summary><div class="cot-content">${escapedThinking}</div></details>`);
        } else {
            // Remove completely
            html = html.replace(`@@@THINKING_BLOCK_${index}@@@`, '');
        }
    });

    return html;
  }


  // --- Core Chat UI Logic ---
  private autoGrowTextarea(): void {
    const maxHeight = Math.min(240, Math.max(120, window.innerHeight * 0.35));
    this.input.style.height = 'auto';
    this.input.style.height = `${Math.min(this.input.scrollHeight, maxHeight)}px`;
    this.input.style.overflowY = this.input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }
  private setFormState(submitting: boolean, placeholderText?: string): void {
    if (this.isAutoAdvanceRunning) {
        this.input.disabled = true;
        this.submitButton.disabled = true;
        this.submitButton.style.display = 'none';
        this.cancelButton.disabled = false;
        this.cancelButton.style.display = 'flex';
        this.input.placeholder = '自动推进中...';
        return;
    }
    
    this.input.disabled = submitting;
    this.submitButton.disabled = submitting;
    this.cancelButton.disabled = false;
    if (submitting) {
        this.submitButton.style.display = 'none';
        this.cancelButton.style.display = 'flex';
    } else {
        this.submitButton.style.display = 'flex';
        this.cancelButton.style.display = 'none';
    }
    this.input.placeholder = placeholderText || '输入您的消息...';
  }

  private handleCancel(): void {
      let didCancel = false;
      if (this.activeAbortController) {
          this.activeAbortController.abort();
          this.activeAbortController = null;
          didCancel = true;
      }
      if (this.isAutoAdvanceRunning) {
          this.isAutoAdvanceRunning = false;
          this.updateAutoAdvanceButton();
          didCancel = true;
      }
      this.isSubmittingMessage = false;
      this.setFormState(false);
      if (didCancel) {
          this.appendSystemNotification('已取消当前生成。');
      }
  }
  private clearChatUI(): void { this.chatContainer.innerHTML = ''; }
  private renderChatHistory(): void {
      this.clearChatUI();
      const activeSession = this.activeSessionId ? this.sessions[this.activeSessionId] : undefined;
      if (!activeSession || !activeSession.history) {
        return;
      }
  
      const history = activeSession.history;
  
      history.forEach((message, index) => {
          if (message.role === 'user') {
              this.appendMessage(message.parts, 'user', undefined, false, index);
          } else if (message.role === 'model') {
              this.appendMessage(message.parts, 'ai', undefined, false, index);
          }
      });
      
      // Use a small timeout to allow the DOM to update with all messages before scrolling.
      setTimeout(() => {
          const session = this.activeSessionId ? this.sessions[this.activeSessionId] : undefined;
          if (session && typeof session.scrollTop === 'number') {
              this.chatContainer.scrollTop = session.scrollTop;
          } else {
              // Default for old sessions without the property or for new sessions.
              this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
          }
      }, 10);
  }
  private appendSystemNotification(text: string, preventScroll: boolean = false): HTMLElement {
    const notificationElement = document.createElement('div');
    notificationElement.classList.add('system-notification');
    notificationElement.textContent = text;
    this.chatContainer.appendChild(notificationElement);
    if (!preventScroll) {
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }
    return notificationElement;
  }
  private appendMessage(content: string | any[], sender: 'user' | 'ai' | 'error', retryCallback?: () => void, preventScroll: boolean = false, messageIndex?: number): HTMLElement {
    const partsArray = Array.isArray(content) ? content : (typeof content === 'string' ? [{text: content}] : []);

    if (sender === 'user') {
        const textContent = partsArray.map(p => p.text || '').join('').trim();
        const hasFiles = partsArray.some(p => p.inlineData);
        if (!textContent && !hasFiles) {
            // It's an empty message, don't render a bubble to keep UI clean
            return document.createElement('div');
        }
    }

    const messageContainer = document.createElement('div');
    messageContainer.classList.add('message-container', `message-container-${sender}`);

    if (messageIndex === undefined && this.activeSessionId && this.sessions[this.activeSessionId]) {
        // If not provided, it's a newly pushed message (or error)
        messageIndex = sender === 'error' ? -1 : (this.sessions[this.activeSessionId].history.length - 1);
    }
    
    const shouldScroll = this.chatContainer.scrollHeight - this.chatContainer.clientHeight <= this.chatContainer.scrollTop + 1;

    if (sender === 'error') {
        const textWrapper = document.createElement('span');
        textWrapper.textContent = typeof content === 'string' ? content : partsArray.map(p=>p.text||'').join('');
        messageContainer.appendChild(textWrapper);

        if (retryCallback) {
            const retryButton = document.createElement('button');
            retryButton.className = 'retry-btn';
            retryButton.textContent = '重试';
            retryButton.onclick = (e) => {
                e.preventDefault();
                const btn = e.target as HTMLButtonElement;
                if (btn.disabled) return;
                btn.disabled = true;
                btn.textContent = '重试中...';
                messageContainer.remove();
                retryCallback();
            };
            messageContainer.appendChild(retryButton);
        }
    } else { // 'user' or 'ai'
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', sender);
        messageElement.style.display = 'flex';
        messageElement.style.flexDirection = 'column';
        messageElement.style.gap = '8px';
        
        let hasContent = false;
        
        partsArray.forEach(part => {
             if (part.text !== undefined && part.text.trim()) {
                 hasContent = true;
                 const textContainer = document.createElement('div');
                 if (sender === 'ai') {
                     textContainer.innerHTML = this.convertAiMarkupToHtml(part.text);
                 } else {
                     // For user, don't allow HTML parsing from text, unless it's intentionally set. Since user part text is pure text, textContent is correct.
                     // But we want line breaks.
                     textContainer.innerHTML = part.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
                 }
                 messageElement.appendChild(textContainer);
             }
             if (part.inlineData) {
                 hasContent = true;
                 const img = document.createElement('img');
                 img.src = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                 img.style.maxWidth = '250px';
                 img.style.maxHeight = '250px';
                 img.style.borderRadius = '8px';
                 img.style.cursor = 'pointer';
                 img.onclick = () => window.open(img.src, '_blank');
                 messageElement.appendChild(img);
             }
        });

        if (!hasContent && partsArray.length > 0) {
             hasContent = true; // Still show empty if forced
        }

        if (!hasContent) {
            messageContainer.style.display = 'none';
        }

        messageContainer.appendChild(messageElement);
    
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'message-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'action-btn-inline';
        editBtn.title = '编辑 (Edit)';
        editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`;
        editBtn.addEventListener('click', () => this.handleEditMessage(messageContainer, messageIndex!, sender));
        actionsContainer.appendChild(editBtn);

        const retryBtn = document.createElement('button');
        retryBtn.className = 'action-btn-inline';
        retryBtn.title = '重试/重新生成 (Retry)';
        retryBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M3 21v-5h5"></path></svg>`;
        retryBtn.addEventListener('click', () => this.handleRegenerate(messageIndex!));
        actionsContainer.appendChild(retryBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'action-btn-inline';
        deleteBtn.title = '删除 (Delete)';
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
        deleteBtn.addEventListener('click', () => this.handleDeleteMessage(messageIndex!));
        actionsContainer.appendChild(deleteBtn);
        
        messageContainer.appendChild(actionsContainer);
    }

    this.chatContainer.appendChild(messageContainer);
    
    if (shouldScroll && !preventScroll) {
      this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    return messageContainer;
  }

  private handleEditMessage(container: HTMLElement, index: number, sender: 'user' | 'ai'): void {
      if (!this.activeSessionId) return;
      const activeSession = this.sessions[this.activeSessionId];
      if (!activeSession || !activeSession.history[index]) return;

      const messageElement = container.querySelector('.message') as HTMLElement;
      const actionsContainer = container.querySelector('.message-actions') as HTMLElement;
      
      let currentText = activeSession.history[index].parts[0].text;
      
      // Ensure visual separation between thinking blocks and main text in the edit box
      currentText = currentText.replace(/<\/thinking>\s*/g, '</thinking>\n\n');
      
      const computedStyle = window.getComputedStyle(messageElement);
      const rect = messageElement.getBoundingClientRect();

      messageElement.style.display = 'none';
      actionsContainer.style.display = 'none';
      
      const editContainer = document.createElement('div');
      editContainer.className = 'edit-container';
      editContainer.style.width = '100%';
      editContainer.style.display = 'flex';
      editContainer.style.flexDirection = 'column';
      editContainer.style.gap = '8px';
      editContainer.style.alignItems = sender === 'user' ? 'flex-end' : 'flex-start';
      
      const textarea = document.createElement('textarea');
      textarea.value = currentText;
      textarea.className = 'edit-textarea';
      
      textarea.style.width = Math.max(rect.width, 200) + 'px';
      textarea.style.height = Math.max(rect.height, 60) + 'px';
      textarea.style.padding = computedStyle.padding;
      textarea.style.borderRadius = computedStyle.borderRadius;
      textarea.style.border = '1px solid var(--primary-color)';
      textarea.style.backgroundColor = computedStyle.backgroundColor;
      textarea.style.color = computedStyle.color;
      textarea.style.fontFamily = computedStyle.fontFamily;
      textarea.style.fontSize = computedStyle.fontSize;
      textarea.style.lineHeight = computedStyle.lineHeight;
      textarea.style.boxSizing = 'border-box';
      textarea.style.resize = 'both';
      
      const btnGroup = document.createElement('div');
      btnGroup.style.display = 'flex';
      btnGroup.style.gap = '8px';
      btnGroup.style.justifyContent = 'flex-end';
      
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = '取消';
      cancelBtn.className = 'btn-secondary';
      cancelBtn.style.padding = '4px 12px';
      cancelBtn.style.cursor = 'pointer';
      cancelBtn.onclick = () => {
          editContainer.remove();
          messageElement.style.display = 'block';
          actionsContainer.style.display = 'flex';
      };
      
      const saveBtn = document.createElement('button');
      saveBtn.textContent = '保存';
      saveBtn.className = 'btn-primary';
      saveBtn.style.padding = '4px 12px';
      saveBtn.onclick = () => {
          const newText = textarea.value;
          activeSession.history[index].parts[0].text = newText;
          this.saveSessions();
          // Update immediately
          if (sender === 'ai') {
              messageElement.innerHTML = this.convertAiMarkupToHtml(newText);
          } else {
              messageElement.textContent = newText;
          }
          this.initializeChat(); // Re-initialize with new history
          editContainer.remove();

          if (!newText.trim()) {
              container.style.display = 'none';
          } else {
              messageElement.style.display = 'block';
              actionsContainer.style.display = 'flex';
          }
      };
      
      btnGroup.appendChild(cancelBtn);
      btnGroup.appendChild(saveBtn);
      editContainer.appendChild(textarea);
      editContainer.appendChild(btnGroup);
      
      container.insertBefore(editContainer, messageElement);
      // Adjust scroll
      this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  }
  private showLoadingIndicator(): void {
    const indicator = document.createElement('div');
    indicator.id = 'loading';
    indicator.classList.add('loading-indicator');
    indicator.innerHTML = `<span></span><span></span><span></span>`;
    this.chatContainer.appendChild(indicator);
  }
  private removeLoadingIndicator(): void {
      const indicator = this.chatContainer.querySelector('#loading');
      if (indicator) indicator.remove();
  }

  private updateRegenerateCapability(): void {
      // Intentionally left empty. All AI messages can now be regenerated.
  }

  private async handleRegenerate(indexToRegenerate: number): Promise<void> {
    if ((!this.chat && !this.isCustomEndpoint && !this.modelPresets.find(p=>p.id===this.activeModelPresetId)?.isImageModel) || !this.activeSessionId) return;
    const activeSession = this.sessions[this.activeSessionId];
    if (!activeSession) return;

    let targetUserMessageIndex = -1;
    if (activeSession.history[indexToRegenerate] && activeSession.history[indexToRegenerate].role === 'user') {
        targetUserMessageIndex = indexToRegenerate;
    } else {
        // Find the closest preceding user message
        for (let i = indexToRegenerate - 1; i >= 0; i--) {
            if (activeSession.history[i].role === 'user') {
                targetUserMessageIndex = i;
                break;
            }
        }
    }

    if (targetUserMessageIndex === -1) {
        // If no prior user message found, but we clicked regenerate on an AI message, 
        // we might just resend an empty turn? Actually just ignore.
        return;
    }

    const lastUserMessage = activeSession.history[targetUserMessageIndex];

    // We want the AI to generate a response for targetUserMessage.
    // So we revert the state to just BEFORE the target user message was sent!
    activeSession.history.splice(targetUserMessageIndex);

    // Sync the stateful Chat object with our now-corrected history (which ends in a model message).
    this.initializeChat();
    if (!this.chat && !this.isCustomEndpoint) {
        this.appendMessage('重新生成失败：无法重新初始化聊天。', 'error');
        // Restore history
        activeSession.history.push(lastUserMessage);
        return;
    }

    // Now restore the user message to our manual history because we still want it in UI.
    activeSession.history.push(lastUserMessage);
    this.saveSessions();

    // Update UI to reflect the truncated history
    this.renderChatHistory();

    const userMessageParts = lastUserMessage.parts;
    const sessionId = this.activeSessionId;

    await this._sendMessageAndHandleResponse(userMessageParts, sessionId);
  }

  private handleDeleteMessage(messageIndex: number): void {
      if (!this.activeSessionId) return;
      const activeSession = this.sessions[this.activeSessionId];
      if (!activeSession) return;
      if (messageIndex >= 0 && messageIndex < activeSession.history.length) {
          activeSession.history.splice(messageIndex, 1);
          this.saveSessions();
          this.initializeChat();
          this.renderChatHistory();
      }
  }

  private async handleSubmit(event: Event): Promise<void> {
    event.preventDefault();

    if (this.isSubmittingMessage || this.submitButton.disabled || this.submitButton.style.display === 'none') {
        return;
    }
    
    if ((!this.chat && !this.isCustomEndpoint && !this.modelPresets.find(p=>p.id===this.activeModelPresetId)?.isImageModel) || !this.activeSessionId) {
      if (!this.activeApiKeyName) this.openSettingsSidebar('api-keys-pane');
      else this.showNewSessionModal();
      this.appendMessage('错误: 聊天未初始化。请激活密钥并选择一个会话。', 'error');
      return;
    }

    const userMessage = this.input.value;
    this.isSubmittingMessage = true;
    const parts: any[] = [];
    if (userMessage.trim()) {
        const replacedMsg = this.applyContentReplacements(userMessage.trim(), 'user');
        parts.push({ text: replacedMsg });
    } else if (this.pendingFiles.length === 0) {
        parts.push({ text: " " });
    }
    
    // add files
    for (const f of this.pendingFiles) {
        const base64Data = f.dataUrl.split(',')[1];
        parts.push({ inlineData: { data: base64Data, mimeType: f.file.type } });
    }
    
    this.pendingFiles = [];
    this.renderFilePreview();
    
    const sessionId = this.activeSessionId; // Capture session ID
    const activeSession = this.sessions[sessionId];
    activeSession.history.push({ role: 'user', parts });
    this.saveSessions();

    this.input.value = '';
    this.autoGrowTextarea();
    this.renderChatHistory(); // This will render the parts!
    
    try {
      await this._sendMessageAndHandleResponse(parts, sessionId);
    } finally {
      if (this.activeSessionId === sessionId) {
        this.isSubmittingMessage = false;
      }
    }
  }

  private async _sendMessageAndHandleResponse(messageParts: any[], sessionId: string, isAutoMessage: boolean = false): Promise<void> {
    const isImageModel = this.modelPresets.find(p => p.id === this.activeModelPresetId)?.isImageModel || false;

    if ((!this.chat && !this.isCustomEndpoint && !isImageModel) || !sessionId || !this.sessions[sessionId]) return;

    const isSessionStillActive = () => this.activeSessionId === sessionId;

    if (isSessionStillActive()) {
        if (!isAutoMessage) {
            this.setFormState(true);
        }
        this.showLoadingIndicator();
    }
    
    const originalSession = this.sessions[sessionId];
    const activeKey = this.apiKeys.find(k => k.name === this.activeApiKeyName);
    const isDataMemoryEnabledForSession = originalSession.isDataMemoryEnabled === true;
    const isContinuousOutputEnabledForSession = originalSession.isContinuousOutputEnabled === true;

    try {
      this.activeAbortController = new AbortController();
      let responseText = '';
      let thinkingText = '';
      const memoryInstruction = isDataMemoryEnabledForSession ? this.buildDataMemoryInstruction(originalSession.dataMemory) : '';
      const continuousInstruction = isContinuousOutputEnabledForSession ? "\n\n[System Rule]: 你拥有连续输出的主动权。如果需要进行多次输出以完成任务，请在当前回复的末尾精确输出 '[CONTINUE]' 标记。" : "";
      const combinedInstruction = memoryInstruction + continuousInstruction;

      const fullMessageParts = [...messageParts];
      const textPartIndex = fullMessageParts.findIndex(p => p.text !== undefined);
      if (textPartIndex !== -1) {
          fullMessageParts[textPartIndex] = { text: fullMessageParts[textPartIndex].text + combinedInstruction };
      } else if (combinedInstruction) {
          fullMessageParts.push({ text: combinedInstruction });
      }

      originalSession.history.push({ role: 'model', parts: [{ text: '' }] });
      const aiMessageIndex = originalSession.history.length - 1;
      this.saveSessions();
      
      let messageContainer: HTMLElement | null = null;
      let textElement: HTMLElement | null = null;

      try {
          if (isImageModel && this.ai) {
              const prompt = fullMessageParts.map(p => p.text || '').join('\n').trim() || 'generate an image';
              
              const response = await this.ai.models.generateImages({
                  model: this.modelName || 'imagen-3.0-generate-001',
                  prompt: prompt,
                  config: {
                      numberOfImages: 1,
                      aspectRatio: '1:1',
                      outputMimeType: 'image/jpeg'
                  }
              });
              
              if (response.generatedImages && response.generatedImages.length > 0) {
                  let imgBytes = response.generatedImages[0].image.imageBytes;
                  const mimeType = response.generatedImages[0].image.mimeType || 'image/jpeg';
                  
                  if (typeof imgBytes !== 'string') {
                      try {
                          const uint8Array = new Uint8Array(imgBytes as any);
                          const chunks = [];
                          for (let i = 0; i < uint8Array.length; i += 8192) {
                              chunks.push(String.fromCharCode.apply(null, Array.from(uint8Array.subarray(i, i + 8192))));
                          }
                          imgBytes = btoa(chunks.join(''));
                      } catch(e) {
                          console.error("Failed to convert image bytes to base64", e);
                      }
                  }

                  // Store as an inline part
                  originalSession.history[aiMessageIndex].parts = [{ inlineData: { data: imgBytes, mimeType } }];
                  
                  // Trigger UI update natively via saved state
                  this.saveSessions();
                  this.renderChatHistory();
                  
                  // We jump clear without extra text parsing
                  responseText = '';
              } else {
                  throw new Error("模型未返回任何图片。");
              }
          } else if (this.isCustomEndpoint && activeKey && activeKey.endpoint) {
          const targetUrl = this.buildOpenAICompatibleChatUrl(activeKey.endpoint);
          const url = '/api/proxy';
          
          let historyMessages = originalSession.history.slice(0, -2).map(msg => ({
              role: msg.role === 'model' ? 'assistant' : msg.role,
              content: msg.parts.map(p => p.text || (p.inlineData?'[File]':'')).join('\n')
          }));
          
          if (this.contextLength > 0) {
              historyMessages = historyMessages.slice(-this.contextLength);
          }
          
          let customSystemInstruction = originalSession.systemInstruction || '';
          const tavernPromptMessages = this.compileTavernPromptMessages();
          if (customSystemInstruction) {
              historyMessages.unshift({ role: 'system', content: customSystemInstruction });
          }
          
          const requestBody = {
              model: this.modelName || 'gemini-2.5-pro',
              messages: [...tavernPromptMessages, ...historyMessages, { role: 'user', content: fullMessageParts.map(p=>p.text||(p.inlineData?'[File]':'')).join('\n') }],
              temperature: this.temperature,
              max_tokens: this.maxResponseLength > 0 ? this.maxResponseLength : undefined,
              stream: this.isStreaming
          };

          let response: Response;
          try {
              response = await fetch(url, {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      'Authorization': this.buildAuthorizationHeader(activeKey.key),
                      'x-target-url': targetUrl
                  },
                  body: JSON.stringify(requestBody),
                  signal: this.activeAbortController.signal
              });

              if (!response.ok) await this.throwOpenAICompatibleHttpError(response);
          } catch (error: any) {
              if (error.name === 'AbortError') {
                  throw error;
              }
              if (!this.isFetchNetworkError(error)) {
                  throw error;
              }
              console.warn('Proxy request failed, falling back to direct connection:', error);
              response = await fetch(targetUrl, {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                       'Authorization': this.buildAuthorizationHeader(activeKey.key)
                  },
                  body: JSON.stringify(requestBody),
                  signal: this.activeAbortController.signal
              });

              if (!response.ok) await this.throwOpenAICompatibleHttpError(response);
          }
          
              if (this.isStreaming) {
              const reader = response.body?.getReader();
              const decoder = new TextDecoder("utf-8");
              let streamBuffer = '';
              if (!reader) throw new Error('流式读取失败');
              
              if (isSessionStillActive()) {
                  messageContainer = this.appendMessage('', 'ai');
                  messageContainer.classList.add('is-streaming');
                  textElement = messageContainer.querySelector('.message.ai') as HTMLElement;
                  this.removeLoadingIndicator();
              }
              
              while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  
                  streamBuffer += decoder.decode(value, { stream: true });
                  const lines = streamBuffer.split('\n');
                  streamBuffer = lines.pop() || '';
                  for (const line of lines) {
                      const trimmedLine = line.trim();
                      if (trimmedLine.startsWith('data: ') && trimmedLine !== 'data: [DONE]') {
                          try {
                              const data = JSON.parse(trimmedLine.substring(6));
                              if (data.error) {
                                  throw new Error(this.extractOpenAICompatibleError(data, '流式 API 返回错误'));
                              }
                              const delta = this.readOpenAICompatibleDelta(data);
                              
                              if (delta.reasoning) {
                                  thinkingText += delta.reasoning;
                              }
                              if (delta.content) {
                                  responseText += delta.content;
                              }
                              
                              if (isSessionStillActive() && (delta.reasoning || delta.content)) {
                                  let combinedHtml = (thinkingText ? `<thinking>\n${thinkingText}\n</thinking>\n\n` : '') + responseText;
                                  combinedHtml = this.applyContentReplacements(combinedHtml, 'ai');
                                  if (textElement) {
                                      textElement.innerHTML = this.convertAiMarkupToHtml(combinedHtml);
                                  }
                                  
                                  if ((responseText.trim() || thinkingText.trim()) && messageContainer && messageContainer.style.display === 'none') {
                                      messageContainer.style.display = 'flex';
                                  }
                                  if (this.chatContainer.scrollHeight - this.chatContainer.clientHeight <= this.chatContainer.scrollTop + 50) {
                                      this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
                                  }
                              }
                          } catch (e: any) {
                              if (e instanceof SyntaxError) {
                                  continue;
                              }
                              throw e;
                          }
                      }
                  }
              }
          } else {
              const data = await response.json();
              const parsedMessage = this.parseOpenAICompatibleMessage(data);
              thinkingText = parsedMessage.reasoning;
              responseText = parsedMessage.content;
          }

      } else if (!isImageModel) {
          // Google GenAI path
          let result: GenerateContentResponse;
          if (this.isStreaming && this.chat) {
              const streamResponse = await this.chat.sendMessageStream({ message: fullMessageParts });
              
              if (isSessionStillActive()) {
                  messageContainer = this.appendMessage('', 'ai');
                  messageContainer.classList.add('is-streaming');
                  textElement = messageContainer.querySelector('.message.ai') as HTMLElement;
                  this.removeLoadingIndicator();
              }

              for await (const chunk of streamResponse) {
                  responseText += chunk.text;
                  if (isSessionStillActive()) {
                      if (textElement) {
                          const replacedText = this.applyContentReplacements(responseText, 'ai');
                          textElement.innerHTML = this.convertAiMarkupToHtml(replacedText);
                      }
                      if (responseText.trim() && messageContainer && messageContainer.style.display === 'none') {
                          messageContainer.style.display = 'flex';
                      }
                      if (this.chatContainer.scrollHeight - this.chatContainer.clientHeight <= this.chatContainer.scrollTop + 50) {
                          this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
                      }
                  }
              }
          } else if (this.chat) {
              result = await this.chat.sendMessage({ message: fullMessageParts });
              responseText = result.text || '';
          }
      }
      } catch (innerError) {
          if (innerError instanceof Error && innerError.name === 'AbortError') {
              console.log('Stream aborted by user.');
              // We just let it proceed to saving the partial response
          } else {
              throw innerError;
          }
      }

      // Append complete message if we didn't already append it via streaming
      let finalSavedText = (thinkingText ? `<thinking>\n${thinkingText}\n</thinking>\n\n` : '') + responseText;

      if (!this.isStreaming && isSessionStillActive() && finalSavedText) {
          messageContainer = this.appendMessage(finalSavedText, 'ai');
      }

      if (messageContainer) {
          messageContainer.classList.remove('is-streaming');
      }

      if (isDataMemoryEnabledForSession && this.sessions[sessionId] && !isImageModel) {
        const memoryUpdate = this.extractJsonMemoryBlock(finalSavedText);

        if (memoryUpdate) {
                originalSession.dataMemory = this.deepMergeMemory(originalSession.dataMemory, memoryUpdate.data);
                this.saveSessions();

                finalSavedText = memoryUpdate.cleanedText;
                
                // If it was streaming, we also need to update the DOM to remove the memory block
                if (this.isStreaming && isSessionStillActive() && messageContainer) {
                    const localTextElement = messageContainer.querySelector('.message.ai') as HTMLElement;
                    if (localTextElement) {
                        localTextElement.innerHTML = this.convertAiMarkupToHtml(finalSavedText);
                    }
                }
                
                if (this.settingsSidebar.classList.contains('is-open') && isSessionStillActive()) {
                    this.renderDataMemoryPane();
                }
        }
      }
      
      // Apply content replacements
      finalSavedText = this.applyContentReplacements(finalSavedText, 'ai');

      // Update text part only if there was text response (image updates its own parts)
      if (!isImageModel || responseText) {
          originalSession.history[aiMessageIndex].parts[0].text = finalSavedText;
          this.saveSessions();
      }

      let triggeredContinuousOutput = false;
      if (this.isContinuousOutputEnabled && finalSavedText.includes('[CONTINUE]')) {
          triggeredContinuousOutput = true;
          finalSavedText = finalSavedText.replace(/\[CONTINUE\]/g, '').trim();
          originalSession.history[aiMessageIndex].parts[0].text = finalSavedText;
          this.saveSessions();
      }

      // Final DOM update just in case any replacements or CONTINUE block removals happened
      if (isSessionStillActive() && messageContainer && (!isImageModel || responseText)) {
          const localTextElement = messageContainer.querySelector('.message.ai') as HTMLElement;
          if (localTextElement) {
              localTextElement.innerHTML = this.convertAiMarkupToHtml(finalSavedText);
          }
      }

      if (isSessionStillActive()) {
          if (!finalSavedText && !isImageModel) {
              this.appendMessage('模型返回了空的回应。请尝试再次提问或调整设置。', 'error', () => this._sendMessageAndHandleResponse(messageParts, sessionId, isAutoMessage));
              originalSession.history.pop(); // Remove empty model response from history
              this.saveSessions();
              if (messageContainer) {
                  messageContainer.remove();
              }
              if (this.isAutoAdvanceRunning) {
                  this.isAutoAdvanceRunning = false;
                  this.appendMessage('自动推进因模型空回应而停止。', 'ai');
              }
          }
      }

      this.autoRetryAttemptedKeys = []; // On success, reset the attempted keys list for the next error cycle
      
      if (isSessionStillActive()) {
          this.removeLoadingIndicator();
      }

      if (triggeredContinuousOutput) {
          if (isSessionStillActive()) {
              this.appendSystemNotification("检测到连续输出标记，正在继续生成...");
              const continueParts = [{ text: " " }];
              originalSession.history.push({ role: 'user', parts: continueParts });
              this.saveSessions();
              this.appendMessage(continueParts[0].text, 'user');
              setTimeout(() => {
                  this._sendMessageAndHandleResponse(continueParts, sessionId, true);
              }, 1000);
          }
      } else if (this.isAutoAdvanceRunning) {
          setTimeout(() => this.sendAutoAdvanceMessage(sessionId), 1000); // 1s delay on success
      } else if (isSessionStillActive()) {
          this.setFormState(false);
          this.input.focus();
      }

    } catch (error) {
        if (isSessionStillActive()) {
            this.removeLoadingIndicator();
        }
        const errorReport = this.recordError(error, '发送消息/接收模型响应');
        let errorMessage = errorReport.message;
        
        if (isAutoMessage && this.isAutoRetryEnabled) {
            const isRateLimitError = /rate limit|429|RESOURCE_EXHAUSTED|quota/i.test(errorMessage);

            if (isRateLimitError && this.apiKeys.length > 1) {
                const currentKeyName = this.activeApiKeyName!;
                if (this.autoRetryAttemptedKeys.length === 0) {
                    this.autoRetryAttemptedKeys.push(currentKeyName);
                }

                const currentKeyIndex = this.apiKeys.findIndex(k => k.name === currentKeyName);
                const nextKeyIndex = (currentKeyIndex + 1) % this.apiKeys.length;
                const nextKey = this.apiKeys[nextKeyIndex];

                if (this.autoRetryAttemptedKeys.includes(nextKey.name)) {
                    if (isSessionStillActive()) {
                        this.appendMessage(`API速率限制：已尝试所有 ${this.apiKeys.length} 个密钥。自动推进已停止。`, 'error', undefined, true);
                        this.isAutoAdvanceRunning = false;
                        this.autoRetryAttemptedKeys = [];
                        this.updateAutoAdvanceButton();
                        this.setFormState(false);
                    }
                } else {
                    if (isSessionStillActive()) {
                        this.appendSystemNotification(`API速率限制。3秒后切换到密钥 "${nextKey.name}" 并重试...`, true);
                    }
                    this.autoRetryAttemptedKeys.push(nextKey.name);
                    this.handleSetActiveKey(nextKey.name, true);
                    setTimeout(() => this.sendAutoAdvanceMessage(sessionId), 3000);
                }
            } else {
                if (isSessionStillActive()) {
                    const reason = isRateLimitError ? "API速率限制（无其他密钥可切换）" : "发生错误";
                    this.appendSystemNotification(`${reason}。3秒后重试...`, true);
                }
                setTimeout(() => this.sendAutoAdvanceMessage(sessionId), 3000);
            }
        } else {
            if(isSessionStillActive()) {
                this.appendMessage(this.formatErrorForUser(errorReport), 'error', () => this._sendMessageAndHandleResponse(messageParts, sessionId, isAutoMessage));
                if (this.isAutoAdvanceRunning) {
                    this.isAutoAdvanceRunning = false;
                    this.appendMessage('自动推进因错误而停止。', 'error');
                    this.autoRetryAttemptedKeys = [];
                }
                this.setFormState(false);
                this.updateAutoAdvanceButton();
            }
        }
    } finally {
        if (isSessionStillActive()) {
            this.updateRegenerateCapability();
        }
    }
  }
}

new ChatApp();

