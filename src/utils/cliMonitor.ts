import si from 'systeminformation';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import util from 'util';
import blessed from 'blessed';
import contrib from 'blessed-contrib';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// --- Telemetry State Interfaces ---
interface GpuMetrics {
  gpuUtil: number;
  memUtil: number;
  vramUsedMB: number;
  vramTotalMB: number;
  available: boolean;
  isIdle?: boolean;
}

interface NetMetrics {
  rxSec: number;
  txSec: number;
  rxTotal: number;
  txTotal: number;
}

// Module-level state
let monitorTimeout: NodeJS.Timeout | null = null;
let isMonitorActive = false;

// Global screen and widgets
let screen: blessed.Widgets.Screen | null = null;
let cpuDonut: any;
let ramDonut: any;
let gpuDonut: any;
let vramDonut: any;
let netBox: blessed.Widgets.BoxElement;
let statusBox: blessed.Widgets.BoxElement;
let logWidget: any;
let menuBox: blessed.Widgets.BoxElement;

// Saved original console methods
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
};

// --- Formatting Helpers ---
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const safeI = Math.min(i, units.length - 1);
  return `${(bytes / Math.pow(1024, safeI)).toFixed(2)} ${units[safeI]}`;
}

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0.00 KB/s';
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
  }
  return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
}

// --- Data Fetchers ---

// 1. High-Precision CPU Metrics
async function getCpuMetrics() {
  try {
    const [load, temp] = await Promise.all([
      si.currentLoad(),
      si.cpuTemperature().catch(() => ({ main: null })),
    ]);
    const loadPercent = Math.round(load.currentLoad * 10) / 10;
    const tempStr = temp && temp.main ? `${Math.round(temp.main)}°C` : 'N/A';
    return { loadPercent, tempStr };
  } catch {
    return { loadPercent: 0, tempStr: 'N/A' };
  }
}

// 2. High-Precision RAM Metrics
async function getRamMetrics() {
  try {
    const mem = await si.mem();
    const usedBytes = mem.active && mem.active > 0 ? mem.active : Math.max(0, mem.total - mem.available);
    const totalBytes = mem.total;
    const percent = Math.min(100, Math.round((usedBytes / totalBytes) * 100));
    const usedGB = (usedBytes / 1024 ** 3).toFixed(1);
    const totalGB = (totalBytes / 1024 ** 3).toFixed(1);
    return { usedGB, totalGB, percent };
  } catch {
    return { usedGB: '0.0', totalGB: '0.0', percent: 0 };
  }
}

// 3. Real-Time Network Speed
let lastKnownNet: NetMetrics = { rxSec: 0, txSec: 0, rxTotal: 0, txTotal: 0 };
async function getNetMetrics(): Promise<NetMetrics> {
  try {
    const stats = await si.networkStats();
    if (Array.isArray(stats) && stats.length > 0) {
      let sumRxSec = 0;
      let sumTxSec = 0;
      let sumRxTotal = 0;
      let sumTxTotal = 0;

      for (const item of stats) {
        if (item.operstate === 'up' || item.rx_bytes > 0 || item.tx_bytes > 0) {
          sumRxSec += Math.max(0, item.rx_sec || 0);
          sumTxSec += Math.max(0, item.tx_sec || 0);
          sumRxTotal += Math.max(0, item.rx_bytes || 0);
          sumTxTotal += Math.max(0, item.tx_bytes || 0);
        }
      }

      lastKnownNet = {
        rxSec: sumRxSec,
        txSec: sumTxSec,
        rxTotal: sumRxTotal,
        txTotal: sumTxTotal,
      };
    }
  } catch {
    // Retain last known
  }
  return lastKnownNet;
}

// 4. GPU & VRAM Telemetry
async function getGpuMetrics(): Promise<GpuMetrics> {
  const isSystemBusy = Boolean((global as any).isTranscodingActive) || Boolean((global as any).isStreamActive);
  if (!isSystemBusy) {
    // Skip heavy OS calls when idle
    return { gpuUtil: 0, memUtil: 0, vramUsedMB: 0, vramTotalMB: 0, available: true, isIdle: true };
  }
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=utilization.gpu,utilization.memory,memory.used,memory.total --format=csv,noheader,nounits',
      { timeout: 1500 }
    );
    const line = stdout.trim().split('\n')[0];
    if (line) {
      const parts = line.split(',').map((p) => parseFloat(p.trim()));
      if (parts.length >= 4 && !isNaN(parts[0])) {
        return {
          gpuUtil: Math.round(parts[0]),
          memUtil: Math.round(parts[1]),
          vramUsedMB: Math.round(parts[2]),
          vramTotalMB: Math.round(parts[3]),
          available: true,
        };
      }
    }
  } catch {
    // nvidia-smi failed or not present
  }
  return { gpuUtil: 0, memUtil: 0, vramUsedMB: 0, vramTotalMB: 0, available: false };
}

