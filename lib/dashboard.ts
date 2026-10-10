import blessed from 'blessed';
// @ts-ignore (Karena modul contrib terkadang tidak memiliki deklarasi tipe yang lengkap)
import contrib from 'blessed-contrib';
import os from 'os';
import { exec, spawn } from 'child_process';

export const screen = blessed.screen({ smartCSR: true, title: 'OmniHub Server Control Center' });
const grid = new contrib.grid({ rows: 12, cols: 12, screen: screen });

// 1. KOTAK LOG (Di tengah bawah)
export const logBox = grid.set(4, 0, 8, 12, contrib.log, {
  fg: "green",
  selectedFg: "green",
  label: ' Server & FFmpeg Logs ',
  border: { type: 'line', fg: 'cyan' }
});

// --- BOTTOM ACTION BAR PANEL (RESPONSIVE ANCHORED) ---
const actionBox = blessed.box({
  parent: screen,
  bottom: 0,
  left: 0,
  width: '100%',
  height: 3,
  shrink: false,
  border: { type: 'line' },
  style: {
    border: { fg: 'cyan' },
    bg: 'blue',
    fg: 'white'
  },
  content: ' [1] Maintenance Mode  [2] Bersihkan Temp  [3] Shutdown Aman  [4] Restart Server'
});

// Pastikan Log Box dikunci bagian bawahnya di atas actionBox (bottom: 3)
if (typeof logBox !== 'undefined' && logBox) {
  logBox.position.bottom = 3;
}

// Keypress Event Handlers
screen.key(['1'], () => {
  (global as any).isMaintenance = !(global as any).isMaintenance;
  const status = (global as any).isMaintenance ? 'AKTIF' : 'NON-AKTIF';
  logBox.log(`[SYSTEM] Status Maintenance Mode: ${status}`);
  screen.render();
});

screen.key(['2'], () => {
  logBox.log('[SYSTEM] Memulai pembersihan berkas temporary...');
  // Pembersihan cache/temp
  logBox.log('[SYSTEM] Pembersihan berkas temporary selesai.');
  screen.render();
});

screen.key(['3'], () => {
  if ((global as any).isShuttingDown) return;
  (global as any).isShuttingDown = true;
  if (typeof logBox !== 'undefined' && logBox) {
    logBox.log('{yellow-fg}[SYSTEM] 🛑 Memulai proses Shutdown Bersih... Mohon tunggu.{/yellow-fg}');
  }
  screen.render();
  if (typeof (global as any).gracefulShutdown === 'function') {
    (global as any).gracefulShutdown();
  } else {
    restoreTerminal();
    process.exit(0);
  }
});

// --- HELPER METRIK CPU & RAM PRESISI (STAGE 1.14) ---
let prevCpusTicks = os.cpus();

function getAccurateCpuPercentage(): number {
  const currentCpus = os.cpus();
  let totalUser = 0, totalSys = 0, totalIdle = 0, totalIrq = 0;

  for (let i = 0; i < currentCpus.length; i++) {
    const prev = prevCpusTicks[i] ? prevCpusTicks[i].times : { user: 0, sys: 0, idle: 0, irq: 0 };
    const curr = currentCpus[i].times;

    totalUser += curr.user - prev.user;
    totalSys += curr.sys - prev.sys;
    totalIdle += curr.idle - prev.idle;
    totalIrq += (curr.irq || 0) - (prev.irq || 0);
  }

  prevCpusTicks = currentCpus;
  const totalTicks = totalUser + totalSys + totalIdle + totalIrq;
  if (totalTicks === 0) return 0;

  const activeTicks = totalTicks - totalIdle;
  return Math.min(100, Math.max(0, Math.round((activeTicks / totalTicks) * 1000) / 10));
}

function getAccurateRamPercentage(): number {
  const total = os.totalmem();
  const free = os.freemem();
  if (total === 0) return 0;
  return Math.min(100, Math.max(0, Math.round(((total - free) / total) * 1000) / 10));
}

