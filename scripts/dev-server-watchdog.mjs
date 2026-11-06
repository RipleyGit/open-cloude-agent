#!/usr/bin/env node
/**
 * Dev-server watchdog: wraps `tsx watch` so a crashed or hung backend is
 * detected and restarted automatically.
 *
 * Why this exists
 * ---------------
 * `tsx watch` only respawns the server process on a *file change*; it has no
 * handler for the child exiting on its own (verified against tsx 4.21). If the
 * backend crashes or deadlocks, the watcher stays "alive" with zero children
 * and never brings it back — and `concurrently` can't help, since it only sees
 * the (still-alive) watcher. `node --watch` has the same gap.
 *
 * What it does
 * ------------
 * 1. Spawns `tsx watch --tsconfig server/tsconfig.json server/index.ts` in its
 *    own process group so the whole tree can be killed together.
 * 2. Pipes the child's stdout/stderr to server-dev.log so a crash leaves
 *    evidence instead of vanishing into the terminal.
 * 3. Polls the public /health endpoint every few seconds. If it has been down
 *    long enough to rule out a file-change restart, it kills the tsx watch
 *    tree and respawns it.
 * 4. Forwards SIGINT/SIGTERM so Ctrl-C still tears everything down cleanly.
 */
import { spawn } from 'node:child_process';
import { openSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { request } from 'node:http';

const ROOT = process.cwd();
const LOG_PATH = resolve(ROOT, 'server-dev.log');
const HEALTH_HOST = '127.0.0.1';
const HEALTH_PORT = 3001;
const HEALTH_PATH = '/health';

const STARTUP_GRACE_MS = 20_000;    // don't probe during initial boot
const POLL_INTERVAL_MS = 5_000;     // how often to probe
const FAIL_THRESHOLD = 3;           // consecutive failures before restart
const RESTART_COOLDOWN_MS = 15_000; // min gap between restarts

const tsxArgs = ['--tsconfig', 'server/tsconfig.json', 'server/index.ts'];
const env = { ...process.env, CLOUDCLI_DEV_WATCHDOG: '1' };

const logFd = openSync(LOG_PATH, 'a');
function log(msg) {
    const line = `[watchdog ${new Date().toISOString()}] ${msg}\n`;
    process.stderr.write(line);
    try { writeFileSync(logFd, line); } catch { /* shutting down */ }
}

function checkHealth() {
    return new Promise((resolveOk) => {
        const req = request(
            { hostname: HEALTH_HOST, port: HEALTH_PORT, path: HEALTH_PATH, method: 'GET', timeout: 2500 },
            (res) => { res.resume(); resolveOk(res.statusCode >= 200 && res.statusCode < 400); },
        );
        req.on('error', () => resolveOk(false));
        req.on('timeout', () => { req.destroy(); resolveOk(false); });
        req.end();
    });
}

let child = null;
let restartTimer = null;
let lastRestartAt = 0;
let stopping = false;

function spawnChild() {
    log(`spawning tsx watch: tsx watch ${tsxArgs.join(' ')}`);
    child = spawn('npx', ['tsx', 'watch', ...tsxArgs], {
        cwd: ROOT, env, stdio: ['ignore', logFd, logFd], detached: true,
    });
    child.on('exit', (code, signal) => {
        log(`tsx watch exited (code=${code} signal=${signal})`);
        if (stopping) return;
        // tsx watch itself died (not just its grandchild) — respawn after cooldown.
        scheduleRestart('tsx-watch-exited');
    });
}

function scheduleRestart(reason) {
    if (stopping) return;
    const now = Date.now();
    const wait = Math.max(0, RESTART_COOLDOWN_MS - (now - lastRestartAt));
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
        restartTimer = null;
        lastRestartAt = Date.now();
        log(`restarting tsx watch (${reason})`);
        spawnChild();
    }, wait);
}

async function killTree(proc) {
    if (!proc || proc.exitCode !== null) return;
    const pid = proc.pid;
    // detached:true created a new process group; -pid signals the whole group.
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
    await new Promise((r) => setTimeout(r, 1500));
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
}

async function pollLoop() {
    await new Promise((r) => setTimeout(r, STARTUP_GRACE_MS));
    let fails = 0;
    while (!stopping) {
        const ok = await checkHealth();
        if (ok) {
            fails = 0;
        } else {
            fails++;
            log(`health check failed (${fails}/${FAIL_THRESHOLD})`);
            if (fails >= FAIL_THRESHOLD && !restartTimer) {
                fails = 0;
                log('health down — killing tsx watch tree to force a respawn');
                await killTree(child);
                // The exit handler normally calls scheduleRestart; schedule one
                // directly in case the kill signal didn't land.
                scheduleRestart('health-down');
            }
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
}

function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    log(`received ${signal}, shutting down`);
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    if (child && child.exitCode === null) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* ignore */ }
        setTimeout(() => {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { /* ignore */ }
            process.exit(0);
        }, 2500).unref();
    } else {
        process.exit(0);
    }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', () => {
    try { writeFileSync(logFd, `[watchdog ${new Date().toISOString()}] exiting\n`); } catch { /* ignore */ }
});

log(`logging tsx output to ${LOG_PATH}`);
spawnChild();
pollLoop().catch((err) => { log(`poll loop crashed: ${err?.stack ?? err}`); scheduleRestart('poll-crash'); });