// --- Console Patching ---
function hookConsole() {
  const formatArgs = (args: any[]) => {
    return util.formatWithOptions({ colors: true }, ...args);
  };

  console.log = (...args: any[]) => {
    if (isMonitorActive && logWidget) {
      logWidget.log(formatArgs(args));
      screen?.render();
    } else {
      originalConsole.log(...args);
    }
  };

  console.error = (...args: any[]) => {
    if (isMonitorActive && logWidget) {
      logWidget.log(formatArgs(args));
      screen?.render();
    } else {
      originalConsole.error(...args);
    }
  };

  console.warn = (...args: any[]) => {
    if (isMonitorActive && logWidget) {
      logWidget.log(formatArgs(args));
      screen?.render();
    } else {
      originalConsole.warn(...args);
    }
  };

  console.info = (...args: any[]) => {
    if (isMonitorActive && logWidget) {
      logWidget.log(formatArgs(args));
      screen?.render();
    } else {
      originalConsole.info(...args);
    }
  };
}

function unhookConsole() {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
}

// --- Init TUI ---
function initTui() {
  screen = blessed.screen({
    smartCSR: true,
    title: 'OmniHub System Telemetry'
  });

  const grid = new contrib.grid({ rows: 12, cols: 12, screen: screen });

  cpuDonut = grid.set(0, 0, 3, 3, contrib.donut, {
    label: 'CPU',
    radius: 8,
    arcWidth: 3,
    remainColor: 'black',
    yPadding: 2,
  });

  ramDonut = grid.set(0, 3, 3, 3, contrib.donut, {
    label: 'RAM',
    radius: 8,
    arcWidth: 3,
    remainColor: 'black',
    yPadding: 2,
  });

  gpuDonut = grid.set(0, 6, 3, 3, contrib.donut, {
    label: 'GPU',
    radius: 8,
    arcWidth: 3,
    remainColor: 'black',
    yPadding: 2,
  });

  vramDonut = grid.set(0, 9, 3, 3, contrib.donut, {
    label: 'VRAM',
    radius: 8,
    arcWidth: 3,
    remainColor: 'black',
    yPadding: 2,
  });

  netBox = grid.set(3, 0, 3, 6, blessed.box, {
    label: 'Network',
    tags: true,
    border: { type: 'line', fg: 'cyan' },
    style: { fg: 'white' },
    padding: { left: 1, top: 0 }
  });

  statusBox = grid.set(3, 6, 3, 6, blessed.box, {
    label: 'System Status',
    tags: true,
    border: { type: 'line', fg: 'yellow' },
    style: { fg: 'white' },
    padding: { left: 1, top: 0 }
  });

  logWidget = grid.set(6, 0, 5, 12, contrib.log, {
    fg: 'green',
    selectedFg: 'green',
    label: 'Server Log',
    border: { type: 'line', fg: 'magenta' },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', bg: 'red' }
  });

  menuBox = grid.set(11, 0, 1, 12, blessed.box, {
    tags: true,
    style: { bg: 'blue', fg: 'white' }
  });

  menuBox.setContent(' {bold}1{/bold}: Clear Cache | {bold}2{/bold}: Toggle Gaming Mode | {bold}3{/bold}: Restart Queue | {bold}4{/bold}: Exit');

  // Key bindings
  screen.key(['escape', 'q', 'C-c', '4'], function(ch, key) {
    console.log('[SYSTEM] 🛑 Shutting down and killing FFmpeg processes...');
    restoreTerminal();
    try {
      if (process.platform === 'win32') {
        exec('taskkill /F /IM ffmpeg.exe');
      } else {
        exec('killall -9 ffmpeg');
      }
    } catch (e) {}
    
    setTimeout(() => {
      if (typeof (global as any).gracefulShutdown === 'function') {
        (global as any).gracefulShutdown();
      } else {
        process.exit(0);
      }
    }, 500);
  });

  screen.key(['1'], function(ch, key) {
    try {
      const tempDir = path.join(process.cwd(), 'uploads', 'temp');
      const chunksDir = path.join(process.cwd(), 'chunks');
      [tempDir, chunksDir].forEach(dir => {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
          fs.mkdirSync(dir, { recursive: true });
        }
      });
      console.log('[SYSTEM] 🧹 Cache & temp files cleared successfully.');
    } catch (e: any) {
      console.error('[SYSTEM] Failed to clear cache:', e.message);
    }
  });

  screen.key(['2'], function(ch, key) {
    if (typeof (global as any).toggleGamingMode === 'function') {
      (global as any).toggleGamingMode();
    } else {
      (global as any).isGamingModeActive = !(global as any).isGamingModeActive;
      const status = (global as any).isGamingModeActive ? 'AKTIF (Queue Paused)' : 'NON-AKTIF (Queue Resumed)';
      console.log(`[GAMING MODE] 🎮 Status Gaming Mode: ${status}`);
    }
  });

  screen.key(['3'], function(ch, key) {
    console.log('[SYSTEM] 🔄 Restarting Server...');
    restoreTerminal();
    try {
      const spawnArgs = process.argv.slice(1);
      const child = spawn(process.argv[0], spawnArgs, {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      process.exit(0);
    } catch (e: any) {
      console.error('[SYSTEM] Failed to restart server:', e.message);
    }
  });

  screen.render();
}

function updateDashboard(cpu: any, ram: any, gpu: GpuMetrics, net: NetMetrics) {
  if (!screen) return;

  cpuDonut.setData([
    { percent: cpu.loadPercent, label: 'load', color: 'green' }
  ]);
  
  ramDonut.setData([
    { percent: ram.percent, label: 'used', color: 'cyan' }
  ]);

  if (gpu.available) {
    if (gpu.isIdle) {
      gpuDonut.setData([
        { percent: 0, label: '0%', color: 'magenta' }
      ]);
      vramDonut.setData([
        { percent: 0, label: 'Idle', color: 'red' }
      ]);
    } else {
      gpuDonut.setData([
        { percent: gpu.gpuUtil, label: 'load', color: 'magenta' }
      ]);
      const vramPct = Math.round((gpu.vramUsedMB / (gpu.vramTotalMB || 1)) * 100);
      vramDonut.setData([
        { percent: vramPct, label: 'used', color: 'red' }
      ]);
    }
  } else {
    gpuDonut.setData([
      { percent: 0, label: 'OFF', color: 'magenta' }
    ]);
    vramDonut.setData([
      { percent: 0, label: 'OFF', color: 'red' }
    ]);
  }

  const downStr = `{cyan-fg}▼ DOWN:{/cyan-fg} ${formatSpeed(net.rxSec)} (${formatBytes(net.rxTotal)})`;
  const upStr   = `{magenta-fg}▲ UP:{/magenta-fg}   ${formatSpeed(net.txSec)} (${formatBytes(net.txTotal)})`;
  netBox.setContent(`${downStr}\n${upStr}`);

  const isGaming = Boolean((global as any).isGamingModeActive);
  const isTranscoding = Boolean((global as any).isTranscodingActive);

  const gamingModeTag = isGaming
    ? `{magenta-fg}🎮 Gaming: PAUSED (100% VRAM Free){/magenta-fg}`
    : `{green-fg}⚡ Gaming: OFF (Queue Resumed){/green-fg}`;

  const queueTag = isTranscoding
    ? `{yellow-fg}🎬 NVENC: Transcoding (1/1 Max){/yellow-fg}`
    : `{cyan-fg}🎬 NVENC: Idle (Ready){/cyan-fg}`;
    
  statusBox.setContent(`Temp: ${cpu.tempStr}\n${gamingModeTag}\n${queueTag}`);

  screen.render();
}

export function startCliMonitor(): void {
  if (isMonitorActive) return;
  isMonitorActive = true;

  initTui();
  hookConsole();

  const tick = async () => {
    if (!isMonitorActive) return;
    try {
      const [cpu, ram, gpu, net] = await Promise.all([
        getCpuMetrics(),
        getRamMetrics(),
        getGpuMetrics(),
        getNetMetrics(),
      ]);

      if (isMonitorActive) {
        updateDashboard(cpu, ram, gpu, net);
      }
    } catch (err: any) {
      if (logWidget) logWidget.log(`[MONITOR ERROR] ${err?.message || err}`);
    }
  };

  const loop = async () => {
    if (!isMonitorActive) return;
    await tick();
    if (!isMonitorActive) return;
    const isSystemBusy = Boolean((global as any).isTranscodingActive) || Boolean((global as any).isStreamActive);
    const intervalMs = isSystemBusy ? 1500 : 5000;
    monitorTimeout = setTimeout(loop, intervalMs);
  };

  loop();

  const cleanup = () => stopCliMonitor();
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  process.once('exit', cleanup);
}

export function stopCliMonitor(): void {
  if (!isMonitorActive) return;
  isMonitorActive = false;

  if (monitorTimeout) {
    clearTimeout(monitorTimeout);
    monitorTimeout = null;
  }

  unhookConsole();
  restoreTerminal();
}

export function restoreTerminal(): void {
  if (screen) {
    screen.destroy();
    screen = null;
  }
}
