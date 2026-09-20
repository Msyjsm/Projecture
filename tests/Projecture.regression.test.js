const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadProjectureInternals({
    sourcePath = path.join(__dirname, '..', 'Projecture.user.js'),
    hash = '',
    initialStorage = {},
    gmXmlhttpRequest,
} = {}) {
    const source = fs.readFileSync(sourcePath, 'utf8').replace(
        /\n\s*init\(\);\n\}\)\(\);\s*$/,
        `
    globalThis.__projectureTest = {
        APP,
        FAVICON_STORAGE_KEY,
        IS_PREVIEW_BUILD,
        MULTICHAT_STORAGE_KEY,
        PORTABLE_STORAGE_KEY,
        STORAGE_KEY,
        UserscriptBuildChannel,
        compareSignature,
        captureBoardScroll,
        captureCompareScrollPositions,
        mergePortableStates,
        moveChats,
        normalizeChat,
        normalizeConversationData,
        normalizePortableState,
        normalizeProjectId,
        normalizeSavedMultiChat,
        restoreBoardScroll,
        syncWithGoogleDrive,
        state,
    };
})();`
    );

    const confirmations = [];
    const storage = new Map(Object.entries(initialStorage));
    const sandbox = {
        AbortController,
        DOMException,
        Headers,
        Map,
        MutationObserver: class {
            observe() {}
        },
        Set,
        URL,
        URLSearchParams,
        addEventListener() {},
        clearInterval,
        clearTimeout,
        confirm(message) {
            confirmations.push(message);
            return false;
        },
        console,
        document: {
            addEventListener() {},
            body: null,
            documentElement: {},
            getElementById() { return null; },
            head: null,
        },
        fetch: async () => {
            throw new Error('Unexpected network request in regression test.');
        },
        location: {
            hash,
            href: 'https://chatgpt.com/',
            origin: 'https://chatgpt.com',
            pathname: '/',
            reload() {},
        },
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
        },
        GM_xmlhttpRequest: gmXmlhttpRequest,
        navigator: {},
        setInterval,
        setTimeout,
        structuredClone,
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.runInNewContext(source, sandbox, { filename: sourcePath });
    return { ...sandbox.__projectureTest, confirmations, storage };
}

test('production and generated preview builds have separate identities and storage', () => {
    const production = loadProjectureInternals();
    assert.equal(production.UserscriptBuildChannel, 'production');
    assert.equal(production.IS_PREVIEW_BUILD, false);
    assert.equal(production.APP, 'Projecture');
    assert.equal(production.STORAGE_KEY, 'projecture.settings.v1');
    assert.equal(production.FAVICON_STORAGE_KEY, 'projecture.favicons.v1');

    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'projecture-preview-test-'));
    try {
        const sourcePath = path.join(temporaryDirectory, 'Projecture.user.js');
        const outputPath = path.join(temporaryDirectory, 'Projecture.preview.user.js');
        fs.copyFileSync(path.join(__dirname, '..', 'Projecture.user.js'), sourcePath);
        execFileSync('python3', [
            path.join(__dirname, '..', 'tools', 'build_preview.py'),
            '--source', sourcePath,
            '--output', outputPath,
            '--preview-url', 'https://example.com/Projecture.preview.user.js',
            '--build-number', '42',
            '--preview-hash', '#proj-preview',
        ]);
        execFileSync(process.execPath, ['--check', outputPath]);

        const previewSource = fs.readFileSync(outputPath, 'utf8');
        assert.match(previewSource, /^\/\/ @name\s+Projecture \[PREVIEW\]$/m);
        assert.match(previewSource, /^\/\/ @namespace\s+https:\/\/nathanburgdorff\.com\/userscripts\/preview\/$/m);
        assert.match(previewSource, /^\/\/ @version\s+1\.2\.0\.42$/m);
        assert.match(previewSource, /const UserscriptBuildChannel = "preview"; \/\/ PREVIEW_CHANNEL_MARKER/);
        assert.match(previewSource, /const UserscriptPreviewHash = "#proj-preview";/);

        const preview = loadProjectureInternals({ sourcePath: outputPath, hash: '#proj-preview' });
        assert.equal(preview.UserscriptBuildChannel, 'preview');
        assert.equal(preview.IS_PREVIEW_BUILD, true);
        assert.equal(preview.APP, 'Projecture [PREVIEW]');
        assert.equal(preview.STORAGE_KEY, 'projecture.preview.settings.v1');
        assert.equal(preview.FAVICON_STORAGE_KEY, 'projecture.preview.favicons.v1');
        assert.equal(preview.MULTICHAT_STORAGE_KEY, 'projecture.preview.multichats.v1');
        assert.equal(preview.PORTABLE_STORAGE_KEY, 'projecture.preview.portable.v1');
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});

