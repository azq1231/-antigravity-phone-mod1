import express from 'express';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { activeConnections, getOrConnectParams, findAllInstances } from '../core/cdp_manager.js';
import { captureSnapshot, injectMessage, getAppState, setMode, setModel, injectScroll, injectImage, startNewChat, getChatHistory, selectChat } from '../core/automation.js';
import { spawnInstance, killInstance } from '../core/instance_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();
const PORTS = [9000, 9001, 9002, 9003];

const pkg = JSON.parse(fs.readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const APP_VERSION = pkg.version;

const DEDUP_WINDOW = 30000;
const processedMsgIds = new Map();

router.post('/send', async (req, res) => {
    try {
        const { message, msgId, image } = req.body;
        const port = parseInt(req.query.port) || 9000;

        if (msgId) {
            const last = processedMsgIds.get(msgId);
            if (last && Date.now() - last < DEDUP_WINDOW) return res.json({ ok: true, ignored: true });
            processedMsgIds.set(msgId, Date.now());
            const now = Date.now();
            for (const [id, time] of processedMsgIds) { if (now - time > DEDUP_WINDOW) processedMsgIds.delete(id); }
        }

        const conn = await getOrConnectParams(port);

        let result;
        if (image) {
            console.log('[API] Sending image upload...');
            result = await injectImage(conn, image, message);
            console.log('[API] Image injection result:', JSON.stringify({ ok: result.ok, error: result.error, method: result.method, logsCount: result.logs?.length }));
            if (result.logs) result.logs.forEach(l => console.log('  [AUTO-LOG]', l));
        } else {
            result = await injectMessage(conn, message, req.query.force === 'true');
            console.log('[API] Text injection result:', JSON.stringify(result));
        }

        if (!result.ok && msgId) processedMsgIds.delete(msgId);
        res.json(result);
    } catch (e) {
        console.error('[API] Error in /send:', e);
        res.status(503).json({ error: e.message });
    }
});

router.get('/snapshot', async (req, res) => {
    try {
        const conn = await getOrConnectParams(parseInt(req.query.port) || 9000);
        const snapshot = await captureSnapshot(conn);
        res.json(snapshot);
    } catch (e) { res.status(503).json({ error: e.message }); }
});

router.get('/app-state', async (req, res) => {
    try {
        const conn = await getOrConnectParams(parseInt(req.query.port) || 9000);
        const state = await getAppState(conn);
        res.json({ ...state, version: APP_VERSION });
    } catch (e) { res.json({ mode: 'Unknown', model: 'Unknown', version: APP_VERSION }); }
});

router.post('/set-mode', async (req, res) => {
    try {
        const conn = await getOrConnectParams(parseInt(req.query.port) || 9000);
        const result = await setMode(conn, req.body.mode);
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/set-model', async (req, res) => {
    try {
        const conn = await getOrConnectParams(parseInt(req.query.port) || 9000);
        const result = await setModel(conn, req.body.model);
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/new-chat', async (req, res) => {
    try {
        const conn = await getOrConnectParams(parseInt(req.query.port) || 9000);
        const result = await startNewChat(conn);
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/history', async (req, res) => {
    try {
        const conn = await getOrConnectParams(parseInt(req.query.port) || 9000);
        const result = await getChatHistory(conn);
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/select-chat', async (req, res) => {
    try {
        const { index } = req.body;
        const conn = await getOrConnectParams(parseInt(req.query.port) || 9000);
        const result = await selectChat(conn, index);
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/slots', async (req, res) => {
    const instances = await findAllInstances();
    const slots = PORTS.map(port => {
        const inst = instances.find(i => i.port === port);
        return { port, running: !!inst, title: inst ? inst.title : `Slot ${port}` };
    });
    res.json({ slots });
});

router.post('/start-slot', async (req, res) => {
    const { port } = req.body;
    if (!PORTS.includes(port)) return res.status(400).json({ error: 'Invalid port' });
    try {
        const result = await spawnInstance(port);
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/stop-slot', async (req, res) => {
    const { port } = req.body;
    try {
        const result = await killInstance(port, activeConnections);
        res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/kill-all', async (req, res) => {
    for (const port of PORTS) await killInstance(port, activeConnections);
    res.json({ success: true });
});

export default router;