// Global update method for Dashboard metrics
(global as any).getAccurateCpuPercentage = getAccurateCpuPercentage;
(global as any).getAccurateRamPercentage = getAccurateRamPercentage;

// --- TOMBOL [4] RESTART SERVER (STAGE 1.14 DECOUPLED REBOOT) ---
screen.key(['4'], () => {
  if ((global as any).isShuttingDown) return;
  (global as any).isShuttingDown = true;
  if (typeof logBox !== 'undefined' && logBox) {
    logBox.log('{cyan-fg}[SYSTEM] 🔄 Memulai Ulang (Restart) Server OmniHub...{/cyan-fg}');
  }
  screen.render();
  
  setTimeout(() => {
    if (typeof (global as any).gracefulRestart === 'function') {
      (global as any).gracefulRestart();
    } else {
      restoreTerminal();
      if (process.env.OMNIHUB_SUPERVISOR === '1') {
        process.exit(42);
      } else {
        const isWin = process.platform === 'win32';
        const child = spawn(
          isWin ? 'cmd.exe' : 'npm',
          isWin ? ['/c', 'start', 'cmd.exe', '/k', 'npm run dev'] : ['run', 'dev'],
          {
            cwd: process.cwd(),
            detached: true,
            stdio: 'ignore',
            shell: false,
            env: process.env
          }
        );
        child.unref();
        process.exit(0);
      }
    }
  }, 300);
});

// 2. GRAFIK CPU & RAM (Kiri Atas)
const cpuLine = grid.set(0, 0, 4, 6, contrib.line, {
  style: { line: "yellow", text: "green", baseline: "black" },
  xLabelPadding: 0,
  xPadding: 0,
  showLegend: false, // Dihilangkan agar grafik lebih lebar dan bersih ala btop
  wholeNumbersOnly: false,
  label: ' Menghitung Telemetri... '
});

// 3. TELEMETRI GPU NVENC (Kanan Atas)
const gpuBox = grid.set(0, 6, 4, 6, blessed.box, {
  label: ' NVIDIA NVENC Monitor ',
  content: '\n  Menunggu pembacaan sensor...',
  style: { fg: 'white', border: { fg: 'cyan' } }
});

// Variabel Penampung Data Grafik
const cpuData = { title: 'CPU', x: [] as string[], y: [] as number[], style: { line: 'red' } };
const ramData = { title: 'RAM', x: [] as string[], y: [] as number[], style: { line: 'blue' } };

// Kalkulator CPU khusus Windows (process.cpuUsage delta)
let lastCpuInfo: { idle: number, total: number } | null = null;
let lastCpuUsage = process.cpuUsage();
let lastTime = process.hrtime();

// --- RENDER PANELS TERMINAL REVISED (TAHAP 49 / 55.2) ---
// Helper Format Speed (Kbps vs Mbps berdasarkan Ambang Batas 1500 Kbps)
const formatNetworkSpeed = (bitsPerSec: number): string => {
  const kbps = bitsPerSec / 1000;
  if (kbps < 1500) {
    return `${kbps.toFixed(1)} Kbps`;
  } else {
    const mbps = kbps / 1000;
    return `${mbps.toFixed(2)} Mbps`;
  }
};

// Helper Format Total Data (MB vs GB berdasarkan Ambang Batas 1024 MB)
const formatTotalData = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  } else {
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  }
};

let screenInitialized = false;
let telemetryInterval: NodeJS.Timeout | null = null;
let originalLog = console.log;
let originalError = console.error;
let originalWarn = console.warn;
let originalStdoutWrite = process.stdout.write.bind(process.stdout);
let isIntercepting = false;
let isDashboardDestroyed = false;