test('selection controls share the toolbar without adding a board-shifting row', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'Projecture.user.js'), 'utf8');
    const toolbarStart = source.indexOf('<section class="toolbar">');
    const toolbarEnd = source.indexOf('</section>', toolbarStart);
    const toolbar = source.slice(toolbarStart, toolbarEnd);
    const headerStart = source.indexOf('<header class="topbar">', source.indexOf('function render()'));
    const headerEnd = source.indexOf('</header>', headerStart);
    const header = source.slice(headerStart, headerEnd);

    assert.ok(toolbarStart >= 0 && toolbarEnd > toolbarStart);
    assert.ok(toolbar.indexOf('id="sortSelect"') < toolbar.indexOf('class="search-wrap"'));
    assert.ok(toolbar.indexOf('class="search-wrap"') < toolbar.indexOf('class="selection-controls"'));
    assert.doesNotMatch(source, /class="selectionbar/);
    assert.ok(header.indexOf('toggle-favicons') < header.indexOf('toggle-insights'));
    assert.ok(header.indexOf('data-action="undo"') < header.indexOf('toggle-settings'));
    assert.ok(header.indexOf('toggle-settings') < header.indexOf('data-action="close"'));
});

test('conversation normalization follows the active branch and marks unsupported content', () => {
    const { normalizeConversationData } = loadProjectureInternals();
    const chat = { id: 'chat-1', title: 'Fallback title' };
    const result = normalizeConversationData({
        title: 'Loaded title',
        current_node: 'assistant-2',
        mapping: {
            root: { id: 'root', parent: null, message: null },
            user: {
                id: 'user', parent: 'root',
                message: { id: 'm1', author: { role: 'user' }, content: { content_type: 'text', parts: ['Question'] } },
            },
            abandoned: {
                id: 'abandoned', parent: 'user',
                message: { id: 'm-old', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Old branch'] } },
            },
            'assistant-2': {
                id: 'assistant-2', parent: 'user',
                message: {
                    id: 'm2', author: { role: 'assistant' },
                    content: { content_type: 'multimodal_text', parts: ['Answer', { content_type: 'image_asset_pointer' }] },
                },
            },
        },
    }, chat);

    assert.equal(result.title, 'Loaded title');
    assert.equal(JSON.stringify(result.messages.map(message => message.text)), JSON.stringify(['Question', 'Answer']));
    assert.equal(JSON.stringify(result.messages[1].unsupported), JSON.stringify(['Image attachment']));
});

test('saved multi-chats preserve order and sanitized per-chat scroll positions', () => {
    const { normalizeSavedMultiChat, compareSignature } = loadProjectureInternals();
    const saved = normalizeSavedMultiChat({
        id: 'view-1',
        name: '  Review set  ',
        chatIds: ['b', 'a', 'b'],
        scrollPositions: { a: 18.7, b: -20 },
    });
    assert.equal(JSON.stringify(saved.chatIds), JSON.stringify(['b', 'a']));
    assert.equal(JSON.stringify(saved.scrollPositions), JSON.stringify({ b: 0, a: 19 }));
    assert.equal(saved.name, 'Review set');
    assert.equal(
        compareSignature({ chatIds: saved.chatIds, scrollPositions: saved.scrollPositions }),
        JSON.stringify({ chatIds: ['b', 'a'], scrollPositions: { b: 0, a: 19 } })
    );
});

test('saved scroll targets are not erased while conversation panes are still loading', () => {
    const { captureCompareScrollPositions, state } = loadProjectureInternals();
    state.mode = 'compare';
    state.compare.scrollPositions = { a: 725 };
    state.shadow = {
        querySelectorAll() {
            return [{
                dataset: { chatId: 'a' },
                scrollTop: 0,
                querySelector(selector) { return selector === '.compare-loading' ? {} : null; },
            }];
        },
    };
    captureCompareScrollPositions();
    assert.equal(state.compare.scrollPositions.a, 725);
});

test('portable merge combines unrelated changes and honors deletion tombstones', () => {
    const { mergePortableStates, normalizePortableState } = loadProjectureInternals();
    const base = {
        format: 'ProjecturePortableState', version: 1,
        settings: { scalars: {}, maps: { collapsed: {}, hiddenProjects: {}, customColors: {} } },
        favicons: { enabled: { value: true, updatedAt: 1, deleted: false }, projects: {}, chats: {} },
        multiChats: {},
    };
    const local = structuredClone(base);
    local.settings.scalars.compact = { value: true, updatedAt: 20, deleted: false };
    local.favicons.chats.chat1 = { value: null, updatedAt: 30, deleted: true };
    local.multiChats.removed = { value: null, updatedAt: 50, deleted: true };
    const remote = structuredClone(base);
    remote.settings.scalars.showDates = { value: false, updatedAt: 25, deleted: false };
    remote.favicons.chats.chat1 = { value: { value: '🍆', enabled: true }, updatedAt: 10, deleted: false };
    remote.multiChats.removed = {
        value: { id: 'removed', name: 'Stale', chatIds: ['a', 'b'], scrollPositions: { a: 0, b: 0 } },
        updatedAt: 40,
        deleted: false,
    };
    remote.multiChats.added = {
        value: { id: 'added', name: 'New', chatIds: ['c', 'd'], scrollPositions: { c: 2, d: 3 } },
        updatedAt: 45,
        deleted: false,
    };

    const merged = normalizePortableState(mergePortableStates(local, remote));
    assert.equal(merged.settings.scalars.compact.value, true);
    assert.equal(merged.settings.scalars.showDates.value, false);
    assert.equal(merged.favicons.chats.chat1.deleted, true);
    assert.equal(merged.favicons.chats.chat1.updatedAt, 30);
    assert.equal(merged.multiChats.removed.deleted, true);
    assert.equal(merged.multiChats.added.value.name, 'New');
});

test('fresh-device defaults cannot outrank an existing cloud backup and column width stays local', () => {
    const { storage } = loadProjectureInternals();
    const portable = JSON.parse(storage.get('projecture.portable.v1'));
    assert.equal(portable.settings.scalars.compact.updatedAt, 0);
    assert.equal(Object.hasOwn(portable.settings.scalars, 'columnWidth'), false);
});

test('Drive sync rereads and retries after a revision conflict', async () => {
    const future = Date.now() + 60_000;
    const remoteData = {
        format: 'ProjecturePortableState', version: 1,
        settings: {
            scalars: { compact: { value: true, updatedAt: future, deleted: false } },
            maps: { collapsed: {}, hiddenProjects: {}, customColors: {} },
        },
        favicons: { enabled: { value: true, updatedAt: future, deleted: false }, projects: {}, chats: {} },
        multiChats: {},
    };
    const calls = [];
    const responses = [
        { Status: 'ok', Revision: 1, Data: remoteData },
        { Status: 'conflict', Revision: 2 },
        { Status: 'ok', Revision: 2, Data: remoteData },
        { Status: 'ok', Revision: 3 },
    ];
    const gmXmlhttpRequest = options => {
        calls.push(JSON.parse(options.data));
        const response = responses.shift();
        queueMicrotask(() => options.onload({ status: 200, responseText: JSON.stringify(response) }));
    };
    const internals = loadProjectureInternals({ gmXmlhttpRequest });
    internals.state.driveConfig = {
        enabled: true,
        endpoint: 'https://script.google.com/macros/s/example/exec',
        secret: 'secret',
    };

    await internals.syncWithGoogleDrive();

    assert.equal(calls.length, 4);
    assert.equal(calls[0].Action, 'Read');
    assert.equal(calls[1].Action, 'Write');
    assert.equal(calls[2].Action, 'Read');
    assert.equal(calls[3].ExpectedRevision, 2);
    assert.equal(internals.state.settings.compact, true);
    assert.equal(internals.state.cloudStatus, 'Synced');
});

test('Project IDs and Custom GPT IDs remain distinct', () => {
    const { normalizeChat, normalizeProjectId } = loadProjectureInternals();
    const projectId = 'g-p-0123456789abcdef0123456789abcdef';

    assert.equal(normalizeProjectId(`${projectId}-project-slug`), projectId);
    assert.equal(normalizeProjectId('g-custom123'), null);

    const customChat = normalizeChat({
        id: 'custom-chat',
        title: 'Custom conversation',
        gizmo_id: 'g-custom123',
        conversation_origin: 'gizmo_interaction',
    });
    assert.equal(customChat.projectId, null);
    assert.equal(customChat.customGpt, true);
    assert.equal(customChat.customGptId, 'g-custom123');

    const projectChat = normalizeChat({ id: 'project-chat', gizmo_id: `${projectId}-project-slug` });
    assert.equal(projectChat.projectId, projectId);
    assert.equal(projectChat.customGpt, false);
    assert.equal(projectChat.customGptId, null);
});

test('board and per-Project vertical scroll positions survive a render replacement', () => {
    const { captureBoardScroll, restoreBoardScroll } = loadProjectureInternals();
    const oldBoard = { scrollLeft: 735, scrollTop: 4 };
    const oldZones = [
        { dataset: { dropProject: '__unassigned__' }, scrollLeft: 0, scrollTop: 148 },
        { dataset: { dropProject: 'g-p-project' }, scrollLeft: 0, scrollTop: 921 },
    ];
    const oldApp = {
        querySelector: () => oldBoard,
        querySelectorAll: () => oldZones,
    };
    const saved = captureBoardScroll(oldApp);

    const newBoard = { scrollLeft: 0, scrollTop: 0 };
    const newZones = oldZones.map(zone => ({
        dataset: { ...zone.dataset },
        scrollLeft: 0,
        scrollTop: 0,
    }));
    const newApp = {
        querySelector: () => newBoard,
        querySelectorAll: () => newZones,
    };
    restoreBoardScroll(newApp, saved);

    assert.deepEqual(newBoard, oldBoard);
    assert.equal(newZones[0].scrollTop, 148);
    assert.equal(newZones[1].scrollTop, 921);
});

test('a Custom GPT move requires explicit destructive-conversion consent', async () => {
    const { confirmations, moveChats, state } = loadProjectureInternals();
    const projectId = 'g-p-0123456789abcdef0123456789abcdef';
    state.projects = [{ id: projectId, name: 'Destination' }];
    state.chats = [{
        id: 'custom-chat',
        title: 'Custom conversation',
        projectId: null,
        customGpt: true,
        customGptId: 'g-custom123',
    }];

    await moveChats(['custom-chat'], projectId);

    assert.equal(confirmations.length, 1);
    assert.match(confirmations[0], /convert it into a standard ChatGPT chat/);
    assert.match(confirmations[0], /cannot restore that association with Undo/);
    assert.equal(state.chats[0].projectId, null);
    assert.equal(state.chats[0].customGptId, 'g-custom123');
});
