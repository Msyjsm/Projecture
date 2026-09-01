const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadProjectureInternals() {
    const sourcePath = path.join(__dirname, '..', 'Projecture.user.js');
    const source = fs.readFileSync(sourcePath, 'utf8').replace(
        /\n\s*init\(\);\n\}\)\(\);\s*$/,
        `
    globalThis.__projectureTest = {
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
            href: 'https://chatgpt.com/',
            origin: 'https://chatgpt.com',
            pathname: '/',
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
    vm.runInNewContext(source, sandbox, { filename: sourcePath });
    return { ...sandbox.__projectureTest, confirmations };
}

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