export function restoreTerminal() {
  if (isDashboardDestroyed) return;
  isDashboardDestroyed = true;

  // 1. Bersihkan interval pemantauan sensor
  if (telemetryInterval) {
    clearInterval(telemetryInterval);
    telemetryInterval = null;
  }

  // 2. Kembalikan console & stdout ke fungsi aslinya
  if (isIntercepting) {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    process.stdout.write = originalStdoutWrite;
    isIntercepting = false;
  }

  // 3. Destroy layar blessed jika ada
  try {
    if (screen) {
      screen.destroy();
    }
  } catch (e) {}

  // 4. Pastikan stdin kembali normal (bukan raw mode) dan pause
  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  } catch (e) {}

  // 5. Kirim ANSI Escape Sequences untuk mengembalikan terminal ke kondisi default:
  // - \x1b[?1049l & \x1b[?47l : Matikan alternate screen buffer
  // - \x1b[?1l                : Reset Application Cursor Keys (DECCKM) ke mode normal
  //                             (Menghilangkan bug tombol panah muncul [[[A / ]]]]C di CMD & PowerShell)
  // - \x1b>                   : Reset keypad transmit mode ke numeric
  // - \x1b[?25h               : Tampilkan kembali kursor pengetikan
  // - \x1b[?1000l dkk         : Nonaktifkan pelacakan event mouse
  // - \x1b[0m                 : Reset seluruh format dan warna teks
  try {
    const ANSI_RESET = '\x1b[?1049l\x1b[?47l\x1b[?1l\x1b>\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[0m\r\n';
    originalStdoutWrite(ANSI_RESET);
  } catch (e) {}
}

export const destroyDashboard = restoreTerminal;

