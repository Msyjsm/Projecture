// ==UserScript==
// @name         Projecture
// @namespace    https://nathanburgdorff.com/userscripts/
// @version      1.2.0
// @description  Organize and compare ChatGPT chats with native Project moves, saved multi-chat views, Drive sync, favicons, and insights.
// @author       Nathan Burgdorff + Ari (ChatGPT)
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @icon         https://chatgpt.com/favicon.ico
// @license      GPL-3.0-or-later
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    // PREVIEW_CHANNEL_ROUTING
    // Tampermonkey's URL matcher ignores hash fragments, so both installed
    // copies match the page. This runtime gate makes exactly one copy active
    // and reloads when the preview hash is toggled.
    const UserscriptBuildChannel = "production"; // PREVIEW_CHANNEL_MARKER
    const UserscriptPreviewHash = "#proj-preview";
    const UserscriptPreviewRequested =
        location.hash.toLowerCase() === UserscriptPreviewHash;

    window.addEventListener("hashchange", () => {
        const PreviewRequestedNow =
            location.hash.toLowerCase() === UserscriptPreviewHash;

        if (PreviewRequestedNow !== UserscriptPreviewRequested) {
            location.reload();
        }
    });

    if (
        (UserscriptBuildChannel === "preview") !==
        UserscriptPreviewRequested
    ) {
        return;
    }

    const IS_PREVIEW_BUILD = UserscriptBuildChannel === 'preview';
    const APP = IS_PREVIEW_BUILD ? 'Projecture [PREVIEW]' : 'Projecture';
    const PREFIX = IS_PREVIEW_BUILD ? '[Projecture Preview]' : '[Projecture]';
    const VERSION = '1.2.0';
    const STORAGE_PREFIX = IS_PREVIEW_BUILD ? 'projecture.preview' : 'projecture';
    const STORAGE_KEY = `${STORAGE_PREFIX}.settings.v1`;
    const LEGACY_STORAGE_KEY = IS_PREVIEW_BUILD ? null : 'cgptProjectOrganizer.settings.v1';
    const FAVICON_STORAGE_KEY = `${STORAGE_PREFIX}.favicons.v1`;
    const MULTICHAT_STORAGE_KEY = `${STORAGE_PREFIX}.multichats.v1`;
    const PORTABLE_STORAGE_KEY = `${STORAGE_PREFIX}.portable.v1`;
    const GOOGLE_DRIVE_CONFIG_STORAGE_KEY = `${STORAGE_PREFIX}.google-drive.v1`;
    const LEGACY_FAVICON_LOCAL_STORAGE_KEY = IS_PREVIEW_BUILD ? null : 'ChatGPTCustomFavicons';
    const BUTTON_ID = 'projecture-launcher';
    const ROOT_ID = 'projecture-root';
    const PROJECT_ID_RE = /^(g-p-[0-9a-f]{32})(?:-|$)/i;
    const PAGE_SIZE = 100;
    const MAX_CHAT_PAGES = 150;
    const MAX_PROJECT_PAGES = 60;
    const REQUEST_PAUSE_MS = 55;
    const MOVE_PAUSE_MS = 120;
    const FAVICON_CHECK_INTERVAL_MS = 2000;
    const FAVICON_FALLBACK_ID = 'projecture-favicon-fallback';
    const CLOUD_SYNC_PROTOCOL_VERSION = 1;
    const CLOUD_SYNC_DEBOUNCE_MS = 1400;
    const PORTABLE_FORMAT = 'ProjecturePortableState';
    const PORTABLE_VERSION = 1;
    const MULTICHAT_VERSION = 1;
    const MAX_COMPARE_CHATS = 4;
    const MIN_COMPARE_CHATS = 2;
    const PORTABLE_SETTING_KEYS = [
        'sort', 'view', 'compact', 'showSnippets', 'showDates', 'suggestions',
        'confirmBulkMove', 'includeArchived'
    ];
    const PORTABLE_SETTING_MAPS = ['collapsed', 'hiddenProjects', 'customColors'];

    const STOP_WORDS = new Set(`
        a an and are as at be been but by can chat chats conversation conversations could did do does doing
        for from had has have he her here hers him his how i if in into is it its me my of on or our ours
        project projects she so than that the their theirs them then there these they this those to too up us
        was we were what when where which who why will with would you your yours new old help question questions
        create creating created make making made use using used get getting got want wants wanted need needs needed
        about after again all also any because before between both each few further more most no nor not now off once
        only other out over own same should some such through under until very while work working thing things stuff
    `.trim().split(/\s+/));

    const DEFAULT_FAVICON_SETTINGS = {
        enabled: true,
        projects: {},
        chats: {},
    };

    const DEFAULT_SETTINGS = {
        sort: 'updated-desc',
        view: 'all',
        compact: false,
        showSnippets: true,
        showDates: true,
        suggestions: true,
        confirmBulkMove: true,
        includeArchived: false,
        collapsed: {},
        hiddenProjects: {},
        customColors: {},
        columnWidth: 330,
    };

    const DEFAULT_MULTICHAT_LIBRARY = {
        version: MULTICHAT_VERSION,
        views: {},
    };

    let state = {
        open: false,
        loading: false,
        loadAbort: null,
        token: null,
        projects: [],
        chats: [],
        selected: new Set(),
        visibleChatIds: [],
        lastClickedId: null,
        dragIds: [],
        undoStack: [],
        search: '',
        projectFilter: 'all',
        suggestions: new Map(),
        overlaps: [],
        status: '',
        statusKind: 'info',
        progress: '',
        settings: loadSettings(),
        rootHost: null,
        shadow: null,
        launcher: null,
        statusTimer: null,
        faviconSettings: loadFaviconSettings(),
        faviconView: 'configured',
        faviconSearch: '',
        multiChats: loadMultiChatLibrary(),
        savedMultiChatsOpen: false,
        mode: 'board',
        compare: createEmptyCompareState(),
        driveConfig: loadGoogleDriveConfig(),
        cloudStatus: 'Off',
        cloudLastSyncAt: null,
        cloudLastError: null,
    };

    let portableState = loadOrCreatePortableState();
    let cloudSyncTimer = null;
    let cloudSyncInFlight = false;
    let cloudSyncPending = false;
    let suppressPortableUpdates = false;
    let compareScrollTimer = null;
    let compareSessionCounter = 0;

    applyPortableStateToRuntime();
    state.cloudStatus = state.driveConfig?.enabled ? 'Ready' : 'Off';

    const originalFavicons = new WeakMap();
    const faviconCache = new Map();
    const faviconSessionToken = Date.now().toString(36);
    let faviconLastUrl = location.href;
    let faviconHealthTimer = null;
    let faviconUrlTimer = null;

    function log(...args) {
        console.log(PREFIX, ...args);
    }

    function warn(...args) {
        console.warn(PREFIX, ...args);
    }

    function loadSettings() {
        try {
            const current = localStorage.getItem(STORAGE_KEY);
            const legacy = LEGACY_STORAGE_KEY ? localStorage.getItem(LEGACY_STORAGE_KEY) : null;
            const rawText = current || legacy || '{}';
            const raw = JSON.parse(rawText);
            const settings = deepMerge(structuredClone(DEFAULT_SETTINGS), raw);

            if (!current && legacy) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
            }

            return settings;
        } catch {
            return structuredClone(DEFAULT_SETTINGS);
        }
    }

    function normalizeFaviconRule(rule) {
        if (typeof rule === 'string') {
            return { value: rule, enabled: true };
        }
        if (!rule || typeof rule !== 'object') return null;
        const value = String(rule.value ?? '').trim();
        if (!value) return null;
        return { value, enabled: rule.enabled !== false };
    }

    function normalizeFaviconSettings(raw) {
        const normalized = structuredClone(DEFAULT_FAVICON_SETTINGS);
        if (!raw || typeof raw !== 'object') return normalized;
        normalized.enabled = raw.enabled !== false;

        for (const type of ['projects', 'chats']) {
            const source = raw[type] && typeof raw[type] === 'object' ? raw[type] : {};
            for (const [id, rule] of Object.entries(source)) {
                const normalizedRule = normalizeFaviconRule(rule);
                if (normalizedRule) normalized[type][id] = normalizedRule;
            }
        }

        return normalized;
    }

    function loadFaviconSettings() {
        try {
            const current = localStorage.getItem(FAVICON_STORAGE_KEY);
            const legacy = LEGACY_FAVICON_LOCAL_STORAGE_KEY
                ? localStorage.getItem(LEGACY_FAVICON_LOCAL_STORAGE_KEY)
                : null;
            const settings = normalizeFaviconSettings(JSON.parse(current || legacy || '{}'));
            if (!current && legacy) localStorage.setItem(FAVICON_STORAGE_KEY, JSON.stringify(settings));
            return settings;
        } catch {
            return structuredClone(DEFAULT_FAVICON_SETTINGS);
        }
    }

    function createEmptyCompareState() {
        return {
            chatIds: [],
            conversations: new Map(),
            errors: new Map(),
            loading: new Set(),
            searches: {},
            hiddenMessages: {},
            scrollPositions: {},
            savedViewId: null,
            baselineSignature: null,
            syncScroll: false,
            syncingScroll: false,
            sessionId: 0,
        };
    }

    function normalizeSavedMultiChat(raw, fallbackId = '') {
        if (!raw || typeof raw !== 'object') return null;
        const id = String(raw.id || fallbackId || '').trim();
        const name = String(raw.name || '').trim();
        const chatIds = [...new Set((Array.isArray(raw.chatIds) ? raw.chatIds : [])
            .map(value => String(value || '').trim()).filter(Boolean))].slice(0, MAX_COMPARE_CHATS);
        if (!id || !name || chatIds.length < MIN_COMPARE_CHATS) return null;
        const positions = {};
        for (const chatId of chatIds) {
            const value = Number(raw.scrollPositions?.[chatId]);
            positions[chatId] = Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
        }
        return {
            id,
            name,
            chatIds,
            scrollPositions: positions,
            createdAt: raw.createdAt || new Date().toISOString(),
            updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
        };
    }

    function loadMultiChatLibrary() {
        try {
            const parsed = JSON.parse(localStorage.getItem(MULTICHAT_STORAGE_KEY) || '{}');
            const library = structuredClone(DEFAULT_MULTICHAT_LIBRARY);
            const source = parsed?.views && typeof parsed.views === 'object' ? parsed.views : {};
            for (const [id, raw] of Object.entries(source)) {
                const normalized = normalizeSavedMultiChat(raw, id);
                if (normalized) library.views[id] = normalized;
            }
            return library;
        } catch {
            return structuredClone(DEFAULT_MULTICHAT_LIBRARY);
        }
    }

    function loadGoogleDriveConfig() {
        try {
            const raw = JSON.parse(localStorage.getItem(GOOGLE_DRIVE_CONFIG_STORAGE_KEY) || 'null');
            if (!raw || typeof raw !== 'object') return null;
            const endpoint = String(raw.endpoint || '').trim();
            const secret = String(raw.secret || '').trim();
            if (!endpoint || !secret) return null;
            return { version: 1, endpoint, secret, enabled: raw.enabled !== false };
        } catch {
            return null;
        }
    }

    function saveGoogleDriveConfig() {
        localStorage.setItem(GOOGLE_DRIVE_CONFIG_STORAGE_KEY, JSON.stringify(state.driveConfig));
    }

    function timestampRecord(value, updatedAt = Date.now(), deleted = false) {
        const numericTimestamp = Number(updatedAt);
        return {
            value: deleted ? null : structuredClone(value),
            updatedAt: Number.isFinite(numericTimestamp) && numericTimestamp >= 0 ? numericTimestamp : Date.now(),
            deleted: !!deleted,
        };
    }

    function nextTimestampRecord(current, value, deleted = false) {
        return timestampRecord(
            value,
            Math.max(Date.now(), (Number(current?.updatedAt) || 0) + 1),
            deleted
        );
    }

    function emptyPortableState() {
        return {
            format: PORTABLE_FORMAT,
            version: PORTABLE_VERSION,
            settings: { scalars: {}, maps: Object.fromEntries(PORTABLE_SETTING_MAPS.map(key => [key, {}])) },
            favicons: { enabled: null, projects: {}, chats: {} },
            multiChats: {},
        };
    }

    function buildPortableStateFromRuntime(updatedAt = Date.now()) {
        const result = emptyPortableState();
        for (const key of PORTABLE_SETTING_KEYS) {
            result.settings.scalars[key] = timestampRecord(state.settings[key], updatedAt);
        }
        for (const mapName of PORTABLE_SETTING_MAPS) {
            for (const [id, value] of Object.entries(state.settings[mapName] || {})) {
                result.settings.maps[mapName][id] = timestampRecord(value, updatedAt);
            }
        }
        result.favicons.enabled = timestampRecord(state.faviconSettings.enabled !== false, updatedAt);
        for (const type of ['projects', 'chats']) {
            for (const [id, value] of Object.entries(state.faviconSettings[type] || {})) {
                result.favicons[type][id] = timestampRecord(normalizeFaviconRule(value), updatedAt);
            }
        }
        for (const [id, view] of Object.entries(state.multiChats.views || {})) {
            result.multiChats[id] = timestampRecord(normalizeSavedMultiChat(view, id), updatedAt);
        }
        return result;
    }

    function normalizeTimestampRecord(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const updatedAt = Number(raw.updatedAt);
        if (!Number.isFinite(updatedAt) || updatedAt < 0) return null;
        return { value: raw.deleted ? null : structuredClone(raw.value), updatedAt, deleted: !!raw.deleted };
    }

    function normalizePortableState(raw) {
        if (!raw || raw.format !== PORTABLE_FORMAT || Number(raw.version) !== PORTABLE_VERSION) {
            throw new Error('Unsupported Projecture portable-state format.');
        }
        const normalized = emptyPortableState();
        for (const key of PORTABLE_SETTING_KEYS) {
            const record = normalizeTimestampRecord(raw.settings?.scalars?.[key]);
            if (record) normalized.settings.scalars[key] = record;
        }
        for (const mapName of PORTABLE_SETTING_MAPS) {
            for (const [id, rawRecord] of Object.entries(raw.settings?.maps?.[mapName] || {})) {
                const record = normalizeTimestampRecord(rawRecord);
                if (record) normalized.settings.maps[mapName][id] = record;
            }
        }
        normalized.favicons.enabled = normalizeTimestampRecord(raw.favicons?.enabled);
        for (const type of ['projects', 'chats']) {
            for (const [id, rawRecord] of Object.entries(raw.favicons?.[type] || {})) {
                const record = normalizeTimestampRecord(rawRecord);
                if (record) normalized.favicons[type][id] = record;
            }
        }
        for (const [id, rawRecord] of Object.entries(raw.multiChats || {})) {
            const record = normalizeTimestampRecord(rawRecord);
            if (record) normalized.multiChats[id] = record;
        }
        return normalized;
    }

    function loadOrCreatePortableState() {
        try {
            const current = localStorage.getItem(PORTABLE_STORAGE_KEY);
            if (current) return normalizePortableState(JSON.parse(current));
        } catch (error) {
            warn('Could not read portable state; rebuilding it from local Projecture settings.', error);
        }
        const hadDurableProjectureState = !!(
            localStorage.getItem(STORAGE_KEY) ||
            localStorage.getItem(FAVICON_STORAGE_KEY) ||
            localStorage.getItem(MULTICHAT_STORAGE_KEY) ||
            (LEGACY_STORAGE_KEY && localStorage.getItem(LEGACY_STORAGE_KEY)) ||
            (LEGACY_FAVICON_LOCAL_STORAGE_KEY && localStorage.getItem(LEGACY_FAVICON_LOCAL_STORAGE_KEY))
        );
        const created = buildPortableStateFromRuntime(hadDurableProjectureState ? Date.now() : 0);
        localStorage.setItem(PORTABLE_STORAGE_KEY, JSON.stringify(created));
        return created;
    }

    function valuesEqual(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    function syncRecordMapFromValues(records, values, normalizer = value => value) {
        const ids = new Set([...Object.keys(records || {}), ...Object.keys(values || {})]);
        for (const id of ids) {
            const hasValue = Object.prototype.hasOwnProperty.call(values || {}, id);
            const current = records[id];
            if (!hasValue) {
                if (current && !current.deleted) records[id] = nextTimestampRecord(current, null, true);
                continue;
            }
            const value = normalizer(values[id], id);
            if (value == null) {
                if (current && !current.deleted) records[id] = nextTimestampRecord(current, null, true);
            } else if (!current || current.deleted || !valuesEqual(current.value, value)) {
                records[id] = nextTimestampRecord(current, value);
            }
        }
    }

    function updatePortableSettingsFromRuntime() {
        for (const key of PORTABLE_SETTING_KEYS) {
            const current = portableState.settings.scalars[key];
            if (!current || current.deleted || !valuesEqual(current.value, state.settings[key])) {
                portableState.settings.scalars[key] = nextTimestampRecord(current, state.settings[key]);
            }
        }
        for (const mapName of PORTABLE_SETTING_MAPS) {
            syncRecordMapFromValues(portableState.settings.maps[mapName], state.settings[mapName] || {});
        }
    }

    function updatePortableFaviconsFromRuntime() {
        const enabled = state.faviconSettings.enabled !== false;
        const current = portableState.favicons.enabled;
        if (!current || current.deleted || current.value !== enabled) {
            portableState.favicons.enabled = nextTimestampRecord(current, enabled);
        }
        for (const type of ['projects', 'chats']) {
            syncRecordMapFromValues(portableState.favicons[type], state.faviconSettings[type] || {}, normalizeFaviconRule);
        }
    }

    function updatePortableMultiChatsFromRuntime() {
        syncRecordMapFromValues(portableState.multiChats, state.multiChats.views || {}, (view, id) => normalizeSavedMultiChat(view, id));
    }

    function persistPortableState({ scheduleSync = true } = {}) {
        localStorage.setItem(PORTABLE_STORAGE_KEY, JSON.stringify(portableState));
        if (scheduleSync && !suppressPortableUpdates) scheduleCloudSync();
    }

    function applyPortableStateToRuntime() {
        suppressPortableUpdates = true;
        try {
            for (const key of PORTABLE_SETTING_KEYS) {
                const record = portableState.settings.scalars[key];
                if (record && !record.deleted) state.settings[key] = structuredClone(record.value);
            }
            for (const mapName of PORTABLE_SETTING_MAPS) {
                const values = {};
                for (const [id, record] of Object.entries(portableState.settings.maps[mapName] || {})) {
                    if (!record.deleted) values[id] = structuredClone(record.value);
                }
                state.settings[mapName] = values;
            }

            const favicons = structuredClone(DEFAULT_FAVICON_SETTINGS);
            if (portableState.favicons.enabled && !portableState.favicons.enabled.deleted) {
                favicons.enabled = portableState.favicons.enabled.value !== false;
            }
            for (const type of ['projects', 'chats']) {
                for (const [id, record] of Object.entries(portableState.favicons[type] || {})) {
                    if (record.deleted) continue;
                    const rule = normalizeFaviconRule(record.value);
                    if (rule) favicons[type][id] = rule;
                }
            }
            state.faviconSettings = favicons;

            const library = structuredClone(DEFAULT_MULTICHAT_LIBRARY);
            for (const [id, record] of Object.entries(portableState.multiChats || {})) {
                if (record.deleted) continue;
                const view = normalizeSavedMultiChat(record.value, id);
                if (view) library.views[id] = view;
            }
            state.multiChats = library;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
            localStorage.setItem(FAVICON_STORAGE_KEY, JSON.stringify(state.faviconSettings));
            localStorage.setItem(MULTICHAT_STORAGE_KEY, JSON.stringify(state.multiChats));
        } finally {
            suppressPortableUpdates = false;
        }
    }

    function saveSettings() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
        if (!suppressPortableUpdates) {
            const before = JSON.stringify(portableState);
            updatePortableSettingsFromRuntime();
            persistPortableState({ scheduleSync: before !== JSON.stringify(portableState) });
        }
    }

    function saveFaviconSettings() {
        localStorage.setItem(FAVICON_STORAGE_KEY, JSON.stringify(state.faviconSettings));
        if (!suppressPortableUpdates) {
            const before = JSON.stringify(portableState);
            updatePortableFaviconsFromRuntime();
            persistPortableState({ scheduleSync: before !== JSON.stringify(portableState) });
        }
    }

    function saveMultiChatLibrary() {
        localStorage.setItem(MULTICHAT_STORAGE_KEY, JSON.stringify(state.multiChats));
        if (!suppressPortableUpdates) {
            const before = JSON.stringify(portableState);
            updatePortableMultiChatsFromRuntime();
            persistPortableState({ scheduleSync: before !== JSON.stringify(portableState) });
        }
    }

    function compareTimestampRecords(left, right) {
        if (!left) return right ? structuredClone(right) : null;
        if (!right) return structuredClone(left);
        if (right.updatedAt > left.updatedAt) return structuredClone(right);
        if (left.updatedAt > right.updatedAt) return structuredClone(left);
        return JSON.stringify(right).localeCompare(JSON.stringify(left)) > 0
            ? structuredClone(right)
            : structuredClone(left);
    }

    function mergeRecordMaps(left = {}, right = {}) {
        const merged = {};
        for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
            const record = compareTimestampRecords(left[id], right[id]);
            if (record) merged[id] = record;
        }
        return merged;
    }

    function mergePortableStates(localRaw, remoteRaw) {
        const local = normalizePortableState(localRaw);
        const remote = normalizePortableState(remoteRaw);
        const merged = emptyPortableState();
        merged.settings.scalars = mergeRecordMaps(local.settings.scalars, remote.settings.scalars);
        for (const mapName of PORTABLE_SETTING_MAPS) {
            merged.settings.maps[mapName] = mergeRecordMaps(local.settings.maps[mapName], remote.settings.maps[mapName]);
        }
        merged.favicons.enabled = compareTimestampRecords(local.favicons.enabled, remote.favicons.enabled);
        merged.favicons.projects = mergeRecordMaps(local.favicons.projects, remote.favicons.projects);
        merged.favicons.chats = mergeRecordMaps(local.favicons.chats, remote.favicons.chats);
        merged.multiChats = mergeRecordMaps(local.multiChats, remote.multiChats);
        return merged;
    }

    function configureGoogleDriveSync() {
        const endpointInput = prompt(
            'Google Drive sync uses a small Google Apps Script bridge that you own.\n\nPaste its deployed Web App URL (/exec) here. Leave this blank to disconnect Drive sync.',
            state.driveConfig?.endpoint || ''
        );
        if (endpointInput === null) return;
        const endpoint = endpointInput.trim();
        if (!endpoint) {
            if (state.driveConfig && confirm('Disconnect Google Drive sync on this browser?')) {
                state.driveConfig = null;
                saveGoogleDriveConfig();
                state.cloudStatus = 'Off';
                state.cloudLastError = null;
                render();
            }
            return;
        }
        if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/i.test(endpoint)) {
            alert('That does not look like a deployed Google Apps Script Web App URL. It should begin with https://script.google.com/macros/s/ and end with /exec.');
            return;
        }
        const secretInput = prompt('Paste the Projecture sync secret printed by the bridge\'s Setup() function.', state.driveConfig?.secret || '');
        if (secretInput === null) return;
        const secret = secretInput.trim();
        if (!secret) {
            alert('A non-empty sync secret is required.');
            return;
        }
        state.driveConfig = { version: 1, endpoint, secret, enabled: true };
        saveGoogleDriveConfig();
        state.cloudStatus = 'Ready';
        state.cloudLastError = null;
        render();
        syncWithGoogleDrive({ manual: true });
    }

    function scheduleCloudSync(delayMs = CLOUD_SYNC_DEBOUNCE_MS) {
        if (!state.driveConfig?.enabled || suppressPortableUpdates) return;
        clearTimeout(cloudSyncTimer);
        cloudSyncTimer = setTimeout(() => {
            cloudSyncTimer = null;
            syncWithGoogleDrive();
        }, Math.max(0, delayMs));
    }

    function googleDriveBridgeRequest(action, payload = {}) {
        if (!state.driveConfig?.enabled || typeof GM_xmlhttpRequest !== 'function') {
            return Promise.reject(new Error('Google Drive sync is not configured or Tampermonkey did not grant cross-origin access.'));
        }
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: state.driveConfig.endpoint,
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                data: JSON.stringify({
                    ProtocolVersion: CLOUD_SYNC_PROTOCOL_VERSION,
                    Secret: state.driveConfig.secret,
                    Action: action,
                    ...payload,
                }),
                timeout: 30000,
                onload: response => {
                    try {
                        if (response.status < 200 || response.status >= 300) {
                            throw new Error(`Google Drive bridge returned HTTP ${response.status}.`);
                        }
                        const parsed = JSON.parse(response.responseText);
                        if (!parsed || typeof parsed !== 'object') throw new Error('Google Drive bridge returned an invalid response.');
                        if (parsed.Status === 'error') throw new Error(parsed.Message || 'Google Drive bridge reported an error.');
                        resolve(parsed);
                    } catch (error) {
                        reject(error);
                    }
                },
                onerror: () => reject(new Error('Could not reach the Google Drive sync bridge.')),
                ontimeout: () => reject(new Error('Google Drive sync timed out.')),
            });
        });
    }

    async function syncWithGoogleDrive({ manual = false } = {}) {
        if (!state.driveConfig?.enabled) {
            if (manual) configureGoogleDriveSync();
            return;
        }
        if (cloudSyncInFlight) {
            cloudSyncPending = true;
            return;
        }
        cloudSyncInFlight = true;
        cloudSyncPending = false;
        state.cloudStatus = 'Syncing';
        state.cloudLastError = null;
        render();
        try {
            let completed = false;
            for (let attempt = 0; attempt < 3 && !completed; attempt++) {
                const remote = await googleDriveBridgeRequest('Read');
                const revision = Number(remote.Revision) || 0;
                if (remote.Data) {
                    portableState = mergePortableStates(portableState, remote.Data);
                    localStorage.setItem(PORTABLE_STORAGE_KEY, JSON.stringify(portableState));
                    applyPortableStateToRuntime();
                }
                const write = await googleDriveBridgeRequest('Write', {
                    ExpectedRevision: revision,
                    Data: normalizePortableState(portableState),
                });
                if (write.Status === 'conflict') continue;
                if (write.Status !== 'ok') throw new Error(write.Message || 'Google Drive sync write failed.');
                completed = true;
                state.cloudLastSyncAt = new Date().toISOString();
            }
            if (!completed) throw new Error('Google Drive changed repeatedly during sync. Please try again.');
            state.cloudStatus = 'Synced';
            syncFavicon();
            render();
        } catch (error) {
            state.cloudStatus = 'Error';
            state.cloudLastError = error;
            console.error(PREFIX, 'Google Drive sync failed.', error);
            render();
            if (manual) alert(`Google Drive sync failed: ${error?.message || String(error)}`);
        } finally {
            cloudSyncInFlight = false;
            if (cloudSyncPending) {
                cloudSyncPending = false;
                scheduleCloudSync(250);
            }
        }
    }

    function deepMerge(base, patch) {
        if (!patch || typeof patch !== 'object') return base;
        for (const [key, value] of Object.entries(patch)) {
            if (value && typeof value === 'object' && !Array.isArray(value) && typeof base[key] === 'object') {
                base[key] = deepMerge(base[key] || {}, value);
            } else {
                base[key] = value;
            }
        }
        return base;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function normalizeProjectId(value) {
        if (!value) return null;
        const match = String(value).match(PROJECT_ID_RE);
        return match ? match[1] : null;
    }

    function dateValue(value) {
        if (value == null || value === '') return 0;
        if (typeof value === 'number') return value > 10_000_000_000 ? value : value * 1000;
        const numeric = Number(value);
        if (Number.isFinite(numeric) && String(value).trim() !== '') {
            return numeric > 10_000_000_000 ? numeric : numeric * 1000;
        }
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    function formatDate(value) {
        const ms = dateValue(value);
        if (!ms) return '';
        const d = new Date(ms);
        const today = new Date();
        const sameYear = d.getFullYear() === today.getFullYear();
        return new Intl.DateTimeFormat(undefined, {
            month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' })
        }).format(d);
    }

    function formatDateTime(value) {
        const ms = dateValue(value);
        if (!ms) return '';
        return new Intl.DateTimeFormat(undefined, {
            year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        }).format(new Date(ms));
    }

    function hashString(str) {
        let hash = 2166136261;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    function fallbackColor(project) {
        const hue = hashString(project.id || project.name) % 360;
        return `hsl(${hue} 68% 48%)`;
    }

    function validCssColor(value) {
        if (!value || typeof value !== 'string') return null;
        const s = value.trim();
        if (!s || s.length > 80) return null;
        if (/^(#(?:[0-9a-f]{3,8})|rgb\(|rgba\(|hsl\(|hsla\(|oklch\(|oklab\(|[a-z]+$)/i.test(s)) return s;
        return null;
    }

    function findColor(obj, depth = 0, seen = new Set()) {
        if (!obj || typeof obj !== 'object' || depth > 4 || seen.has(obj)) return null;
        seen.add(obj);
        const preferred = ['color', 'accent_color', 'accentColor', 'theme_color', 'themeColor', 'project_color', 'projectColor'];
        for (const key of preferred) {
            const color = validCssColor(obj[key]);
            if (color) return color;
        }
        for (const [key, value] of Object.entries(obj)) {
            if (/color/i.test(key)) {
                const color = validCssColor(value);
                if (color) return color;
            }
        }
        for (const value of Object.values(obj)) {
            if (value && typeof value === 'object') {
                const found = findColor(value, depth + 1, seen);
                if (found) return found;
            }
        }
        return null;
    }

    function projectColor(project) {
        return state.settings.customColors[project.id] || project.color || fallbackColor(project);
    }

    function tokenize(text) {
        const normalized = String(text || '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[^a-z0-9+#.]+/g, ' ')
            .trim();
        if (!normalized) return [];
        return normalized.split(/\s+/)
            .map(s => s.replace(/^\.+|\.+$/g, ''))
            .filter(s => s.length >= 2 && !STOP_WORDS.has(s) && !/^\d+$/.test(s));
    }

    function termCounts(text, weight = 1) {
        const map = new Map();
        for (const token of tokenize(text)) map.set(token, (map.get(token) || 0) + weight);
        return map;
    }

    function addCounts(target, source, multiplier = 1) {
        for (const [token, count] of source) target.set(token, (target.get(token) || 0) + count * multiplier);
        return target;
    }

    function cosineSimilarity(a, b, idf = null) {
        let dot = 0;
        let normA = 0;
        let normB = 0;
        const keys = new Set([...a.keys(), ...b.keys()]);
        for (const key of keys) {
            const weight = idf?.get(key) || 1;
            const av = (a.get(key) || 0) * weight;
            const bv = (b.get(key) || 0) * weight;
            dot += av * bv;
            normA += av * av;
            normB += bv * bv;
        }
        return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
    }

    function buildIntelligence() {
        const profiles = new Map();
        const documents = [];

        for (const project of state.projects) {
            const profile = termCounts(project.name, 7);
            if (project.description) addCounts(profile, termCounts(project.description, 2));
            const memberChats = state.chats.filter(c => c.projectId === project.id);
            for (const chat of memberChats) {
                addCounts(profile, termCounts(chat.title, 1.8));
                if (chat.snippet) addCounts(profile, termCounts(chat.snippet, 0.12));
            }
            profiles.set(project.id, profile);
            documents.push(profile);
        }

        const df = new Map();
        for (const doc of documents) {
            for (const token of doc.keys()) df.set(token, (df.get(token) || 0) + 1);
        }
        const idf = new Map();
        const n = Math.max(1, documents.length);
        for (const [token, freq] of df) idf.set(token, Math.log(1 + n / (1 + freq)) + 0.65);

        const suggestions = new Map();
        for (const chat of state.chats) {
            if (chat.projectId) continue;
            const query = termCounts(`${chat.title} ${chat.snippet || ''}`, 1);
            let best = null;
            let second = null;
            for (const project of state.projects) {
                const score = cosineSimilarity(query, profiles.get(project.id), idf);
                const row = { projectId: project.id, score };
                if (!best || score > best.score) {
                    second = best;
                    best = row;
                } else if (!second || score > second.score) {
                    second = row;
                }
            }
            if (best) {
                const margin = best.score - (second?.score || 0);
                const confidence = Math.max(0, Math.min(0.99, best.score * 1.18 + margin * 0.8));
                if (best.score >= 0.12 && (margin >= 0.02 || best.score >= 0.28)) {
                    suggestions.set(chat.id, { ...best, confidence, runnerUp: second?.projectId || null });
                }
            }
        }

        const overlaps = [];
        for (let i = 0; i < state.projects.length; i++) {
            for (let j = i + 1; j < state.projects.length; j++) {
                const a = state.projects[i];
                const b = state.projects[j];
                const score = cosineSimilarity(profiles.get(a.id), profiles.get(b.id), idf);
                const nameScore = cosineSimilarity(termCounts(a.name, 2), termCounts(b.name, 2));
                const combined = Math.max(score, score * 0.82 + nameScore * 0.18);
                if (combined >= 0.30) overlaps.push({ a: a.id, b: b.id, score: combined });
            }
        }
        overlaps.sort((x, y) => y.score - x.score);
        state.suggestions = suggestions;
        state.overlaps = overlaps.slice(0, 12);
    }

    async function getAccessToken(force = false) {
        if (state.token && !force) return state.token;
        const res = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' });
        if (!res.ok) throw new Error(`Could not read ChatGPT session (HTTP ${res.status}).`);
        const data = await res.json();
        if (!data?.accessToken) throw new Error('ChatGPT session did not return an access token. Refresh ChatGPT and try again.');
        state.token = data.accessToken;
        return state.token;
    }

    async function backendFetch(path, options = {}, retryAuth = true) {
        const token = await getAccessToken();
        const headers = new Headers(options.headers || {});
        headers.set('Authorization', `Bearer ${token}`);
        if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        const res = await fetch(path, {
            ...options,
            headers,
            credentials: 'include',
            cache: options.cache || 'no-store',
        });
        if (res.status === 401 && retryAuth) {
            state.token = null;
            await getAccessToken(true);
            return backendFetch(path, options, false);
        }
        return res;
    }

    function contentPartToText(part, unsupported) {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        const type = String(part.content_type || part.type || 'rich content');
        const labels = {
            image_asset_pointer: 'Image attachment',
            audio_asset_pointer: 'Audio attachment',
            real_time_user_audio_video_asset_pointer: 'Audio/video attachment',
            tether_quote: 'Quoted source',
        };
        unsupported.add(labels[type] || type.replaceAll('_', ' '));
        return '';
    }

    function normalizeConversationMessage(node) {
        const message = node?.message;
        if (!message) return null;
        const role = String(message.author?.role || 'unknown');
        if (role === 'system' && !message.metadata?.is_user_system_message) return null;
        const content = message.content || {};
        const unsupported = new Set();
        const parts = Array.isArray(content.parts) ? content.parts : [];
        let text = parts.map(part => contentPartToText(part, unsupported)).filter(Boolean).join('\n');
        if (!text && typeof content.text === 'string') text = content.text;
        if (!text && typeof content.result === 'string') text = content.result;
        const contentType = String(content.content_type || 'text');
        const supportedTypes = new Set(['text', 'multimodal_text', 'code', 'execution_output']);
        if (!supportedTypes.has(contentType)) unsupported.add(contentType.replaceAll('_', ' '));
        if (!text && !unsupported.size) return null;
        return {
            id: String(message.id || node.id || `message-${hashString(`${role}:${text}:${message.create_time || ''}`)}`),
            role,
            text: String(text || ''),
            contentType,
            unsupported: [...unsupported],
            createdAt: message.create_time || null,
        };
    }

    function normalizeConversationData(raw, chat) {
        const mapping = raw?.mapping && typeof raw.mapping === 'object' ? raw.mapping : {};
        const orderedNodes = [];
        const visited = new Set();
        let currentId = raw?.current_node || null;
        while (currentId && mapping[currentId] && !visited.has(currentId)) {
            visited.add(currentId);
            orderedNodes.push(mapping[currentId]);
            currentId = mapping[currentId]?.parent || null;
        }
        orderedNodes.reverse();
        if (!orderedNodes.length) {
            orderedNodes.push(...Object.values(mapping).sort((a, b) =>
                dateValue(a?.message?.create_time) - dateValue(b?.message?.create_time)));
        }
        return {
            id: chat.id,
            title: raw?.title || chat.title,
            messages: orderedNodes.map(normalizeConversationMessage).filter(Boolean),
        };
    }

    async function fetchConversationData(chatId) {
        const chat = chatById(chatId);
        if (!chat) throw new Error('This chat is no longer present in the loaded library.');
        const response = await backendFetch(`/backend-api/conversation/${encodeURIComponent(chatId)}`);
        if (!response.ok) throw new Error(`Could not load “${chat.title}” (HTTP ${response.status}).`);
        return normalizeConversationData(await response.json(), chat);
    }

    function captureCompareScrollPositions() {
        if (!state.shadow || state.mode !== 'compare') return state.compare.scrollPositions;
        state.shadow.querySelectorAll('.compare-messages[data-chat-id]').forEach(pane => {
            if (pane.querySelector('.compare-loading')) return;
            state.compare.scrollPositions[pane.dataset.chatId] = Math.max(0, Math.round(pane.scrollTop));
        });
        return state.compare.scrollPositions;
    }

    function compareSnapshot() {
        captureCompareScrollPositions();
        const positions = {};
        for (const id of state.compare.chatIds) positions[id] = Number(state.compare.scrollPositions[id]) || 0;
        return { chatIds: [...state.compare.chatIds], scrollPositions: positions };
    }

    function compareSignature(snapshot = compareSnapshot()) {
        return JSON.stringify(snapshot);
    }

    function compareIsDirty() {
        return !!state.compare.savedViewId && compareSignature() !== state.compare.baselineSignature;
    }

    function updateCompareSaveButtons() {
        if (!state.shadow || state.mode !== 'compare') return;
        const dirty = compareIsDirty();
        for (const action of ['save-multichat', 'save-as-multichat']) {
            const button = state.shadow.querySelector(`[data-action="${action}"]`);
            if (button) button.disabled = !dirty;
        }
        const label = state.shadow.getElementById('compareDirtyLabel');
        if (label) label.textContent = dirty ? 'Unsaved changes' : 'Saved';
    }

    function restoreCompareScrollPositions() {
        if (!state.shadow || state.mode !== 'compare') return;
        state.shadow.querySelectorAll('.compare-messages[data-chat-id]').forEach(pane => {
            pane.scrollTop = Number(state.compare.scrollPositions[pane.dataset.chatId]) || 0;
        });
    }

    async function openCompareView(chatIds, { savedViewId = null, scrollPositions = {} } = {}) {
        const ids = [...new Set(chatIds.map(id => String(id || '').trim()).filter(Boolean))];
        if (ids.length < MIN_COMPARE_CHATS || ids.length > MAX_COMPARE_CHATS) {
            setStatus(`Compare View requires ${MIN_COMPARE_CHATS}–${MAX_COMPARE_CHATS} chats.`, 'error', 7000);
            return;
        }
        state.mode = 'compare';
        state.compare = createEmptyCompareState();
        const sessionId = ++compareSessionCounter;
        state.compare.sessionId = sessionId;
        state.compare.chatIds = ids;
        state.compare.savedViewId = savedViewId;
        for (const id of ids) state.compare.scrollPositions[id] = Number(scrollPositions[id]) || 0;
        state.compare.baselineSignature = savedViewId ? compareSignature({
            chatIds: ids,
            scrollPositions: Object.fromEntries(ids.map(id => [id, Number(scrollPositions[id]) || 0])),
        }) : null;
        for (const id of ids) {
            if (chatById(id)) state.compare.loading.add(id);
            else state.compare.errors.set(id, 'This chat is missing from the current ChatGPT library.');
        }
        render();

        await Promise.all(ids.map(async id => {
            if (!chatById(id)) return;
            try {
                const conversation = await fetchConversationData(id);
                if (state.mode !== 'compare' || state.compare.sessionId !== sessionId) return;
                state.compare.conversations.set(id, conversation);
            } catch (error) {
                if (state.mode !== 'compare' || state.compare.sessionId !== sessionId) return;
                state.compare.errors.set(id, error?.message || String(error));
            } finally {
                if (state.mode !== 'compare' || state.compare.sessionId !== sessionId) return;
                state.compare.loading.delete(id);
                render();
            }
        }));
        restoreCompareScrollPositions();
    }

    function closeCompareView() {
        captureCompareScrollPositions();
        state.mode = 'board';
        state.compare = createEmptyCompareState();
        render();
    }

    function makeMultiChatId() {
        return `multichat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    }

    function promptForMultiChatName(defaultName = '') {
        const entered = prompt('Name this multi-chat view:', defaultName);
        if (entered === null) return null;
        const name = entered.trim();
        if (!name) {
            setStatus('A saved multi-chat needs a name.', 'error');
            return null;
        }
        return name;
    }

    function saveCurrentMultiChat({ saveAs = false } = {}) {
        if (state.mode !== 'compare') return;
        const existing = state.compare.savedViewId ? state.multiChats.views[state.compare.savedViewId] : null;
        const needsNew = !existing || saveAs;
        const name = needsNew ? promptForMultiChatName(existing?.name || '') : existing.name;
        if (!name) return;
        const snapshot = compareSnapshot();
        const now = new Date().toISOString();
        const id = needsNew ? makeMultiChatId() : existing.id;
        const view = normalizeSavedMultiChat({
            id,
            name,
            ...snapshot,
            createdAt: needsNew ? now : existing.createdAt,
            updatedAt: now,
        }, id);
        state.multiChats.views[id] = view;
        saveMultiChatLibrary();
        state.compare.savedViewId = id;
        state.compare.baselineSignature = compareSignature(snapshot);
        state.savedMultiChatsOpen = true;
        render();
        setStatus(`${needsNew ? 'Saved' : 'Updated'} multi-chat “${name}”.`, 'success');
    }

    function deleteCurrentMultiChat() {
        const id = state.compare.savedViewId;
        const view = id ? state.multiChats.views[id] : null;
        if (!view) return;
        if (!confirm(`Delete the saved multi-chat “${view.name}”?\n\nThe chats themselves will not be deleted.`)) return;
        delete state.multiChats.views[id];
        saveMultiChatLibrary();
        state.compare.savedViewId = null;
        state.compare.baselineSignature = null;
        render();
        setStatus(`Deleted saved multi-chat “${view.name}”.`, 'success');
    }

    function reorderCompareChat(chatId, direction) {
        captureCompareScrollPositions();
        const index = state.compare.chatIds.indexOf(chatId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= state.compare.chatIds.length) return;
        [state.compare.chatIds[index], state.compare.chatIds[target]] = [state.compare.chatIds[target], state.compare.chatIds[index]];
        render();
    }

    function removeCompareChat(chatId) {
        if (state.compare.chatIds.length <= MIN_COMPARE_CHATS) {
            setStatus(`A multi-chat needs at least ${MIN_COMPARE_CHATS} chats.`, 'info');
            return;
        }
        captureCompareScrollPositions();
        state.compare.chatIds = state.compare.chatIds.filter(id => id !== chatId);
        delete state.compare.scrollPositions[chatId];
        render();
    }

    async function copyConversation(chatId) {
        const conversation = state.compare.conversations.get(chatId);
        if (!conversation) return;
        const text = conversation.messages.map(message =>
            `${message.role.toUpperCase()}:\n${message.text || `[${message.unsupported.join(', ') || 'Unsupported content'}]`}`
        ).join('\n\n');
        await copyText(text);
        setStatus(`Copied “${conversation.title}”.`, 'success');
    }

    async function fetchProjects(signal) {
        const projects = [];
        let cursor = null;
        for (let page = 0; page < MAX_PROJECT_PAGES; page++) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const params = new URLSearchParams({ owned_only: 'true', conversations_per_gizmo: '0' });
            if (cursor != null) params.set('cursor', String(cursor));
            const res = await backendFetch(`/backend-api/gizmos/snorlax/sidebar?${params}`, { signal });
            if (!res.ok) throw new Error(`Could not load Projects (HTTP ${res.status}).`);
            const data = await res.json();
            for (const item of Array.isArray(data.items) ? data.items : []) {
                const outer = item?.gizmo || item;
                const g = outer?.gizmo || outer;
                if (!g?.id) continue;
                const id = normalizeProjectId(g.id);
                if (!id || !String(id).toLowerCase().startsWith('g-p-')) continue;
                projects.push({
                    id,
                    rawId: g.id,
                    name: g.display?.name || g.name || 'Untitled Project',
                    description: g.display?.description || g.description || '',
                    instructions: g.instructions || '',
                    color: findColor(g) || findColor(outer),
                    createdAt: g.created_at || null,
                    updatedAt: g.updated_at || null,
                    raw: g,
                });
            }
            cursor = data.cursor ?? null;
            if (cursor == null) break;
            await sleep(REQUEST_PAUSE_MS);
        }
        const seen = new Set();
        return projects.filter(p => p.id && !seen.has(p.id) && seen.add(p.id));
    }

    function normalizeChat(raw, forcedProjectId = undefined, archived = undefined) {
        const id = raw?.id || raw?.conversation_id;
        if (!id) return null;
        const gizmoId = raw?.gizmo_id ? String(raw.gizmo_id) : null;
        const projectId = forcedProjectId !== undefined
            ? normalizeProjectId(forcedProjectId)
            : normalizeProjectId(gizmoId);
        const origin = raw.conversation_origin || null;
        const customGptId = !projectId && gizmoId ? gizmoId : null;
        const customGptName = raw?.gizmo?.display?.name || raw?.gizmo?.name || raw?.gizmo_name || raw?.gpt_name || null;
        return {
            id,
            title: raw.title || raw.name || 'Untitled chat',
            snippet: raw.snippet || '',
            createTime: raw.create_time || raw.created_at || null,
            updateTime: raw.update_time || raw.updated_at || raw.create_time || null,
            projectId,
            archived: archived ?? raw.is_archived === true,
            starred: raw.is_starred === true,
            temporary: raw.is_temporary_chat === true,
            origin,
            gizmoId,
            customGpt: !!customGptId || /(?:^|[_-])gizmo(?:[_-]|$)|custom.?gpt/i.test(String(origin || '')),
            customGptId,
            customGptName,
        };
    }

    async function fetchConversationBucket(isArchived, signal, onProgress) {
        const chats = [];
        for (let page = 0, offset = 0; page < MAX_CHAT_PAGES; page++, offset += PAGE_SIZE) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const params = new URLSearchParams({
                offset: String(offset), limit: String(PAGE_SIZE), order: 'updated', is_archived: String(isArchived)
            });
            const res = await backendFetch(`/backend-api/conversations?${params}`, { signal });
            if (!res.ok) throw new Error(`Could not load chats (HTTP ${res.status}).`);
            const data = await res.json();
            const items = Array.isArray(data.items) ? data.items : [];
            for (const item of items) {
                const chat = normalizeChat(item, undefined, isArchived);
                if (chat) chats.push(chat);
            }
            onProgress?.(chats.length);
            if (!data.has_more && !data.hasMore && items.length < PAGE_SIZE) break;
            if (!items.length) break;
            await sleep(REQUEST_PAUSE_MS);
        }
        return chats;
    }

    async function fetchProjectChats(project, signal) {
        const chats = [];
        let cursor = '0';
        for (let page = 0; page < MAX_CHAT_PAGES; page++) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const params = new URLSearchParams({ cursor: String(cursor) });
            const res = await backendFetch(`/backend-api/gizmos/${encodeURIComponent(project.id)}/conversations?${params}`, { signal });
            if (!res.ok) throw new Error(`Could not load chats for “${project.name}” (HTTP ${res.status}).`);
            const data = await res.json();
            const items = Array.isArray(data.items) ? data.items : [];
            for (const item of items) {
                const chat = normalizeChat(item, project.id);
                if (chat) chats.push(chat);
            }
            const next = data.cursor ?? data.next_cursor ?? null;
            if (next == null || items.length === 0) break;
            cursor = next;
            await sleep(REQUEST_PAUSE_MS);
        }
        return chats;
    }

    async function mapWithConcurrency(items, concurrency, worker) {
        const results = new Array(items.length);
        let next = 0;
        async function runner() {
            while (true) {
                const index = next++;
                if (index >= items.length) return;
                results[index] = await worker(items[index], index);
            }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, runner));
        return results;
    }

    async function loadAllData() {
        if (state.loading) return;
        state.loading = true;
        state.loadAbort?.abort();
        state.loadAbort = new AbortController();
        const signal = state.loadAbort.signal;
        setProgress('Connecting to ChatGPT…');
        render();

        try {
            await getAccessToken(true);
            setProgress('Loading Projects…');
            const projects = await fetchProjects(signal);
            state.projects = projects;
            render();

            setProgress('Loading unassigned/recent chats…');
            const regular = await fetchConversationBucket(false, signal, count => {
                setProgress(`Loading chats… ${count.toLocaleString()} found`);
            });

            let archived = [];
            if (state.settings.includeArchived) {
                setProgress('Loading archived chats…');
                archived = await fetchConversationBucket(true, signal);
            }

            let completed = 0;
            const projectChunks = await mapWithConcurrency(projects, 3, async project => {
                const rows = await fetchProjectChats(project, signal);
                completed++;
                setProgress(`Loading Project chats… ${completed}/${projects.length} Projects`);
                renderProgressOnly();
                return rows;
            });

            const merged = new Map();
            for (const chat of [...regular, ...archived]) merged.set(chat.id, chat);
            for (const chunk of projectChunks) {
                for (const chat of chunk) {
                    const existing = merged.get(chat.id);
                    merged.set(chat.id, { ...existing, ...chat, archived: existing?.archived ?? chat.archived });
                }
            }

            state.chats = [...merged.values()].filter(c => state.settings.includeArchived || !c.archived);
            state.selected.clear();
            buildIntelligence();
            syncFavicon();
            setProgress('');
            setStatus(`Loaded ${state.chats.length.toLocaleString()} chats across ${projects.length.toLocaleString()} Projects.`, 'success');
        } catch (err) {
            if (err?.name !== 'AbortError') {
                console.error(PREFIX, err);
                setStatus(err?.message || String(err), 'error', 9000);
            }
        } finally {
            state.loading = false;
            render();
        }
    }

    async function setConversationProject(chatId, projectId) {
        const normalized = projectId == null ? null : normalizeProjectId(projectId);
        if (projectId != null && !normalized) throw new Error(`Invalid Project ID: ${projectId}`);
        const res = await backendFetch(`/backend-api/conversation/${encodeURIComponent(chatId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ gizmo_id: normalized }),
        });
        if (!res.ok) {
            let detail = '';
            try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
            throw new Error(`Move failed for ${chatId} (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
        }
    }

    async function moveChats(chatIds, destinationProjectId, { recordUndo = true } = {}) {
        const ids = [...new Set(chatIds)].filter(id => state.chats.some(c => c.id === id));
        if (!ids.length) return;
        const destination = destinationProjectId || null;
        const destinationName = destination ? projectById(destination)?.name || 'Project' : 'Unassigned';
        const actual = ids.filter(id => chatById(id)?.projectId !== destination);
        if (!actual.length) {
            setStatus('Those chats are already there.', 'info');
            return;
        }

        const customGptChats = destination
            ? actual.map(chatById).filter(chat => chat?.customGpt)
            : [];
        if (customGptChats.length) {
            const sample = customGptChats.slice(0, 5).map(chat => `• ${chat.title}`).join('\n');
            const remainder = customGptChats.length > 5 ? `\n• …and ${customGptChats.length - 5} more` : '';
            const noun = customGptChats.length === 1 ? 'chat was' : 'chats were';
            const pronoun = customGptChats.length === 1 ? 'it' : 'them';
            const message = [
                `Warning: ${customGptChats.length} selected ${noun} created with a Custom GPT:`,
                '',
                sample + remainder,
                '',
                `ChatGPT does not support putting Custom GPT chats inside Projects. Moving ${pronoun} to “${destinationName}” will convert ${pronoun} into ${customGptChats.length === 1 ? 'a standard ChatGPT chat' : 'standard ChatGPT chats'} and discard the Custom GPT association. Projecture cannot restore that association with Undo.`,
                '',
                `Continue with the move${actual.length > customGptChats.length ? ` of all ${actual.length} chats` : ''}?`,
            ].join('\n');
            if (!confirm(message)) return;
        } else if (actual.length > 1 && state.settings.confirmBulkMove) {
            if (!confirm(`Move ${actual.length} chats to “${destinationName}”?`)) return;
        }

        const before = actual.map(id => ({
            id,
            projectId: chatById(id)?.projectId || null,
            customGptId: chatById(id)?.customGptId || null,
        }));
        let done = 0;
        const failures = [];
        setProgress(`Moving 0/${actual.length} chats…`);
        renderProgressOnly();

        for (const id of actual) {
            try {
                await setConversationProject(id, destination);
                const chat = chatById(id);
                if (chat) {
                    chat.projectId = destination;
                    chat.gizmoId = destination;
                    if (destination && chat.customGpt) {
                        chat.customGpt = false;
                        chat.customGptId = null;
                        chat.customGptName = null;
                    }
                }
                syncFaviconIfCurrentChat(id);
                done++;
            } catch (err) {
                failures.push({ id, error: err?.message || String(err) });
                warn(err);
            }
            setProgress(`Moving ${done + failures.length}/${actual.length} chats…`);
            renderProgressOnly();
            await sleep(MOVE_PAUSE_MS);
        }

        if (recordUndo && done) {
            const successfulIds = new Set(actual.filter(id => !failures.some(f => f.id === id)));
            state.undoStack.push({
                at: Date.now(),
                label: `Move ${done} chat${done === 1 ? '' : 's'} to ${destinationName}`,
                items: before.filter(x => successfulIds.has(x.id)),
            });
            if (state.undoStack.length > 20) state.undoStack.shift();
        }

        buildIntelligence();
        setProgress('');
        if (failures.length) {
            setStatus(`Moved ${done}; ${failures.length} failed. Open DevTools for details.`, 'error', 9000);
        } else {
            setStatus(`Moved ${done} chat${done === 1 ? '' : 's'} to ${destinationName}.`, 'success');
        }
        render();
    }

    async function undoLastMove() {
        const action = state.undoStack.pop();
        if (!action) {
            setStatus('Nothing to undo yet.', 'info');
            return;
        }
        const groups = new Map();
        for (const item of action.items) {
            const key = item.projectId || '__unassigned__';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item.id);
        }
        setProgress(`Undoing ${action.items.length} chat move${action.items.length === 1 ? '' : 's'}…`);
        for (const [key, ids] of groups) {
            const target = key === '__unassigned__' ? null : key;
            for (const id of ids) {
                try {
                    await setConversationProject(id, target);
                    const chat = chatById(id);
                    if (chat) {
                        chat.projectId = target;
                        chat.gizmoId = target;
                    }
                    syncFaviconIfCurrentChat(id);
                } catch (err) {
                    warn('Undo failed:', err);
                }
                await sleep(MOVE_PAUSE_MS);
            }
        }
        buildIntelligence();
        setProgress('');
        const convertedCount = action.items.filter(item => item.customGptId).length;
        if (convertedCount) {
            setStatus(`Undid the Project placement. ${convertedCount} Custom GPT association${convertedCount === 1 ? '' : 's'} could not be restored.`, 'error', 9000);
        } else {
            setStatus(`Undid: ${action.label}`, 'success');
        }
        render();
    }

    function chatById(id) {
        return state.chats.find(c => c.id === id) || null;
    }

    function projectById(id) {
        const normalized = normalizeProjectId(id);
        return state.projects.find(p => p.id === normalized) || null;
    }

    // =========================================================================
    // Favicons
    // =========================================================================

    function currentRouteContext() {
        const path = location.pathname;
        const chatMatch = path.match(/\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        const projectMatch = path.match(/\/g\/(g-p-[0-9a-f]{32})(?:-|\/|$)/i);
        return {
            chatId: chatMatch ? chatMatch[1] : null,
            projectId: projectMatch ? normalizeProjectId(projectMatch[1]) : null,
        };
    }

    function faviconRule(type, id) {
        if (!id) return null;
        const bucket = type === 'project' ? state.faviconSettings.projects : state.faviconSettings.chats;
        return bucket[id] || null;
    }

    function enabledFaviconRule(type, id) {
        const rule = faviconRule(type, id);
        return rule && rule.enabled !== false ? rule : null;
    }

    function knownProjectIdForChat(chatId, routeProjectId = null) {
        if (!chatId) return routeProjectId || null;
        const known = chatById(chatId);
        return known ? (known.projectId || null) : (routeProjectId || null);
    }

    function desiredFavicon() {
        if (!state.faviconSettings.enabled) return null;
        const route = currentRouteContext();

        if (route.chatId) {
            const chatRule = enabledFaviconRule('chat', route.chatId);
            if (chatRule) {
                return { ...chatRule, source: 'chat', id: route.chatId };
            }
        }

        const projectId = route.chatId
            ? knownProjectIdForChat(route.chatId, route.projectId)
            : route.projectId;
        const projectRule = enabledFaviconRule('project', projectId);
        if (projectRule) {
            return { ...projectRule, source: 'project', id: projectId };
        }

        return null;
    }

    function textToPngFavicon(text) {
        if (faviconCache.has(text)) return faviconCache.get(text);

        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 64, 64);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const characterCount = Array.from(text).length;
        const fontSize = characterCount <= 1 ? 52 : characterCount === 2 ? 38 : characterCount <= 4 ? 24 : 16;
        ctx.font = `${fontSize}px "Segoe UI Emoji", "Segoe UI Symbol", Arial, sans-serif`;
        ctx.fillText(text, 32, 34);

        const result = `${canvas.toDataURL('image/png')}#projecture-${faviconSessionToken}`;
        faviconCache.set(text, result);
        return result;
    }

    function faviconInfo(value) {
        const trimmed = String(value || '').trim();
        if (/^(?:https?:|data:)/i.test(trimmed)) {
            return { href: trimmed, type: null, sizes: 'any' };
        }
        return { href: textToPngFavicon(trimmed), type: 'image/png', sizes: '64x64' };
    }

    function nativeFaviconLinks() {
        if (!document.head) return [];
        return [...document.head.querySelectorAll('link[rel~="icon"]')]
            .filter(link => link.id !== FAVICON_FALLBACK_ID);
    }

    function readAttribute(element, name) {
        return element.hasAttribute(name) ? element.getAttribute(name) : null;
    }

    function restoreAttribute(element, name, value) {
        if (value == null) {
            if (element.hasAttribute(name)) element.removeAttribute(name);
        } else if (element.getAttribute(name) !== value) {
            element.setAttribute(name, value);
        }
    }

    function rememberNativeFavicon(link) {
        if (originalFavicons.has(link)) return;
        originalFavicons.set(link, {
            href: readAttribute(link, 'href'),
            type: readAttribute(link, 'type'),
            sizes: readAttribute(link, 'sizes'),
            media: readAttribute(link, 'media'),
        });
    }

    function overrideNativeFavicon(link, info) {
        rememberNativeFavicon(link);
        if (link.getAttribute('href') !== info.href) link.setAttribute('href', info.href);
        if (info.type) {
            if (link.getAttribute('type') !== info.type) link.setAttribute('type', info.type);
        } else if (link.hasAttribute('type')) {
            link.removeAttribute('type');
        }
        if (link.getAttribute('sizes') !== info.sizes) link.setAttribute('sizes', info.sizes);
        if (link.hasAttribute('media')) link.removeAttribute('media');
    }

    function ensureFallbackFavicon(info) {
        if (!document.head) return;
        let link = document.getElementById(FAVICON_FALLBACK_ID);
        if (!link) {
            link = document.createElement('link');
            link.id = FAVICON_FALLBACK_ID;
            link.rel = 'icon';
            document.head.appendChild(link);
        }
        if (link.getAttribute('href') !== info.href) link.setAttribute('href', info.href);
        if (info.type) link.setAttribute('type', info.type); else link.removeAttribute('type');
        if (link.getAttribute('sizes') !== info.sizes) link.setAttribute('sizes', info.sizes);
    }

    function removeFallbackFavicon() {
        document.getElementById(FAVICON_FALLBACK_ID)?.remove();
    }

    function applyDesiredFavicon(desired) {
        if (!document.head) return;
        const info = faviconInfo(desired.value);
        const links = nativeFaviconLinks();
        if (!links.length) {
            ensureFallbackFavicon(info);
            return;
        }
        removeFallbackFavicon();
        for (const link of links) overrideNativeFavicon(link, info);
    }

    function restoreNativeFavicons() {
        for (const link of nativeFaviconLinks()) {
            const original = originalFavicons.get(link);
            if (!original) continue;
            restoreAttribute(link, 'href', original.href);
            restoreAttribute(link, 'type', original.type);
            restoreAttribute(link, 'sizes', original.sizes);
            restoreAttribute(link, 'media', original.media);
            originalFavicons.delete(link);
        }
        removeFallbackFavicon();
    }

    function syncFavicon() {
        if (!document.head) return;
        const desired = desiredFavicon();
        if (desired) applyDesiredFavicon(desired);
        else restoreNativeFavicons();
    }

    function handleFaviconNavigation() {
        restoreNativeFavicons();
        setTimeout(syncFavicon, 250);
        setTimeout(syncFavicon, 1200);
    }

    function startFaviconEngine() {
        clearInterval(faviconHealthTimer);
        clearInterval(faviconUrlTimer);
        faviconLastUrl = location.href;
        setTimeout(syncFavicon, 250);
        setTimeout(syncFavicon, 1200);

        faviconHealthTimer = setInterval(syncFavicon, FAVICON_CHECK_INTERVAL_MS);
        faviconUrlTimer = setInterval(() => {
            if (location.href === faviconLastUrl) return;
            faviconLastUrl = location.href;
            handleFaviconNavigation();
        }, 500);
    }

    function effectiveFaviconForChat(chat) {
        const explicit = enabledFaviconRule('chat', chat.id);
        if (explicit) return { ...explicit, source: 'chat', id: chat.id };
        const inherited = enabledFaviconRule('project', chat.projectId);
        if (inherited) return { ...inherited, source: 'project', id: chat.projectId };
        return null;
    }

    function setFaviconRule(type, id, value = null) {
        const bucket = type === 'project' ? state.faviconSettings.projects : state.faviconSettings.chats;
        const existing = bucket[id];
        const current = value ?? existing?.value ?? '';
        const entered = prompt(
            `Set a custom favicon for this ${type}.\n\nUse an emoji, short text, data URL, or image URL:`,
            current
        );
        if (entered === null) return false;
        const trimmed = entered.trim();
        if (!trimmed) {
            delete bucket[id];
        } else {
            bucket[id] = { value: trimmed, enabled: existing?.enabled !== false };
        }
        saveFaviconSettings();
        syncFavicon();
        renderFaviconsOnly();
        return true;
    }

    function toggleFaviconRule(type, id) {
        const bucket = type === 'project' ? state.faviconSettings.projects : state.faviconSettings.chats;
        const rule = bucket[id];
        if (!rule) return;
        rule.enabled = rule.enabled === false;
        saveFaviconSettings();
        syncFavicon();
        renderFaviconsOnly();
    }

    function clearFaviconRule(type, id) {
        const bucket = type === 'project' ? state.faviconSettings.projects : state.faviconSettings.chats;
        if (!bucket[id]) return;
        delete bucket[id];
        saveFaviconSettings();
        syncFavicon();
        renderFaviconsOnly();
    }

    function exportFaviconConfig() {
        const data = {
            generatedAt: new Date().toISOString(),
            projectureVersion: VERSION,
            favicons: state.faviconSettings,
        };
        download(`projecture-favicons-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
        setStatus('Exported favicon configuration.', 'success');
    }

    function importFaviconConfig() {
        const text = prompt('Paste Projecture favicon JSON. Legacy {projects:{id:"🧩"}, chats:{id:"🍆"}} format is also accepted.');
        if (!text) return;
        try {
            const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
            const source = parsed.favicons || parsed;
            state.faviconSettings = normalizeFaviconSettings(source);
            saveFaviconSettings();
            syncFavicon();
            renderFaviconsOnly();
            setStatus('Imported favicon configuration.', 'success');
        } catch (err) {
            setStatus(`Could not import favicon JSON: ${err.message}`, 'error', 9000);
        }
    }

    function syncFaviconIfCurrentChat(chatId) {
        if (currentRouteContext().chatId === chatId) syncFavicon();
    }

    function setStatus(message, kind = 'info', timeout = 4500) {
        state.status = message;
        state.statusKind = kind;
        clearTimeout(state.statusTimer);
        if (message && timeout) {
            state.statusTimer = setTimeout(() => {
                state.status = '';
                renderStatusOnly();
            }, timeout);
        }
        renderStatusOnly();
    }

    function setProgress(message) {
        state.progress = message || '';
    }

    function getFilteredChats() {
        const q = state.search.trim().toLowerCase();
        const result = state.chats.filter(chat => {
            if (state.projectFilter !== 'all') {
                const wanted = state.projectFilter === 'unassigned' ? null : state.projectFilter;
                if (chat.projectId !== wanted) return false;
            }
            if (state.settings.view === 'unassigned' && chat.projectId) return false;
            if (state.settings.view === 'suggested' && !state.suggestions.has(chat.id)) return false;
            if (state.settings.view === 'archived' && !chat.archived) return false;
            if (q) {
                const projectName = chat.projectId ? projectById(chat.projectId)?.name || '' : '';
                const hay = `${chat.title}\n${chat.snippet || ''}\n${projectName}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
        result.sort(chatComparator(state.settings.sort));
        return result;
    }

    function chatComparator(sort) {
        switch (sort) {
            case 'updated-asc': return (a, b) => dateValue(a.updateTime) - dateValue(b.updateTime);
            case 'created-desc': return (a, b) => dateValue(b.createTime) - dateValue(a.createTime);
            case 'created-asc': return (a, b) => dateValue(a.createTime) - dateValue(b.createTime);
            case 'title-asc': return (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
            case 'title-desc': return (a, b) => b.title.localeCompare(a.title, undefined, { numeric: true, sensitivity: 'base' });
            case 'updated-desc':
            default: return (a, b) => dateValue(b.updateTime) - dateValue(a.updateTime);
        }
    }

    function groupChats(filtered) {
        const groups = new Map();
        groups.set('__unassigned__', []);
        for (const p of state.projects) groups.set(p.id, []);
        for (const chat of filtered) {
            const key = chat.projectId && groups.has(chat.projectId) ? chat.projectId : '__unassigned__';
            groups.get(key).push(chat);
        }
        return groups;
    }

    function projectUrl(projectId) {
        return `${location.origin}/g/${encodeURIComponent(projectId)}/project`;
    }

    function chatUrl(chat) {
        if (chat.projectId) return `${location.origin}/g/${encodeURIComponent(chat.projectId)}/c/${encodeURIComponent(chat.id)}`;
        if (chat.customGptId) return `${location.origin}/g/${encodeURIComponent(chat.customGptId)}/c/${encodeURIComponent(chat.id)}`;
        return `${location.origin}/c/${encodeURIComponent(chat.id)}`;
    }

    function copyText(text) {
        if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        return Promise.resolve();
    }

    function download(filename, text, type = 'application/json;charset=utf-8') {
        const blob = new Blob([text], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportSnapshot() {
        const data = {
            generatedAt: new Date().toISOString(),
            projectureVersion: VERSION,
            projects: state.projects.map(p => ({ id: p.id, name: p.name, description: p.description })),
            chats: state.chats.map(c => ({
                id: c.id, title: c.title, projectId: c.projectId, createTime: c.createTime,
                updateTime: c.updateTime, archived: c.archived, snippet: c.snippet,
                customGpt: c.customGpt, customGptId: c.customGptId, customGptName: c.customGptName
            })),
            favicons: state.faviconSettings,
            savedMultiChats: state.multiChats,
            portableState: normalizePortableState(portableState),
        };
        download(`projecture-organization-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
        setStatus('Exported organization snapshot.', 'success');
    }

    function exportCsv() {
        const rows = [['ChatId', 'Title', 'ProjectId', 'ProjectName', 'CustomGpt', 'CustomGptId', 'CustomGptName', 'Created', 'Updated', 'Archived', 'Snippet']];
        for (const c of state.chats) {
            rows.push([
                c.id, c.title, c.projectId || '', c.projectId ? projectById(c.projectId)?.name || '' : '',
                String(!!c.customGpt), c.customGptId || '', c.customGptName || '', c.createTime || '',
                c.updateTime || '', String(!!c.archived), c.snippet || ''
            ]);
        }
        const csv = rows.map(row => row.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
        download(`projecture-organization-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8');
        setStatus('Exported CSV.', 'success');
    }

    async function copyAiTriagePrompt() {
        const unassigned = state.chats.filter(c => !c.projectId).map(c => ({ id: c.id, title: c.title, snippet: c.snippet || '' }));
        const projects = state.projects.map(p => ({ id: p.id, name: p.name, description: p.description || '' }));
        const payload = { projects, unassignedChats: unassigned };
        const prompt = `I want you to classify my unassigned ChatGPT chats into my existing Projects.\n\nReturn ONLY valid JSON using this exact schema:\n{"moves":[{"chatId":"<chat id>","projectId":"<project id>","confidence":0.0,"reason":"short reason"}]}\n\nRules:\n- Only include a move when confidence is at least 0.65.\n- Use only project IDs provided below.\n- Do not invent Projects.\n- Leave genuinely ambiguous chats out.\n- Classification data follows:\n\n${JSON.stringify(payload, null, 2)}`;
        await copyText(prompt);
        setStatus(`Copied AI triage prompt for ${unassigned.length} unassigned chats. Paste it into a ChatGPT chat, then import the JSON result here.`, 'success', 9000);
    }

    async function importAiPlan() {
        const text = prompt('Paste the JSON classification plan from ChatGPT. Expected: {"moves":[{"chatId":"…","projectId":"…"}]}');
        if (!text) return;
        let data;
        try {
            data = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
        } catch (err) {
            setStatus(`Invalid JSON: ${err.message}`, 'error', 9000);
            return;
        }
        const moves = Array.isArray(data?.moves) ? data.moves : [];
        const valid = moves.filter(m => chatById(m.chatId) && projectById(m.projectId));
        if (!valid.length) {
            setStatus('The plan contained no valid chat/project pairs.', 'error');
            return;
        }
        const preview = valid.slice(0, 12).map(m => `${chatById(m.chatId).title} → ${projectById(m.projectId).name}`).join('\n');
        const suffix = valid.length > 12 ? `\n…and ${valid.length - 12} more.` : '';
        if (!confirm(`Apply ${valid.length} AI-suggested moves?\n\n${preview}${suffix}`)) return;

        const grouped = new Map();
        for (const m of valid) {
            const pid = normalizeProjectId(m.projectId);
            if (!grouped.has(pid)) grouped.set(pid, []);
            grouped.get(pid).push(m.chatId);
        }
        const previousConfirm = state.settings.confirmBulkMove;
        state.settings.confirmBulkMove = false;
        try {
            for (const [pid, ids] of grouped) await moveChats(ids, pid);
        } finally {
            state.settings.confirmBulkMove = previousConfirm;
        }
    }

    function selectVisible() {
        for (const id of state.visibleChatIds) state.selected.add(id);
        render();
    }

    function deselectAll() {
        state.selected.clear();
        render();
    }

    function invertVisibleSelection() {
        for (const id of state.visibleChatIds) {
            if (state.selected.has(id)) state.selected.delete(id);
            else state.selected.add(id);
        }
        render();
    }

    function onCardSelectionClick(chatId, event) {
        const visible = state.visibleChatIds;
        if (event.shiftKey && state.lastClickedId && visible.includes(state.lastClickedId)) {
            const a = visible.indexOf(state.lastClickedId);
            const b = visible.indexOf(chatId);
            const [start, end] = a < b ? [a, b] : [b, a];
            const shouldSelect = !state.selected.has(chatId);
            for (const id of visible.slice(start, end + 1)) {
                if (shouldSelect) state.selected.add(id); else state.selected.delete(id);
            }
        } else {
            if (state.selected.has(chatId)) state.selected.delete(chatId); else state.selected.add(chatId);
        }
        state.lastClickedId = chatId;
        render();
    }

    function handleDragStart(chatId, event) {
        const ids = state.selected.has(chatId) ? [...state.selected] : [chatId];
        state.dragIds = ids;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', JSON.stringify(ids));
        setTimeout(() => event.currentTarget?.classList.add('dragging'), 0);
    }

    function handleDragEnd(event) {
        event.currentTarget?.classList.remove('dragging');
        state.dragIds = [];
        state.shadow?.querySelectorAll('.column.drop-target').forEach(el => el.classList.remove('drop-target'));
    }

    function readDragIds(event) {
        try {
            const parsed = JSON.parse(event.dataTransfer.getData('text/plain') || '[]');
            if (Array.isArray(parsed)) return parsed;
        } catch { /* ignore */ }
        return state.dragIds || [];
    }

    function renderLauncher() {
        if (document.getElementById(BUTTON_ID)) return;
        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.title = `${APP} (Alt+Shift+O)`;
        button.textContent = '▦';
        Object.assign(button.style, {
            position: 'fixed', right: '18px', bottom: '18px', zIndex: '2147483000', width: '44px', height: '44px',
            borderRadius: '14px', border: '1px solid rgba(127,127,127,.28)', background: 'rgba(30,30,30,.92)', color: '#fff',
            fontSize: '22px', cursor: 'pointer', boxShadow: '0 8px 28px rgba(0,0,0,.25)', backdropFilter: 'blur(12px)'
        });
        button.addEventListener('click', openProjecture);
        document.body.appendChild(button);
        state.launcher = button;
    }

    function ensureRoot() {
        if (state.rootHost?.isConnected) return;
        const host = document.createElement('div');
        host.id = ROOT_ID;
        host.style.position = 'fixed';
        host.style.inset = '0';
        host.style.zIndex = '2147483646';
        host.style.display = 'none';
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<style>${styles()}</style><div id="app"></div>`;
        document.body.appendChild(host);
        state.rootHost = host;
        state.shadow = shadow;
        wireGlobalShadowEvents();
    }

    function openProjecture() {
        ensureRoot();
        state.open = true;
        state.rootHost.style.display = 'block';
        document.documentElement.style.overflow = 'hidden';
        render();
        if (!state.chats.length && !state.loading) loadAllData();
    }

    function closeProjecture() {
        state.open = false;
        if (state.rootHost) state.rootHost.style.display = 'none';
        document.documentElement.style.overflow = '';
    }

    function captureBoardScroll(app) {
        const board = app.querySelector('.board');
        const columns = new Map();
        app.querySelectorAll('.drop-zone[data-drop-project]').forEach(zone => {
            columns.set(zone.dataset.dropProject, { left: zone.scrollLeft, top: zone.scrollTop });
        });
        return {
            board: board ? { left: board.scrollLeft, top: board.scrollTop } : null,
            columns,
        };
    }

    function restoreBoardScroll(app, scrollState) {
        if (!scrollState) return;
        const board = app.querySelector('.board');
        if (board && scrollState.board) {
            board.scrollLeft = scrollState.board.left;
            board.scrollTop = scrollState.board.top;
        }
        app.querySelectorAll('.drop-zone[data-drop-project]').forEach(zone => {
            const saved = scrollState.columns.get(zone.dataset.dropProject);
            if (!saved) return;
            zone.scrollLeft = saved.left;
            zone.scrollTop = saved.top;
        });
    }

    function driveButtonLabel() {
        if (!state.driveConfig?.enabled) return 'Drive: Setup';
        return {
            Ready: 'Drive: Sync',
            Syncing: 'Drive: Syncing…',
            Synced: 'Drive: ✓',
            Error: 'Drive: Error',
        }[state.cloudStatus] || 'Drive: Sync';
    }

    function driveButtonTitle() {
        const lines = [state.driveConfig?.enabled
            ? 'Click to sync now. Shift-click to reconfigure or disconnect.'
            : 'Configure Google Drive synchronization.'];
        if (state.cloudLastSyncAt) lines.push(`Last synced: ${new Date(state.cloudLastSyncAt).toLocaleString()}`);
        if (state.cloudLastError) lines.push(`Last error: ${state.cloudLastError.message || state.cloudLastError}`);
        return lines.join('\n');
    }

    function renderSavedMultiChatsHtml() {
        const views = Object.values(state.multiChats.views || {})
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        const rows = views.length ? views.map(view => {
            const titles = view.chatIds.map(id => chatById(id)?.title || `[Missing chat: ${id}]`);
            return `<button class="saved-multichat-row" data-action="open-saved-multichat" data-view-id="${escapeHtml(view.id)}">
                <span class="saved-multichat-name">${escapeHtml(view.name)}</span>
                <span class="saved-multichat-meta">${view.chatIds.length} chats · ${escapeHtml(titles.join(' · '))}</span>
            </button>`;
        }).join('') : '<div class="muted saved-multichat-empty">No saved multi-chats yet. Select 2–4 chats and choose Compare.</div>';
        return `<div class="drawer-header"><div><strong>Saved multi-chats</strong><div class="muted">Named read-only workspaces with per-chat scroll positions.</div></div><button class="icon-btn small" data-action="close-drawers">×</button></div><div class="saved-multichat-list">${rows}</div>`;
    }

    function highlightText(text, query) {
        const source = String(text || '');
        const needle = String(query || '').trim();
        if (!needle) return escapeHtml(source);
        const lower = source.toLowerCase();
        const wanted = needle.toLowerCase();
        let cursor = 0;
        let output = '';
        while (cursor < source.length) {
            const index = lower.indexOf(wanted, cursor);
            if (index < 0) {
                output += escapeHtml(source.slice(cursor));
                break;
            }
            output += escapeHtml(source.slice(cursor, index));
            output += `<mark>${escapeHtml(source.slice(index, index + wanted.length))}</mark>`;
            cursor = index + wanted.length;
        }
        return output;
    }

    function renderCompareMessage(chatId, message, query) {
        const hidden = !!state.compare.hiddenMessages[chatId]?.[message.id];
        const roleLabel = message.role === 'assistant' ? 'ChatGPT' : message.role === 'user' ? 'You' : message.role;
        const matches = !query || `${message.text}\n${message.unsupported.join(' ')}`.toLowerCase().includes(query.toLowerCase());
        if (!matches) return '';
        const unsupported = message.unsupported.length
            ? `<div class="unsupported-content">Unsupported/linked content: ${escapeHtml(message.unsupported.join(', '))}. <a href="${escapeHtml(chatUrl(chatById(chatId)))}" target="_blank">Open original</a></div>`
            : '';
        return `<article class="compare-message role-${escapeHtml(message.role)} ${hidden ? 'message-hidden' : ''}" data-message-id="${escapeHtml(message.id)}">
            <header><strong>${escapeHtml(roleLabel)}</strong><span class="message-type">${escapeHtml(message.contentType)}</span><span class="spacer"></span>
                <button class="text-btn" data-action="toggle-compare-message" data-chat-id="${escapeHtml(chatId)}" data-message-id="${escapeHtml(message.id)}">${hidden ? 'Show' : 'Hide'}</button>
                <button class="text-btn" data-action="copy-compare-message" data-chat-id="${escapeHtml(chatId)}" data-message-id="${escapeHtml(message.id)}">Copy</button>
            </header>
            ${hidden ? '' : `<div class="message-text">${highlightText(message.text, query)}</div>${unsupported}`}
        </article>`;
    }

    function renderComparePane(chatId, index) {
        const chat = chatById(chatId);
        if (!chat) return `<section class="compare-pane missing-pane" data-chat-id="${escapeHtml(chatId)}"><div class="missing-chat">This saved chat is no longer available: ${escapeHtml(chatId)}</div></section>`;
        const project = chat.projectId ? projectById(chat.projectId) : null;
        const conversation = state.compare.conversations.get(chatId);
        const error = state.compare.errors.get(chatId);
        const query = state.compare.searches[chatId] || '';
        let body = '<div class="compare-loading"><span class="spinner"></span>Loading conversation…</div>';
        if (error) body = `<div class="compare-error">${escapeHtml(error)}<br><a href="${escapeHtml(chatUrl(chat))}" target="_blank">Open live chat</a></div>`;
        if (conversation) {
            const messages = conversation.messages.map(message => renderCompareMessage(chatId, message, query)).join('');
            body = messages || '<div class="compare-empty">No messages match this pane search.</div>';
        }
        return `<section class="compare-pane" data-chat-id="${escapeHtml(chatId)}">
            <header class="compare-pane-header">
                <div class="compare-title-wrap"><strong title="${escapeHtml(chat.title)}">${escapeHtml(chat.title)}</strong><span>${escapeHtml(project?.name || (chat.customGptName ? `Custom GPT: ${chat.customGptName}` : 'Unassigned'))}</span></div>
                <div class="compare-pane-actions">
                    <button class="text-btn" data-action="move-compare-left" data-chat-id="${escapeHtml(chatId)}" ${index === 0 ? 'disabled' : ''} title="Move pane left">←</button>
                    <button class="text-btn" data-action="move-compare-right" data-chat-id="${escapeHtml(chatId)}" ${index === state.compare.chatIds.length - 1 ? 'disabled' : ''} title="Move pane right">→</button>
                    <button class="text-btn" data-action="remove-compare-pane" data-chat-id="${escapeHtml(chatId)}" title="Remove pane">×</button>
                    <a class="btn ghost compare-open-live" href="${escapeHtml(chatUrl(chat))}" target="_blank">Open live ↗</a>
                </div>
            </header>
            <div class="compare-pane-tools"><div class="search-wrap compare-search"><span>⌕</span><input data-compare-search="${escapeHtml(chatId)}" type="search" placeholder="Search this chat…" value="${escapeHtml(query)}"></div><button class="btn ghost" data-action="copy-conversation" data-chat-id="${escapeHtml(chatId)}">Copy all</button></div>
            <div class="compare-body compare-messages" data-chat-id="${escapeHtml(chatId)}">${body}</div>
        </section>`;
    }

    function renderCompare(app) {
        captureCompareScrollPositions();
        const saved = state.compare.savedViewId ? state.multiChats.views[state.compare.savedViewId] : null;
        const dirty = compareIsDirty();
        app.innerHTML = `<div class="overlay-shell compare-shell">
            <header class="topbar">
                <div class="topbar-left"><button class="btn ghost" data-action="close-compare">← Organizer</button><div class="brand"><div class="brand-icon">▦</div><div><div class="brand-title">${escapeHtml(saved?.name || 'Multi-chat Compare')}</div><div class="brand-sub">${state.compare.chatIds.length} read-only conversations${saved ? ` · <span id="compareDirtyLabel">${dirty ? 'Unsaved changes' : 'Saved'}</span>` : ''}</div></div></div></div>
                <div class="top-actions compare-top-actions">
                    <label class="sync-scroll"><input id="syncCompareScroll" type="checkbox" ${state.compare.syncScroll ? 'checked' : ''}> Sync scroll</label>
                    <button class="btn ghost" data-action="toggle-saved-multichats">Saved multi-chats (${Object.keys(state.multiChats.views).length})</button>
                    ${saved ? `<button class="btn primary" data-action="save-multichat" ${dirty ? '' : 'disabled'}>Save</button><button class="btn ghost" data-action="save-as-multichat" ${dirty ? '' : 'disabled'}>Save as…</button><button class="btn danger-subtle" data-action="delete-multichat">Delete</button>` : '<button class="btn primary" data-action="save-new-multichat">Save new multi-chat view</button>'}
                    <button class="icon-btn" data-action="close" title="Close Projecture">×</button>
                </div>
            </header>
            <div id="statusArea" class="status-area">${renderStatusHtml()}</div>
            <div class="drawer-stack"><div id="savedMultiChatsPanel" class="drawer ${state.savedMultiChatsOpen ? '' : 'hidden'}">${renderSavedMultiChatsHtml()}</div></div>
            <main class="compare-grid" style="--compare-count:${state.compare.chatIds.length}">${state.compare.chatIds.map(renderComparePane).join('')}</main>
            <footer class="footer"><span>Read-only Compare View · each pane scrolls independently</span><span>v${VERSION} · Nathan Burgdorff + Ari (ChatGPT)</span></footer>
        </div>`;
        wireRenderedEvents();
        restoreCompareScrollPositions();
    }

    function render() {
        if (!state.shadow || !state.open) return;
        const app = state.shadow.getElementById('app');
        if (!app) return;

        if (state.mode === 'compare') {
            renderCompare(app);
            return;
        }

        const scrollState = captureBoardScroll(app);

        const filtered = getFilteredChats();
        const groups = groupChats(filtered);
        state.visibleChatIds = filtered.map(c => c.id);
        const selectedVisible = state.visibleChatIds.filter(id => state.selected.has(id)).length;
        const selectedCustomGptCount = [...state.selected].filter(id => chatById(id)?.customGpt).length;
        const unassignedCount = state.chats.filter(c => !c.projectId).length;
        const suggestedCount = [...state.suggestions.keys()].filter(id => !chatById(id)?.projectId).length;

        const projectOptions = state.projects
            .map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');

        app.innerHTML = `
            <div class="overlay-shell ${state.settings.compact ? 'compact' : ''}">
                <header class="topbar">
                    <div class="topbar-left">
                        <div class="brand">
                            <div class="brand-icon">▦</div>
                            <div><div class="brand-title">${escapeHtml(APP)}</div><div class="brand-sub">${state.chats.length.toLocaleString()} chats · ${state.projects.length.toLocaleString()} Projects · ${unassignedCount.toLocaleString()} unassigned</div></div>
                        </div>
                        <div class="brand-actions">
                            <button class="btn ghost" data-action="toggle-favicons">🎨 Favicons</button>
                            <button class="btn ghost" data-action="toggle-insights">✦ Insights</button>
                            <button class="btn ghost" data-action="toggle-saved-multichats">▦ Saved multi-chats (${Object.keys(state.multiChats.views).length})</button>
                        </div>
                    </div>
                    <div class="top-actions">
                        <button class="btn ghost" data-action="refresh" ${state.loading ? 'disabled' : ''}>↻ Refresh</button>
                        <button class="btn ghost drive-button" data-action="drive-sync" title="${escapeHtml(driveButtonTitle())}" ${state.cloudStatus === 'Syncing' ? 'disabled' : ''}>${escapeHtml(driveButtonLabel())}</button>
                        <button class="btn ghost" data-action="undo" ${state.undoStack.length ? '' : 'disabled'}>↶ Undo${state.undoStack.length ? ` (${state.undoStack.length})` : ''}</button>
                        <button class="icon-btn header-gear" data-action="toggle-settings" title="Settings">⚙</button>
                        <button class="icon-btn" data-action="close" title="Close (Esc)">×</button>
                    </div>
                </header>

                <section class="toolbar">
                    <select id="viewSelect" class="control" title="View">
                        <option value="all" ${state.settings.view === 'all' ? 'selected' : ''}>All chats</option>
                        <option value="unassigned" ${state.settings.view === 'unassigned' ? 'selected' : ''}>Unassigned only (${unassignedCount})</option>
                        <option value="suggested" ${state.settings.view === 'suggested' ? 'selected' : ''}>Suggested moves (${suggestedCount})</option>
                        ${state.settings.includeArchived ? `<option value="archived" ${state.settings.view === 'archived' ? 'selected' : ''}>Archived</option>` : ''}
                    </select>
                    <select id="projectFilter" class="control" title="Filter by Project">
                        <option value="all">All Projects</option>
                        <option value="unassigned" ${state.projectFilter === 'unassigned' ? 'selected' : ''}>Unassigned</option>
                        ${state.projects.map(p => `<option value="${escapeHtml(p.id)}" ${state.projectFilter === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                    </select>
                    <select id="sortSelect" class="control" title="Sort chats">
                        <option value="updated-desc" ${state.settings.sort === 'updated-desc' ? 'selected' : ''}>Updated ↓</option>
                        <option value="updated-asc" ${state.settings.sort === 'updated-asc' ? 'selected' : ''}>Updated ↑</option>
                        <option value="created-desc" ${state.settings.sort === 'created-desc' ? 'selected' : ''}>Created ↓</option>
                        <option value="created-asc" ${state.settings.sort === 'created-asc' ? 'selected' : ''}>Created ↑</option>
                        <option value="title-asc" ${state.settings.sort === 'title-asc' ? 'selected' : ''}>Title A→Z</option>
                        <option value="title-desc" ${state.settings.sort === 'title-desc' ? 'selected' : ''}>Title Z→A</option>
                    </select>
                    <div class="search-wrap"><span>⌕</span><input id="search" type="search" placeholder="Search chats, snippets, or Project names…" value="${escapeHtml(state.search)}"></div>
                    ${state.selected.size ? `
                        <div class="selection-controls">
                            <div class="selection-count"><strong>${state.selected.size.toLocaleString()}</strong> selected${selectedVisible !== state.selected.size ? ` · ${selectedVisible} visible` : ''}</div>
                            <button class="text-btn" data-action="select-visible">Select visible</button>
                            <button class="text-btn" data-action="invert-visible">Invert visible</button>
                            <button class="text-btn" data-action="clear-selection">Clear</button>
                            ${selectedCustomGptCount ? `<div class="selection-warning" title="ChatGPT does not support Custom GPT chats inside Projects. Moving these chats to a Project converts them to standard ChatGPT chats.">⚠ ${selectedCustomGptCount} Custom GPT</div>` : ''}
                            <button class="btn ghost" data-action="compare-selected" ${state.selected.size >= MIN_COMPARE_CHATS && state.selected.size <= MAX_COMPARE_CHATS ? '' : 'disabled'} title="Compare ${MIN_COMPARE_CHATS}–${MAX_COMPARE_CHATS} selected chats">Compare</button>
                            <select id="bulkDestination" class="control small"><option value="">Move selected to…</option><option value="__unassigned__">Unassigned</option>${projectOptions}</select>
                            <button class="btn primary" data-action="bulk-move">Move ${state.selected.size}</button>
                        </div>` : ''}
                </section>

                <div id="statusArea" class="status-area">${renderStatusHtml()}</div>
                <div class="drawer-stack">
                    <div id="insightsPanel" class="drawer hidden">${renderInsightsHtml()}</div>
                    <div id="faviconsPanel" class="drawer hidden">${renderFaviconsHtml()}</div>
                    <div id="settingsPanel" class="drawer hidden">${renderSettingsHtml()}</div>
                    <div id="savedMultiChatsPanel" class="drawer ${state.savedMultiChatsOpen ? '' : 'hidden'}">${renderSavedMultiChatsHtml()}</div>
                </div>

                <main class="board" style="--column-width:${Number(state.settings.columnWidth) || 330}px">
                    ${renderColumn(null, 'Unassigned', groups.get('__unassigned__') || [], '#8b8b8b', unassignedCount, true)}
                    ${state.projects.filter(p => !state.settings.hiddenProjects[p.id]).map(project =>
                        renderColumn(project.id, project.name, groups.get(project.id) || [], projectColor(project), state.chats.filter(c => c.projectId === project.id).length, false)
                    ).join('')}
                </main>

                <footer class="footer">
                    <span>Drag cards between columns · Shift-click for ranges · Alt+Shift+O opens Projecture</span>
                    <span>v${VERSION} · Nathan Burgdorff + Ari (ChatGPT)</span>
                </footer>
            </div>`;

        wireRenderedEvents();
        restoreBoardScroll(app, scrollState);
    }

    function renderStatusHtml() {
        const progress = state.progress ? `<div class="progress-pill"><span class="spinner"></span>${escapeHtml(state.progress)}</div>` : '';
        const status = state.status ? `<div class="toast ${escapeHtml(state.statusKind)}">${escapeHtml(state.status)}</div>` : '';
        return progress + status;
    }

    function renderStatusOnly() {
        if (!state.shadow) return;
        const el = state.shadow.getElementById('statusArea');
        if (el) el.innerHTML = renderStatusHtml();
    }

    function renderProgressOnly() {
        renderStatusOnly();
    }

    function renderColumn(projectId, name, chats, color, totalCount, unassigned) {
        const key = projectId || '__unassigned__';
        const collapsed = !!state.settings.collapsed[key];
        const hiddenBySearch = state.search && chats.length === 0;
        if (hiddenBySearch && !unassigned) return '';
        const suggestionCount = unassigned ? chats.filter(c => state.suggestions.has(c.id)).length : 0;
        const project = projectId ? projectById(projectId) : null;
        const titleAttrs = project ? `title="${escapeHtml(project.description || project.name)}"` : '';
        return `
            <section class="column ${collapsed ? 'collapsed' : ''}" data-project-id="${escapeHtml(key)}" style="--project-color:${escapeHtml(color)}">
                <div class="column-accent"></div>
                <header class="column-header" ${titleAttrs}>
                    <button class="collapse-btn" data-action="collapse" data-project-id="${escapeHtml(key)}">${collapsed ? '›' : '⌄'}</button>
                    <div class="project-mark">${unassigned ? '∅' : escapeHtml(name.trim().charAt(0).toUpperCase() || 'P')}</div>
                    <div class="column-title-wrap">
                        <div class="column-title">${escapeHtml(name)}</div>
                        <div class="column-meta">${totalCount.toLocaleString()} total${chats.length !== totalCount ? ` · ${chats.length.toLocaleString()} shown` : ''}${suggestionCount ? ` · ${suggestionCount} suggested` : ''}</div>
                    </div>
                    ${project ? `<a class="project-open" href="${escapeHtml(projectUrl(project.id))}" target="_blank" title="Open Project">↗</a>` : ''}
                    ${project ? `<button class="dots-btn" data-action="project-menu" data-project-id="${escapeHtml(project.id)}" title="Project display options">•••</button>` : ''}
                </header>
                <div class="drop-zone" data-drop-project="${escapeHtml(key)}">
                    ${collapsed ? '' : (chats.length ? chats.map(renderCard).join('') : `<div class="empty-column">Drop chats here</div>`)}
                </div>
            </section>`;
    }

    function renderCard(chat) {
        const selected = state.selected.has(chat.id);
        const suggestion = state.settings.suggestions && !chat.projectId ? state.suggestions.get(chat.id) : null;
        const target = suggestion ? projectById(suggestion.projectId) : null;
        const date = state.settings.showDates ? formatDate(chat.updateTime) : '';
        const tooltip = [
            chat.title,
            chat.customGpt ? `Custom GPT chat${chat.customGptName ? `: ${chat.customGptName}` : ''}` : '',
            chat.createTime ? `Created: ${formatDateTime(chat.createTime)}` : '',
            chat.updateTime ? `Updated: ${formatDateTime(chat.updateTime)}` : '',
            chat.archived ? 'Archived' : '',
        ].filter(Boolean).join('\n');

        return `
            <article class="chat-card ${selected ? 'selected' : ''}" draggable="true" data-chat-id="${escapeHtml(chat.id)}" title="${escapeHtml(tooltip)}">
                <button class="check ${selected ? 'checked' : ''}" data-action="select-chat" data-chat-id="${escapeHtml(chat.id)}" aria-label="Select chat">${selected ? '✓' : ''}</button>
                <div class="card-main">
                    <a class="chat-title" href="${escapeHtml(chatUrl(chat))}" target="_blank">${escapeHtml(chat.title)}</a>
                    ${state.settings.showSnippets && chat.snippet ? `<div class="snippet">${escapeHtml(chat.snippet)}</div>` : ''}
                    <div class="card-meta">
                        ${date ? `<span>${escapeHtml(date)}</span>` : ''}
                        ${chat.customGpt ? '<span class="tag custom-gpt-tag" title="Moving this chat into a Project converts it to a standard ChatGPT chat">Custom GPT</span>' : ''}
                        ${chat.archived ? '<span class="tag">archived</span>' : ''}
                        ${chat.starred ? '<span title="Starred">★</span>' : ''}
                    </div>
                    ${suggestion && target ? `
                        <button class="suggestion" data-action="accept-suggestion" data-chat-id="${escapeHtml(chat.id)}" data-project-id="${escapeHtml(target.id)}" title="Local title/keyword similarity; no chat contents are sent anywhere">
                            ✦ ${escapeHtml(target.name)} <strong>${Math.round(suggestion.confidence * 100)}%</strong>
                        </button>` : ''}
                </div>
                <button class="card-menu" data-action="card-menu" data-chat-id="${escapeHtml(chat.id)}" title="Quick move">•••</button>
            </article>`;
    }

    function renderInsightsHtml() {
        const unassigned = state.chats.filter(c => !c.projectId).length;
        const suggestions = [...state.suggestions.entries()].filter(([id]) => !chatById(id)?.projectId);
        const strong = suggestions.filter(([, s]) => s.confidence >= 0.65).length;
        const overlapRows = state.overlaps.length ? state.overlaps.map(o => {
            const a = projectById(o.a); const b = projectById(o.b);
            return `<div class="insight-row"><span class="overlap-dot" style="background:${escapeHtml(projectColor(a))}"></span><strong>${escapeHtml(a?.name || o.a)}</strong><span class="arrow">↔</span><span class="overlap-dot" style="background:${escapeHtml(projectColor(b))}"></span><strong>${escapeHtml(b?.name || o.b)}</strong><span class="score">${Math.round(o.score * 100)}%</span></div>`;
        }).join('') : '<div class="muted">No strong Project-overlap signals found.</div>';

        return `
            <div class="drawer-header"><div><strong>Organization Insights</strong><div class="muted">Computed locally from Project names and chat titles/snippets.</div></div><button class="icon-btn small" data-action="close-drawers">×</button></div>
            <div class="insight-grid">
                <div class="stat"><b>${unassigned.toLocaleString()}</b><span>Unassigned</span></div>
                <div class="stat"><b>${suggestions.length.toLocaleString()}</b><span>Suggestions</span></div>
                <div class="stat"><b>${strong.toLocaleString()}</b><span>≥65% confidence</span></div>
                <div class="stat"><b>${state.overlaps.length.toLocaleString()}</b><span>Overlap flags</span></div>
            </div>
            <div class="drawer-section">
                <div class="section-title">Potentially overlapping Projects</div>
                ${overlapRows}
            </div>
            <div class="drawer-section action-row">
                <button class="btn primary" data-action="show-suggestions">Review suggestions</button>
                <button class="btn ghost" data-action="copy-ai-prompt">Copy AI triage prompt</button>
                <button class="btn ghost" data-action="import-ai-plan">Import AI plan</button>
            </div>
            <div class="muted tiny">The built-in suggestions are intentionally conservative. “Copy AI triage prompt” lets ChatGPT perform the semantic classification; the returned JSON can then be batch-applied here.</div>`;
    }

    function faviconPreviewHtml(value) {
        const text = String(value || '');
        if (/^(?:https?:|data:)/i.test(text)) {
            return `<span class="favicon-preview"><img src="${escapeHtml(text)}" alt=""></span>`;
        }
        return `<span class="favicon-preview text">${escapeHtml(text || '—')}</span>`;
    }

    function faviconRowsForView() {
        const rows = [];
        const projectRules = state.faviconSettings.projects;
        const chatRules = state.faviconSettings.chats;

        if (state.faviconView === 'configured') {
            for (const [id, rule] of Object.entries(projectRules)) {
                const project = projectById(id);
                rows.push({ type: 'project', id, rule, name: project?.name || id, projectName: '', projectId: null });
            }
            for (const [id, rule] of Object.entries(chatRules)) {
                const chat = chatById(id);
                const project = chat?.projectId ? projectById(chat.projectId) : null;
                rows.push({ type: 'chat', id, rule, name: chat?.title || id, projectName: project?.name || (chat?.projectId ? chat.projectId : 'Unassigned'), projectId: chat?.projectId || null });
            }
        } else if (state.faviconView === 'projects') {
            for (const project of state.projects) {
                rows.push({ type: 'project', id: project.id, rule: projectRules[project.id] || null, name: project.name, projectName: '', projectId: null });
            }
        } else {
            for (const chat of state.chats) {
                const project = chat.projectId ? projectById(chat.projectId) : null;
                rows.push({ type: 'chat', id: chat.id, rule: chatRules[chat.id] || null, name: chat.title, projectName: project?.name || (chat.projectId ? chat.projectId : 'Unassigned'), projectId: chat.projectId || null });
            }
        }

        const q = state.faviconSearch.trim().toLowerCase();
        const filtered = q ? rows.filter(row => `${row.name}\n${row.projectName}\n${row.id}`.toLowerCase().includes(q)) : rows;
        return filtered.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    }

    function faviconValueLabel(value) {
        const text = String(value || '');
        return /^(?:https?:|data:)/i.test(text) ? 'custom image' : text;
    }

    function faviconRelationshipHtml(row) {
        if (row.type === 'project') return row.rule ? 'Project rule' : 'No custom icon';
        const projectRule = row.projectId ? enabledFaviconRule('project', row.projectId) : null;
        const inheritedLabel = projectRule ? escapeHtml(faviconValueLabel(projectRule.value)) : '';
        if (row.rule) {
            if (row.rule.enabled === false) {
                return projectRule ? `Disabled · inherits ${inheritedLabel}` : 'Disabled';
            }
            return projectRule ? `Overrides Project icon ${inheritedLabel}` : 'Chat-specific';
        }
        return projectRule ? `Inherits ${inheritedLabel}` : 'No custom icon';
    }

    function renderFaviconsHtml() {
        const rows = faviconRowsForView();
        const configuredCount = Object.keys(state.faviconSettings.projects).length + Object.keys(state.faviconSettings.chats).length;
        const rowsHtml = rows.length ? rows.map(row => {
            const effective = row.type === 'chat'
                ? (row.rule?.enabled !== false && row.rule ? row.rule : (row.projectId ? enabledFaviconRule('project', row.projectId) : null))
                : row.rule;
            return `
                <div class="favicon-row">
                    <div class="favicon-on">${row.rule ? `<input type="checkbox" data-favicon-toggle="1" data-favicon-type="${row.type}" data-favicon-id="${escapeHtml(row.id)}" ${row.rule.enabled !== false ? 'checked' : ''} title="Enable/disable this rule">` : ''}</div>
                    <div>${faviconPreviewHtml(effective?.value || '')}</div>
                    <div class="favicon-kind">${row.type === 'project' ? 'Project' : 'Chat'}</div>
                    <div class="favicon-name"><strong>${escapeHtml(row.name)}</strong><span class="tiny muted">${escapeHtml(row.id)}</span></div>
                    <div class="favicon-project">${row.type === 'chat' ? escapeHtml(row.projectName) : '—'}</div>
                    <div class="favicon-relation">${faviconRelationshipHtml(row)}</div>
                    <div class="favicon-actions">
                        <button class="text-btn" data-action="favicon-edit" data-favicon-type="${row.type}" data-favicon-id="${escapeHtml(row.id)}">${row.rule ? 'Edit' : 'Set'}</button>
                        ${row.rule ? `<button class="text-btn danger-text" data-action="favicon-clear" data-favicon-type="${row.type}" data-favicon-id="${escapeHtml(row.id)}">Clear</button>` : ''}
                    </div>
                </div>`;
        }).join('') : '<div class="muted favicon-empty">No matching favicon entries.</div>';

        return `
            <div class="drawer-header">
                <div><strong>Favicons</strong><div class="muted">Chat rules override Project rules. Disabled rules are kept but ignored.</div></div>
                <button class="icon-btn small" data-action="close-drawers">×</button>
            </div>
            <div class="favicon-toolbar">
                <label class="favicon-master"><input type="checkbox" id="faviconMaster" ${state.faviconSettings.enabled ? 'checked' : ''}> Custom favicons</label>
                <select id="faviconView" class="control small">
                    <option value="configured" ${state.faviconView === 'configured' ? 'selected' : ''}>Configured (${configuredCount})</option>
                    <option value="projects" ${state.faviconView === 'projects' ? 'selected' : ''}>All Projects (${state.projects.length})</option>
                    <option value="chats" ${state.faviconView === 'chats' ? 'selected' : ''}>All Chats (${state.chats.length})</option>
                </select>
                <input id="faviconSearch" class="control favicon-search" type="search" placeholder="Search favicon rules…" value="${escapeHtml(state.faviconSearch)}">
                <div class="spacer"></div>
                <button class="btn ghost" data-action="favicon-export">Export</button>
                <button class="btn ghost" data-action="favicon-import">Import</button>
            </div>
            <div class="favicon-table">
                <div class="favicon-row favicon-head"><div>On</div><div>Icon</div><div>Type</div><div>Name</div><div>Project</div><div>Behavior</div><div></div></div>
                ${rowsHtml}
            </div>
            <div class="muted tiny favicon-note">Projecture stores favicon configuration in this browser. The standalone favicon userscript can be disabled after recreating or importing its rules here.</div>`;
    }

    function renderFaviconsOnly() {
        if (!state.shadow) return;
        const panel = state.shadow.getElementById('faviconsPanel');
        if (!panel) return;
        const wasOpen = !panel.classList.contains('hidden');
        panel.innerHTML = renderFaviconsHtml();
        if (wasOpen) panel.classList.remove('hidden');
        wireFaviconEvents();
    }

    function renderSettingsHtml() {
        return `
            <div class="drawer-header"><div><strong>Projecture Settings</strong><div class="muted">Portable preferences can sync through your Google Drive bridge.</div></div><button class="icon-btn small" data-action="close-drawers">×</button></div>
            <div class="settings-grid">
                <label><input type="checkbox" id="settingCompact" ${state.settings.compact ? 'checked' : ''}> Compact cards</label>
                <label><input type="checkbox" id="settingSnippets" ${state.settings.showSnippets ? 'checked' : ''}> Show snippets</label>
                <label><input type="checkbox" id="settingDates" ${state.settings.showDates ? 'checked' : ''}> Show dates</label>
                <label><input type="checkbox" id="settingSuggestions" ${state.settings.suggestions ? 'checked' : ''}> Show local suggestions</label>
                <label><input type="checkbox" id="settingConfirm" ${state.settings.confirmBulkMove ? 'checked' : ''}> Confirm multi-chat moves</label>
                <label><input type="checkbox" id="settingArchived" ${state.settings.includeArchived ? 'checked' : ''}> Include archived chats on refresh</label>
            </div>
            <div class="range-row"><span>Column width</span><input type="range" id="columnWidth" min="260" max="480" step="10" value="${Number(state.settings.columnWidth) || 330}"><span>${Number(state.settings.columnWidth) || 330}px</span></div>
            <div class="drawer-section action-row">
                <button class="btn ghost" data-action="drive-sync">${escapeHtml(driveButtonLabel())}</button>
                <button class="btn ghost" data-action="export-json">Export JSON</button>
                <button class="btn ghost" data-action="export-csv">Export CSV</button>
                <button class="btn danger-subtle" data-action="reset-settings">Reset Projecture UI settings</button>
            </div>
            <div class="muted tiny">Changing “Include archived” takes effect after Refresh. Column width remains device-local. Drive credentials remain local and are never exported or synced. The ChatGPT access token is held only in memory.</div>`;
    }

    function styles() {
        return `
            :host { all: initial; color-scheme: light dark; --bg:#f5f5f3; --panel:#fff; --panel2:#f7f7f5; --text:#202123; --muted:#6b6b6b; --line:rgba(0,0,0,.11); --shadow:0 18px 55px rgba(0,0,0,.20); --accent:#10a37f; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
            @media (prefers-color-scheme: dark) { :host { --bg:#171717; --panel:#212121; --panel2:#2a2a2a; --text:#ececec; --muted:#aaa; --line:rgba(255,255,255,.12); --shadow:0 18px 60px rgba(0,0,0,.52); } }
            * { box-sizing:border-box; }
            button,input,select { font:inherit; }
            button { color:inherit; }
            a { color:inherit; }
            .overlay-shell { position:fixed; inset:0; display:grid; grid-template-rows:auto auto auto minmax(0,1fr) auto; background:var(--bg); color:var(--text); }
            .topbar { min-height:66px; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:10px 18px; border-bottom:1px solid var(--line); background:color-mix(in srgb,var(--panel) 94%, transparent); }
            .topbar-left { min-width:0; display:flex; align-items:center; gap:14px; }
            .brand { display:flex; align-items:center; gap:11px; min-width:0; }
            .brand-icon { width:38px; height:38px; border-radius:11px; display:grid; place-items:center; background:var(--text); color:var(--panel); font-size:21px; font-weight:700; }
            .brand-title { font-size:16px; font-weight:750; letter-spacing:-.015em; }
            .brand-sub { font-size:12px; color:var(--muted); margin-top:2px; }
            .brand-actions,.top-actions,.action-row { display:flex; align-items:center; gap:8px; flex-wrap:nowrap; }
            .toolbar { min-width:0; display:flex; flex-wrap:nowrap; gap:8px; align-items:center; padding:9px 14px; overflow-x:auto; overflow-y:hidden; background:var(--panel); border-bottom:1px solid var(--line); scrollbar-width:thin; }
            .search-wrap { min-width:120px; flex:1 1 620px; display:flex; align-items:center; gap:7px; background:var(--panel2); border:1px solid var(--line); border-radius:10px; padding:0 10px; }
            .search-wrap input { width:100%; min-width:0; border:0; outline:0; background:transparent; color:var(--text); height:36px; }
            .control { height:36px; border:1px solid var(--line); background:var(--panel2); color:var(--text); border-radius:9px; padding:0 9px; outline:none; max-width:210px; }
            .control.small { height:32px; max-width:250px; }
            .btn { height:36px; border-radius:9px; padding:0 12px; border:1px solid var(--line); cursor:pointer; font-weight:600; white-space:nowrap; }
            .btn:disabled,.icon-btn:disabled { opacity:.42; cursor:default; }
            .btn.ghost { background:var(--panel2); }
            .btn.primary { background:var(--text); color:var(--panel); border-color:transparent; }
            .btn.danger-subtle { background:rgba(210,40,40,.08); color:#d34c4c; border-color:rgba(210,40,40,.2); }
            .icon-btn { width:38px; height:38px; border:0; border-radius:10px; background:transparent; cursor:pointer; font-size:28px; line-height:1; }
            .icon-btn:hover { background:var(--panel2); }
            .icon-btn.small { width:30px;height:30px;font-size:21px; }
            .header-gear { font-size:19px; }
            .selection-controls { flex:0 0 auto; height:36px; display:flex; gap:7px; align-items:center; padding:2px 4px 2px 9px; border:1px solid color-mix(in srgb,var(--accent) 22%,var(--line)); border-radius:10px; background:color-mix(in srgb,var(--accent) 8%,var(--panel)); font-size:12px; white-space:nowrap; }
            .selection-count { color:var(--text); }
            .selection-warning { color:#b56a00; font-size:11px; font-weight:700; white-space:nowrap; }
            .text-btn { border:0; background:transparent; color:var(--muted); cursor:pointer; padding:5px 4px; }
            .text-btn:hover { color:var(--text); text-decoration:underline; }
            .status-area { position:fixed; z-index:10; left:50%; transform:translateX(-50%); top:72px; pointer-events:none; display:flex; flex-direction:column; align-items:center; gap:6px; max-width:min(720px,90vw); }
            .progress-pill,.toast { background:var(--text); color:var(--panel); border-radius:999px; padding:8px 13px; box-shadow:var(--shadow); font-size:12px; display:flex; align-items:center; gap:8px; }
            .toast.error { background:#a92f2f;color:#fff; }.toast.success { background:#137a5f;color:#fff; }.toast.info { background:#333;color:#fff; }
            .spinner { width:12px;height:12px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:spin .7s linear infinite; } @keyframes spin{to{transform:rotate(360deg)}}
            .drawer-stack { min-height:0; }
            .drawer { margin:0 14px; padding:14px; border:1px solid var(--line); border-top:0; background:var(--panel); box-shadow:0 10px 28px rgba(0,0,0,.08); max-height:36vh; overflow:auto; }
            .drawer.hidden { display:none; }
            .drawer-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:12px; }
            .muted { color:var(--muted); font-size:12px; }.tiny{font-size:11px;line-height:1.45;}
            .insight-grid { display:grid; grid-template-columns:repeat(4,minmax(110px,1fr)); gap:8px; margin-bottom:14px; }
            .stat { border:1px solid var(--line); border-radius:10px; padding:10px 12px; background:var(--panel2); }.stat b{font-size:22px;display:block}.stat span{font-size:11px;color:var(--muted)}
            .drawer-section { border-top:1px solid var(--line); padding-top:11px; margin-top:10px; }.section-title{font-size:12px;font-weight:700;margin-bottom:7px;}
            .insight-row { display:flex;align-items:center;gap:7px;padding:5px 0;font-size:12px; }.overlap-dot{width:9px;height:9px;border-radius:50%;}.arrow{color:var(--muted)}.score{margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums}
            .settings-grid { display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:8px 16px;font-size:13px; }.settings-grid label{display:flex;align-items:center;gap:7px}.settings-grid input{accent-color:var(--accent)}
            .range-row { display:flex;align-items:center;gap:10px;margin-top:12px;font-size:12px;color:var(--muted)}.range-row input{width:240px;accent-color:var(--accent)}
            .board { min-height:0; display:flex; align-items:stretch; gap:12px; padding:12px 14px 16px; overflow:auto; scroll-snap-type:x proximity; }
            .column { flex:0 0 var(--column-width); min-width:var(--column-width); max-width:var(--column-width); background:var(--panel2); border:1px solid var(--line); border-radius:14px; overflow:hidden; display:flex; flex-direction:column; scroll-snap-align:start; position:relative; transition:width .15s,min-width .15s,box-shadow .15s; }
            .column.drop-target { box-shadow:0 0 0 3px color-mix(in srgb,var(--project-color) 65%, transparent), var(--shadow); }
            .column.collapsed { flex-basis:74px;min-width:74px;max-width:74px; }.column.collapsed .column-header{height:100%;flex-direction:column;padding:12px 7px;justify-content:flex-start}.column.collapsed .column-title-wrap,.column.collapsed .project-open,.column.collapsed .dots-btn{display:none}.column.collapsed .project-mark{margin-top:5px}.column.collapsed .drop-zone{display:none}
            .column-accent { height:4px; background:var(--project-color); flex:0 0 4px; }
            .column-header { min-height:59px; display:flex; align-items:center; gap:8px; padding:9px 9px 8px; border-bottom:1px solid var(--line); background:var(--panel); }
            .collapse-btn,.dots-btn,.card-menu { border:0;background:transparent;color:var(--muted);cursor:pointer;border-radius:7px; }.collapse-btn{width:22px;height:28px;font-size:18px}.dots-btn{margin-left:2px}.collapse-btn:hover,.dots-btn:hover,.card-menu:hover{background:var(--panel2);color:var(--text)}
            .project-mark { width:29px;height:29px;display:grid;place-items:center;border-radius:9px;background:color-mix(in srgb,var(--project-color) 16%, transparent);color:var(--project-color);font-weight:800; }
            .column-title-wrap { min-width:0;flex:1; }.column-title{font-size:13px;font-weight:760;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.column-meta{font-size:10px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            .project-open { text-decoration:none;color:var(--muted);padding:5px;border-radius:6px}.project-open:hover{background:var(--panel2);color:var(--text)}
            .drop-zone { min-height:120px; overflow-y:auto; padding:8px; flex:1; }
            .empty-column { border:1px dashed var(--line);border-radius:10px;color:var(--muted);font-size:11px;text-align:center;padding:25px 7px;margin:2px; }
            .chat-card { display:flex;align-items:flex-start;gap:7px;border:1px solid var(--line);border-radius:11px;background:var(--panel);padding:9px 7px 9px 8px;margin-bottom:7px;box-shadow:0 1px 2px rgba(0,0,0,.03);cursor:grab;transition:transform .08s,box-shadow .08s,border-color .08s,opacity .08s; }
            .chat-card:hover { box-shadow:0 4px 14px rgba(0,0,0,.08);transform:translateY(-1px); }.chat-card.selected{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}.chat-card.dragging{opacity:.3}
            .check { flex:0 0 18px;width:18px;height:18px;border-radius:5px;border:1px solid var(--line);background:var(--panel2);color:#fff;display:grid;place-items:center;padding:0;cursor:pointer;font-size:12px;margin-top:1px; }.check.checked{background:var(--accent);border-color:var(--accent)}
            .card-main { min-width:0;flex:1; }.chat-title{font-size:12.5px;font-weight:650;text-decoration:none;line-height:1.3;display:block;overflow-wrap:anywhere}.chat-title:hover{text-decoration:underline}.snippet{font-size:10.5px;line-height:1.35;color:var(--muted);margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
            .card-meta { margin-top:5px;display:flex;align-items:center;gap:6px;min-height:13px;color:var(--muted);font-size:9.5px}.tag{border:1px solid var(--line);border-radius:999px;padding:1px 5px}
            .custom-gpt-tag { color:#8b5cf6; border-color:color-mix(in srgb,#8b5cf6 38%,var(--line)); background:color-mix(in srgb,#8b5cf6 8%,transparent); font-weight:700; }
            .suggestion { margin-top:6px;width:100%;border:0;border-radius:7px;background:color-mix(in srgb,var(--accent) 10%, transparent);color:color-mix(in srgb,var(--accent) 90%, var(--text));padding:5px 7px;text-align:left;font-size:9.5px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.suggestion strong{float:right}.suggestion:hover{background:color-mix(in srgb,var(--accent) 18%, transparent)}
            .card-menu { flex:0 0 24px;width:24px;height:24px;font-size:11px;padding:0; }
            .footer { min-height:31px;border-top:1px solid var(--line);background:var(--panel);color:var(--muted);font-size:10px;padding:7px 14px;display:flex;justify-content:space-between;gap:10px; }
            .compact .chat-card{padding:6px 6px;margin-bottom:5px}.compact .snippet{display:none}.compact .card-meta{margin-top:2px}.compact .suggestion{margin-top:4px;padding:3px 6px}.compact .drop-zone{padding:6px}
            .popover { position:fixed;z-index:50;min-width:220px;max-width:320px;background:var(--panel);border:1px solid var(--line);border-radius:11px;box-shadow:var(--shadow);padding:6px; }.popover button{width:100%;border:0;background:transparent;text-align:left;padding:8px 9px;border-radius:7px;cursor:pointer;font-size:12px}.popover button:hover{background:var(--panel2)}.popover .pop-title{font-size:10px;color:var(--muted);padding:5px 9px}.popover .sep{height:1px;background:var(--line);margin:5px 0}
            .favicon-toolbar { display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px; }.favicon-master{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:650}.favicon-master input{accent-color:var(--accent)}.favicon-search{min-width:220px;max-width:360px;flex:1}.favicon-table{border:1px solid var(--line);border-radius:10px;overflow:auto;max-height:25vh;background:var(--panel2)}.favicon-row{display:grid;grid-template-columns:42px 54px 70px minmax(210px,1.4fr) minmax(150px,1fr) minmax(180px,1fr) 112px;gap:8px;align-items:center;padding:7px 9px;border-bottom:1px solid var(--line);font-size:11px;min-width:930px}.favicon-row:last-child{border-bottom:0}.favicon-head{position:sticky;top:0;z-index:1;background:var(--panel);font-weight:700;color:var(--muted);font-size:10px}.favicon-preview{width:30px;height:30px;border-radius:7px;border:1px solid var(--line);background:var(--panel);display:grid;place-items:center;overflow:hidden;font-size:21px}.favicon-preview img{width:100%;height:100%;object-fit:contain}.favicon-kind{color:var(--muted)}.favicon-name{min-width:0;display:flex;flex-direction:column;gap:2px}.favicon-name strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.favicon-project,.favicon-relation{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.favicon-actions{display:flex;align-items:center;justify-content:flex-end;gap:5px}.danger-text{color:#d34c4c}.favicon-empty{padding:18px}.favicon-note{margin-top:8px}
            .saved-multichat-list{display:grid;gap:7px}.saved-multichat-row{display:flex;flex-direction:column;align-items:flex-start;gap:3px;width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel2);cursor:pointer;text-align:left}.saved-multichat-row:hover{border-color:color-mix(in srgb,var(--accent) 55%,var(--line))}.saved-multichat-name{font-weight:750}.saved-multichat-meta{width:100%;color:var(--muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.saved-multichat-empty{padding:14px}
            .compare-shell{grid-template-rows:auto auto minmax(0,1fr) auto}.compare-top-actions{min-width:0;overflow-x:auto}.sync-scroll{display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap}.sync-scroll input{accent-color:var(--accent)}
            .compare-grid{min-width:0;min-height:0;display:grid;grid-template-columns:repeat(var(--compare-count),minmax(320px,1fr));gap:10px;padding:10px 12px;overflow:auto}.compare-pane{min-width:320px;min-height:0;display:grid;grid-template-rows:auto auto minmax(0,1fr);border:1px solid var(--line);border-radius:13px;background:var(--panel);overflow:hidden}.compare-pane-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 11px;border-bottom:1px solid var(--line)}.compare-title-wrap{min-width:0;display:flex;flex-direction:column;gap:2px}.compare-title-wrap strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}.compare-title-wrap span{font-size:10px;color:var(--muted)}.compare-pane-actions{display:flex;align-items:center;gap:2px;flex:0 0 auto}.compare-pane-actions .text-btn:disabled{opacity:.35;cursor:default;text-decoration:none}.compare-open-live{display:flex;align-items:center;text-decoration:none;height:30px;padding:0 8px;font-size:10px}.compare-pane-tools{display:flex;align-items:center;gap:7px;padding:7px 9px;border-bottom:1px solid var(--line);background:var(--panel2)}.compare-search{min-width:0;flex:1}.compare-search input{height:30px}.compare-pane-tools .btn{height:32px;padding:0 8px;font-size:10px}.compare-messages{min-height:0;overflow:auto;padding:10px;scrollbar-gutter:stable}.compare-message{border:1px solid var(--line);border-radius:11px;padding:9px 10px;margin-bottom:9px;background:var(--panel2)}.compare-message.role-user{border-left:3px solid #6b8afd}.compare-message.role-assistant{border-left:3px solid var(--accent)}.compare-message header{display:flex;align-items:center;gap:7px;margin-bottom:7px;font-size:11px}.compare-message header .text-btn{font-size:10px;padding:2px 3px}.message-type{color:var(--muted);font-size:9px}.message-text{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:12px;line-height:1.5}.message-text mark{background:#ffe16b;color:#222;border-radius:2px}.message-hidden{opacity:.78}.message-hidden header{margin-bottom:0}.unsupported-content{margin-top:8px;padding:7px;border-radius:7px;background:color-mix(in srgb,#d99000 10%,transparent);color:var(--muted);font-size:10px}.compare-loading,.compare-error,.compare-empty,.missing-chat{display:flex;align-items:center;justify-content:center;gap:8px;min-height:140px;padding:18px;text-align:center;color:var(--muted);font-size:12px}.compare-error{color:#d34c4c}.spacer{flex:1}
            @media (max-width:900px){.settings-grid{grid-template-columns:1fr 1fr}.insight-grid{grid-template-columns:1fr 1fr}.brand-sub{display:none}.brand-actions .btn{padding:0 8px}.top-actions{gap:3px}}
        `;
    }

    function wireGlobalShadowEvents() {
        state.shadow.addEventListener('click', event => {
            const pop = state.shadow.querySelector('.popover');
            if (pop && !event.composedPath().includes(pop) && !event.target.closest('[data-action="card-menu"],[data-action="project-menu"]')) pop.remove();
        });
    }

    function wireFaviconEvents() {
        if (!state.shadow) return;
        const $ = selector => state.shadow.querySelector(selector);
        const $$ = selector => [...state.shadow.querySelectorAll(selector)];

        $('#faviconMaster')?.addEventListener('change', event => {
            state.faviconSettings.enabled = event.target.checked;
            saveFaviconSettings();
            syncFavicon();
            renderFaviconsOnly();
        });

        $('#faviconView')?.addEventListener('change', event => {
            state.faviconView = event.target.value;
            renderFaviconsOnly();
        });

        $('#faviconSearch')?.addEventListener('input', event => {
            state.faviconSearch = event.target.value;
            const pos = event.target.selectionStart;
            renderFaviconsOnly();
            const input = state.shadow.getElementById('faviconSearch');
            input?.focus();
            try { input?.setSelectionRange(pos, pos); } catch { /* ignore */ }
        });

        $$('[data-favicon-toggle="1"]').forEach(input => input.addEventListener('change', () => {
            toggleFaviconRule(input.dataset.faviconType, input.dataset.faviconId);
        }));

        $$('[data-action="favicon-edit"]').forEach(button => button.addEventListener('click', () => {
            setFaviconRule(button.dataset.faviconType, button.dataset.faviconId);
        }));

        $$('[data-action="favicon-clear"]').forEach(button => button.addEventListener('click', () => {
            clearFaviconRule(button.dataset.faviconType, button.dataset.faviconId);
        }));

        $('[data-action="favicon-export"]')?.addEventListener('click', exportFaviconConfig);
        $('[data-action="favicon-import"]')?.addEventListener('click', importFaviconConfig);
    }

    function wireRenderedEvents() {
        const $ = selector => state.shadow.querySelector(selector);
        const $$ = selector => [...state.shadow.querySelectorAll(selector)];

        $('[data-action="close"]')?.addEventListener('click', closeProjecture);
        $('[data-action="close-compare"]')?.addEventListener('click', closeCompareView);
        $('[data-action="refresh"]')?.addEventListener('click', loadAllData);
        $('[data-action="undo"]')?.addEventListener('click', undoLastMove);
        $('[data-action="select-visible"]')?.addEventListener('click', selectVisible);
        $('[data-action="invert-visible"]')?.addEventListener('click', invertVisibleSelection);
        $('[data-action="clear-selection"]')?.addEventListener('click', deselectAll);
        $('[data-action="export-json"]')?.addEventListener('click', exportSnapshot);
        $('[data-action="export-csv"]')?.addEventListener('click', exportCsv);
        $('[data-action="copy-ai-prompt"]')?.addEventListener('click', copyAiTriagePrompt);
        $('[data-action="import-ai-plan"]')?.addEventListener('click', importAiPlan);
        $('[data-action="compare-selected"]')?.addEventListener('click', () => openCompareView([...state.selected]));
        $('[data-action="save-new-multichat"]')?.addEventListener('click', () => saveCurrentMultiChat({ saveAs: true }));
        $('[data-action="save-multichat"]')?.addEventListener('click', () => saveCurrentMultiChat());
        $('[data-action="save-as-multichat"]')?.addEventListener('click', () => saveCurrentMultiChat({ saveAs: true }));
        $('[data-action="delete-multichat"]')?.addEventListener('click', deleteCurrentMultiChat);
        $$('[data-action="open-saved-multichat"]').forEach(button => button.addEventListener('click', () => {
            const view = state.multiChats.views[button.dataset.viewId];
            if (!view) return;
            state.savedMultiChatsOpen = false;
            openCompareView(view.chatIds, { savedViewId: view.id, scrollPositions: view.scrollPositions });
        }));
        $$('[data-action="move-compare-left"]').forEach(button => button.addEventListener('click', () => reorderCompareChat(button.dataset.chatId, -1)));
        $$('[data-action="move-compare-right"]').forEach(button => button.addEventListener('click', () => reorderCompareChat(button.dataset.chatId, 1)));
        $$('[data-action="remove-compare-pane"]').forEach(button => button.addEventListener('click', () => removeCompareChat(button.dataset.chatId)));
        $$('[data-action="copy-conversation"]').forEach(button => button.addEventListener('click', () => copyConversation(button.dataset.chatId)));
        $$('[data-action="copy-compare-message"]').forEach(button => button.addEventListener('click', async () => {
            const message = state.compare.conversations.get(button.dataset.chatId)?.messages.find(item => item.id === button.dataset.messageId);
            if (!message) return;
            await copyText(message.text || `[${message.unsupported.join(', ') || 'Unsupported content'}]`);
            setStatus('Copied message.', 'success');
        }));
        $$('[data-action="toggle-compare-message"]').forEach(button => button.addEventListener('click', () => {
            const chatId = button.dataset.chatId;
            state.compare.hiddenMessages[chatId] ||= {};
            state.compare.hiddenMessages[chatId][button.dataset.messageId] = !state.compare.hiddenMessages[chatId][button.dataset.messageId];
            render();
        }));
        $$('[data-compare-search]').forEach(input => input.addEventListener('input', event => {
            state.compare.searches[input.dataset.compareSearch] = event.target.value;
            const pos = event.target.selectionStart;
            render();
            const replacement = state.shadow.querySelector(`[data-compare-search="${CSS.escape(input.dataset.compareSearch)}"]`);
            replacement?.focus();
            try { replacement?.setSelectionRange(pos, pos); } catch { /* ignore */ }
        }));
        $('#syncCompareScroll')?.addEventListener('change', event => {
            state.compare.syncScroll = event.target.checked;
        });
        $$('.compare-messages[data-chat-id]').forEach(pane => pane.addEventListener('scroll', () => {
            const chatId = pane.dataset.chatId;
            state.compare.scrollPositions[chatId] = Math.max(0, Math.round(pane.scrollTop));
            if (state.compare.syncScroll && !state.compare.syncingScroll) {
                const denominator = Math.max(1, pane.scrollHeight - pane.clientHeight);
                const ratio = pane.scrollTop / denominator;
                state.compare.syncingScroll = true;
                $$('.compare-messages[data-chat-id]').forEach(other => {
                    if (other === pane) return;
                    other.scrollTop = ratio * Math.max(0, other.scrollHeight - other.clientHeight);
                    state.compare.scrollPositions[other.dataset.chatId] = Math.max(0, Math.round(other.scrollTop));
                });
                setTimeout(() => { state.compare.syncingScroll = false; }, 0);
            }
            clearTimeout(compareScrollTimer);
            compareScrollTimer = setTimeout(updateCompareSaveButtons, 180);
        }, { passive: true }));
        $('[data-action="show-suggestions"]')?.addEventListener('click', () => {
            state.settings.view = 'suggested'; saveSettings(); closeDrawers(); render();
        });
        $('[data-action="reset-settings"]')?.addEventListener('click', () => {
            if (!confirm('Reset the Projecture UI settings? This does not move or change any chats.')) return;
            state.settings = structuredClone(DEFAULT_SETTINGS); saveSettings(); render();
        });

        $('#search')?.addEventListener('input', event => {
            state.search = event.target.value;
            const pos = event.target.selectionStart;
            render();
            const input = state.shadow.getElementById('search');
            input?.focus();
            try { input?.setSelectionRange(pos, pos); } catch { /* ignore */ }
        });
        $('#viewSelect')?.addEventListener('change', e => { state.settings.view = e.target.value; saveSettings(); render(); });
        $('#projectFilter')?.addEventListener('change', e => { state.projectFilter = e.target.value; render(); });
        $('#sortSelect')?.addEventListener('change', e => { state.settings.sort = e.target.value; saveSettings(); render(); });

        $('[data-action="bulk-move"]')?.addEventListener('click', async () => {
            const select = state.shadow.getElementById('bulkDestination');
            if (!select?.value) { setStatus('Choose a destination Project first.', 'info'); return; }
            const destination = select.value === '__unassigned__' ? null : select.value;
            await moveChats([...state.selected], destination);
        });
        $('#bulkDestination')?.addEventListener('change', e => {
            if (e.target.value && state.selected.size && e.target.dataset.enterToMove === '1') {
                const destination = e.target.value === '__unassigned__' ? null : e.target.value;
                moveChats([...state.selected], destination);
            }
        });

        $$('[data-action="collapse"]').forEach(btn => btn.addEventListener('click', () => {
            const id = btn.dataset.projectId;
            state.settings.collapsed[id] = !state.settings.collapsed[id]; saveSettings(); render();
        }));

        $$('[data-action="select-chat"]').forEach(btn => btn.addEventListener('click', event => {
            event.preventDefault(); event.stopPropagation(); onCardSelectionClick(btn.dataset.chatId, event);
        }));
        $$('[data-action="accept-suggestion"]').forEach(btn => btn.addEventListener('click', event => {
            event.preventDefault(); event.stopPropagation(); moveChats([btn.dataset.chatId], btn.dataset.projectId);
        }));
        $$('[data-action="card-menu"]').forEach(btn => btn.addEventListener('click', event => {
            event.preventDefault(); event.stopPropagation(); showCardMenu(btn.dataset.chatId, btn);
        }));
        $$('[data-action="project-menu"]').forEach(btn => btn.addEventListener('click', event => {
            event.preventDefault(); event.stopPropagation(); showProjectMenu(btn.dataset.projectId, btn);
        }));

        $$('.chat-card').forEach(card => {
            card.addEventListener('dragstart', e => handleDragStart(card.dataset.chatId, e));
            card.addEventListener('dragend', handleDragEnd);
        });

        $$('.column').forEach(column => {
            const zone = column.querySelector('.drop-zone');
            if (!zone) return;
            zone.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; column.classList.add('drop-target'); });
            zone.addEventListener('dragleave', e => { if (!column.contains(e.relatedTarget)) column.classList.remove('drop-target'); });
            zone.addEventListener('drop', async e => {
                e.preventDefault(); column.classList.remove('drop-target');
                const ids = readDragIds(e);
                const raw = zone.dataset.dropProject;
                const destination = raw === '__unassigned__' ? null : raw;
                await moveChats(ids, destination);
            });
        });

        $('[data-action="toggle-insights"]')?.addEventListener('click', () => toggleDrawer('insightsPanel'));
        $('[data-action="toggle-favicons"]')?.addEventListener('click', () => toggleDrawer('faviconsPanel'));
        $('[data-action="toggle-settings"]')?.addEventListener('click', () => toggleDrawer('settingsPanel'));
        $('[data-action="toggle-saved-multichats"]')?.addEventListener('click', () => {
            const panel = state.shadow.getElementById('savedMultiChatsPanel');
            const open = panel?.classList.contains('hidden');
            closeDrawers();
            state.savedMultiChatsOpen = !!open;
            if (open) panel?.classList.remove('hidden');
        });
        $$('[data-action="drive-sync"]').forEach(button => button.addEventListener('click', event => {
            if (event.shiftKey || !state.driveConfig?.enabled) configureGoogleDriveSync();
            else syncWithGoogleDrive({ manual: true });
        }));
        wireFaviconEvents();
        $$('[data-action="close-drawers"]').forEach(btn => btn.addEventListener('click', closeDrawers));

        $('#settingCompact')?.addEventListener('change', e => updateSetting('compact', e.target.checked));
        $('#settingSnippets')?.addEventListener('change', e => updateSetting('showSnippets', e.target.checked));
        $('#settingDates')?.addEventListener('change', e => updateSetting('showDates', e.target.checked));
        $('#settingSuggestions')?.addEventListener('change', e => updateSetting('suggestions', e.target.checked));
        $('#settingConfirm')?.addEventListener('change', e => updateSetting('confirmBulkMove', e.target.checked));
        $('#settingArchived')?.addEventListener('change', e => {
            state.settings.includeArchived = e.target.checked;
            if (!state.settings.includeArchived && state.settings.view === 'archived') state.settings.view = 'all';
            saveSettings();
            setStatus('Archived-chat setting changed. Click Refresh to reload the library.', 'info', 7000);
        });
        $('#columnWidth')?.addEventListener('input', e => {
            state.settings.columnWidth = Number(e.target.value); saveSettings();
            const board = state.shadow.querySelector('.board'); if (board) board.style.setProperty('--column-width', `${state.settings.columnWidth}px`);
            const label = e.target.nextElementSibling; if (label) label.textContent = `${state.settings.columnWidth}px`;
        });
    }

    function updateSetting(key, value) {
        state.settings[key] = value; saveSettings(); render();
    }

    function toggleDrawer(id) {
        const target = state.shadow.getElementById(id);
        if (!target) return;
        const wasHidden = target.classList.contains('hidden');
        closeDrawers();
        if (wasHidden) target.classList.remove('hidden');
    }

    function closeDrawers() {
        state.shadow?.querySelectorAll('.drawer').forEach(el => el.classList.add('hidden'));
        state.savedMultiChatsOpen = false;
    }

    function showCardMenu(chatId, anchor) {
        removePopover();
        const chat = chatById(chatId);
        if (!chat) return;
        const rule = faviconRule('chat', chatId);
        const inherited = chat.projectId ? enabledFaviconRule('project', chat.projectId) : null;
        const pop = document.createElement('div');
        pop.className = 'popover';
        pop.innerHTML = `
            <div class="pop-title">Move “${escapeHtml(chat.title)}”</div>
            ${chat.projectId ? `<button data-dest="__unassigned__">∅ Unassigned</button><div class="sep"></div>` : ''}
            ${state.projects.map(p => `<button data-dest="${escapeHtml(p.id)}" ${chat.projectId === p.id ? 'disabled' : ''}><span style="color:${escapeHtml(projectColor(p))}">●</span> ${escapeHtml(p.name)}</button>`).join('')}
            <div class="sep"></div>
            <div class="pop-title">Favicon${inherited ? ` · inherits ${escapeHtml(inherited.value)}` : ''}</div>
            <button data-cact="favicon-edit">${rule ? `Edit custom favicon ${escapeHtml(rule.value)}` : 'Set custom favicon…'}</button>
            ${rule ? `<button data-cact="favicon-toggle">${rule.enabled === false ? 'Enable' : 'Disable'} custom favicon</button><button data-cact="favicon-clear">Clear custom favicon</button>` : ''}
        `;
        placePopover(pop, anchor);
        pop.querySelectorAll('button[data-dest]').forEach(btn => btn.addEventListener('click', async () => {
            const dest = btn.dataset.dest === '__unassigned__' ? null : btn.dataset.dest;
            pop.remove(); await moveChats([chatId], dest);
        }));
        pop.querySelector('[data-cact="favicon-edit"]')?.addEventListener('click', () => { pop.remove(); setFaviconRule('chat', chatId); });
        pop.querySelector('[data-cact="favicon-toggle"]')?.addEventListener('click', () => { pop.remove(); toggleFaviconRule('chat', chatId); });
        pop.querySelector('[data-cact="favicon-clear"]')?.addEventListener('click', () => { pop.remove(); clearFaviconRule('chat', chatId); });
    }

    function showProjectMenu(projectId, anchor) {
        removePopover();
        const project = projectById(projectId); if (!project) return;
        const rule = faviconRule('project', project.id);
        const pop = document.createElement('div'); pop.className = 'popover';
        pop.innerHTML = `
            <div class="pop-title">${escapeHtml(project.name)}</div>
            <button data-pact="select">Select all shown chats</button>
            <button data-pact="filter">Show only this Project</button>
            <div class="sep"></div>
            <button data-pact="hide">Hide column in Projecture</button>
            <button data-pact="color">Set Projecture color…</button>
            ${state.settings.customColors[project.id] ? '<button data-pact="reset-color">Use detected/default color</button>' : ''}
            <div class="sep"></div>
            <div class="pop-title">Favicon</div>
            <button data-pact="favicon-edit">${rule ? `Edit Project favicon ${escapeHtml(rule.value)}` : 'Set Project favicon…'}</button>
            ${rule ? `<button data-pact="favicon-toggle">${rule.enabled === false ? 'Enable' : 'Disable'} Project favicon</button><button data-pact="favicon-clear">Clear Project favicon</button>` : ''}
        `;
        placePopover(pop, anchor);
        pop.querySelector('[data-pact="select"]')?.addEventListener('click', () => {
            for (const id of state.visibleChatIds) if (chatById(id)?.projectId === project.id) state.selected.add(id);
            pop.remove(); render();
        });
        pop.querySelector('[data-pact="filter"]')?.addEventListener('click', () => { state.projectFilter = project.id; pop.remove(); render(); });
        pop.querySelector('[data-pact="hide"]')?.addEventListener('click', () => { state.settings.hiddenProjects[project.id] = true; saveSettings(); pop.remove(); render(); setStatus(`Hidden ${project.name} from this Projecture view. Reset Projecture UI settings to restore hidden columns.`, 'info', 7000); });
        pop.querySelector('[data-pact="color"]')?.addEventListener('click', () => {
            const color = prompt('Enter a CSS color for this Projecture column (examples: #10a37f, rebeccapurple, hsl(210 70% 50%)):', projectColor(project));
            if (color && validCssColor(color)) { state.settings.customColors[project.id] = color; saveSettings(); pop.remove(); render(); }
            else if (color) setStatus('That does not look like a valid CSS color.', 'error');
        });
        pop.querySelector('[data-pact="reset-color"]')?.addEventListener('click', () => { delete state.settings.customColors[project.id]; saveSettings(); pop.remove(); render(); });
        pop.querySelector('[data-pact="favicon-edit"]')?.addEventListener('click', () => { pop.remove(); setFaviconRule('project', project.id); });
        pop.querySelector('[data-pact="favicon-toggle"]')?.addEventListener('click', () => { pop.remove(); toggleFaviconRule('project', project.id); });
        pop.querySelector('[data-pact="favicon-clear"]')?.addEventListener('click', () => { pop.remove(); clearFaviconRule('project', project.id); });
    }

    function placePopover(pop, anchor) {
        state.shadow.getElementById('app').appendChild(pop);
        const r = anchor.getBoundingClientRect();
        const p = pop.getBoundingClientRect();
        let left = Math.min(innerWidth - p.width - 8, Math.max(8, r.right - p.width));
        let top = Math.min(innerHeight - p.height - 8, r.bottom + 5);
        if (top < r.bottom && r.top - p.height - 5 > 8) top = r.top - p.height - 5;
        pop.style.left = `${left}px`; pop.style.top = `${top}px`;
    }

    function removePopover() {
        state.shadow?.querySelector('.popover')?.remove();
    }

    document.addEventListener('keydown', event => {
        if (event.altKey && event.shiftKey && event.code === 'KeyO') {
            event.preventDefault(); state.open ? closeProjecture() : openProjecture(); return;
        }
        if (!state.open) return;
        if (event.key === 'Escape') { event.preventDefault(); closeProjecture(); return; }
        const tag = event.target?.tagName?.toLowerCase();
        const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable;
        if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault(); selectVisible();
        }
    }, true);

    const observer = new MutationObserver(() => {
        if (!document.getElementById(BUTTON_ID) && document.body) renderLauncher();
    });

    function init() {
        if (!document.body) return setTimeout(init, 250);
        renderLauncher();
        ensureRoot();
        observer.observe(document.documentElement, { childList: true, subtree: true });
        startFaviconEngine();
        if (state.driveConfig?.enabled) scheduleCloudSync(1800);
        log(`${APP} v${VERSION} loaded. Press Alt+Shift+O or click the floating ▦ button.`);
    }

    init();
})();
