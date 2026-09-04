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
} = {}) {
    const source = fs.readFileSync(sourcePath, 'utf8').replace(
        /\n\s*init\(\);\n\}\)\(\);\s*$/,
        `
    globalThis.__projectureTest = {
        APP,
        FAVICON_STORAGE_KEY,
        IS_PREVIEW_BUILD,
        STORAGE_KEY,
        UserscriptBuildChannel,
        captureBoardScroll,
        moveChats,
        normalizeChat,
        normalizeProjectId,
        restoreBoardScroll,
        state,
    };
})();`
    );

    const confirmations = [];
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
            getItem() { return null; },
            setItem() {},
        },
        navigator: {},
        setInterval,
        setTimeout,
        structuredClone,
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.runInNewContext(source, sandbox, { filename: sourcePath });
    return { ...sandbox.__projectureTest, confirmations };
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
        assert.match(previewSource, /^\/\/ @version\s+1\.1\.3\.42$/m);
        assert.match(previewSource, /const UserscriptBuildChannel = "preview"; \/\/ PREVIEW_CHANNEL_MARKER/);
        assert.match(previewSource, /const UserscriptPreviewHash = "#proj-preview";/);

        const preview = loadProjectureInternals({ sourcePath: outputPath, hash: '#proj-preview' });
        assert.equal(preview.UserscriptBuildChannel, 'preview');
        assert.equal(preview.IS_PREVIEW_BUILD, true);
        assert.equal(preview.APP, 'Projecture [PREVIEW]');
        assert.equal(preview.STORAGE_KEY, 'projecture.preview.settings.v1');
        assert.equal(preview.FAVICON_STORAGE_KEY, 'projecture.preview.favicons.v1');
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});

test('selection controls share the toolbar without adding a board-shifting row', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'Projecture.user.js'), 'utf8');
    const toolbarStart = source.indexOf('<section class="toolbar">');
    const toolbarEnd = source.indexOf('</section>', toolbarStart);
    const toolbar = source.slice(toolbarStart, toolbarEnd);
    const headerStart = source.indexOf('<header class="topbar">');
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