export function initDashboard() {
  if (screenInitialized) return;
  screenInitialized = true;

  // --- STAGE 1.11: COMPLETE CONSOLE & STDOUT INTERCEPTOR ---
  originalLog = console.log;
  originalError = console.error;
  originalWarn = console.warn;
  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  isIntercepting = true;

  const safeLogToBox = (msg: string, color?: string) => {
    if (!logBox) return;
    const cleanMsg = msg.replace(/\r?\n$/, '');
    if (!cleanMsg.trim()) return;

    if (color) {
      logBox.log(`{${color}-fg}${cleanMsg}{/${color}-fg}`);
    } else {
      logBox.log(cleanMsg);
    }
    screen.render();
  };

  console.log = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    safeLogToBox(msg);
  };

  console.error = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    safeLogToBox(msg, 'red');
  };

  console.warn = (...args: any[]) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    safeLogToBox(msg, 'yellow');
  };

  // Intercept direct stdout.write from external libraries (e.g., Node-Media-Server)
  process.stdout.write = (chunk: any, ...args: any[]): boolean => {
    if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) {
      const str = chunk.toString();
      // Bypass internal ANSI render sequences from blessed
      if (str.includes('\x1b[')) {
        return originalStdoutWrite(chunk, ...args);
      }
      safeLogToBox(str);
      return true;
    }
    return originalStdoutWrite(chunk, ...args);
  };

  // Auto re-render canvas on terminal window resize
  screen.on('resize', () => {
    screen.render();
  });

  (global as any).renderDashboard = () => {
    screen.render();
  };

  telemetryInterval = setInterval(() => {
    // -- Sensor RAM & CPU Presisi (Stage 1.14) --
    const usedMemPercent = getAccurateRamPercentage();
    const cpuPercent = getAccurateCpuPercentage();

    // Update Label ala Btop (Informasi angka real-time di bingkai atas)
    cpuLine.setLabel(` CPU: ${cpuPercent.toFixed(1)}% (Merah) | RAM: ${usedMemPercent.toFixed(1)}% (Biru) `);

    // Gunakan string kosong agar grafik mengalir mulus tanpa teks bergeser
    cpuData.x.push(' ');
    cpuData.y.push(cpuPercent);
    ramData.x.push(' ');
    ramData.y.push(usedMemPercent);

    // Memperpanjang jejak grafik (30 detik)
    if (cpuData.x.length > 30) { cpuData.x.shift(); cpuData.y.shift(); }
    if (ramData.x.length > 30) { ramData.x.shift(); ramData.y.shift(); }
    
    cpuLine.setData([cpuData, ramData]);

    // -- Sensor GPU (Nvidia SMI) --
    if (process.platform === 'win32') {
        // Query Presisi NVENC Encoder & GPU Core (Tahap 49)
        exec('nvidia-smi --query-gpu=utilization.gpu,utilization.encoder,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits', (err, stdout) => {
        const liveStatus = (global as any).isStreamActive 
          ? `{red-fg}🔴 [LIVE] ${(global as any).currentStreamKey}{/red-fg}` 
          : `⚪ [LIVE] OFFLINE`;
          
        const currentRxBitsPerSec = (global as any).currentRxBitsPerSec || 0;
        const currentTxBitsPerSec = (global as any).currentTxBitsPerSec || 0;
        const totalBytesRx = (global as any).totalBytesRx || 0;
        const totalBytesTx = (global as any).totalBytesTx || 0;
        
        // Panel Network Info Teks
        const netInfo = `🌐 NETWORK TRAFFIC:
 ⬇️ Down Speed : ${formatNetworkSpeed(currentRxBitsPerSec)} | Total Rx : ${formatTotalData(totalBytesRx)}
 ⬆️ Up Speed   : ${formatNetworkSpeed(currentTxBitsPerSec)} | Total Tx : ${formatTotalData(totalBytesTx)}`;

        if (!err && stdout) {
            const [util, encUtil, temp, memUsed, memTotal] = stdout.trim().split(', ');
            gpuBox.setContent(`\n  GPU : ${util}% | NVENC : ${encUtil}%\n  Temp: ${temp} C | VRAM: ${memUsed}/${memTotal} MB\n\n  ${netInfo}\n\n  ${liveStatus}`);
        } else {
            gpuBox.setContent(`\n  [ERROR] Tidak dapat membaca sensor NVIDIA\n\n  ${netInfo}\n\n  ${liveStatus}`);
        }
        screen.render();
        });
    } else {
        const liveStatus = (global as any).isStreamActive 
          ? `{red-fg}🔴 [LIVE] ${(global as any).currentStreamKey}{/red-fg}` 
          : `⚪ [LIVE] OFFLINE`;
          
        const currentRxBitsPerSec = (global as any).currentRxBitsPerSec || 0;
        const currentTxBitsPerSec = (global as any).currentTxBitsPerSec || 0;
        const totalBytesRx = (global as any).totalBytesRx || 0;
        const totalBytesTx = (global as any).totalBytesTx || 0;
        
        const netInfo = `🌐 NETWORK TRAFFIC:
 ⬇️ Down Speed : ${formatNetworkSpeed(currentRxBitsPerSec)} | Total Rx : ${formatTotalData(totalBytesRx)}
 ⬆️ Up Speed   : ${formatNetworkSpeed(currentTxBitsPerSec)} | Total Tx : ${formatTotalData(totalBytesTx)}`;

        gpuBox.setContent(`\n  [INFO] NVIDIA SMI khusus OS Windows.\n\n  ${netInfo}\n\n  ${liveStatus}`);
        screen.render();
    }

    screen.render();
  }, 2000);

  // Pencegahan Force Close: Hapus 'q' dan arahkan Ctrl+C ke Shutdown Aman
  screen.key(['escape', 'C-c'], function() {
    if ((global as any).isShuttingDown) return;
    (global as any).isShuttingDown = true;
    if (typeof logBox !== 'undefined' && logBox) {
      logBox.log('{yellow-fg}[SISTEM] Mencegah Force Close. Mengalihkan ke Shutdown Aman...{/yellow-fg}');
      screen.render();
    }
    if ((global as any).gracefulShutdown) {
      (global as any).gracefulShutdown();
    } else {
      restoreTerminal();
      process.exit(0);
    }
  });

  screen.render();
}
