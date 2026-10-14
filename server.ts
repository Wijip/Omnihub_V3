import 'dotenv/config';
import { spawn, execSync } from "child_process";
import express from 'express';
import { GoogleGenAI } from '@google/genai';

const aiApiKey = process.env.GEMINI_API_KEY || '';
const aiInstance = new GoogleGenAI({ apiKey: aiApiKey });
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

// --- DEKLARASI Wajib ESM __DIRNAME (TAHAP 44.3) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// @ts-ignore
import NodeMediaServer from 'node-media-server';
import { startCliMonitor, stopCliMonitor, restoreTerminal } from './src/utils/cliMonitor';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Top-level server references for graceful shutdown & resource cleanup
let viteServer: any = null;
let nmsServer: any = null;
let speedCheckInterval: NodeJS.Timeout | null = null;
let chunkCleanupInterval: any = null;
let archiveCleanupInterval: any = null;
let initialArchiveTimeout: any = null;
let queuePollingInterval: any = null;
let isGamingModeActive = false;
let isTranscodingActive = false;

// --- STATE LIVE STREAM TRACKER (TAHAP 43/44.4) ---
let isStreamActive = false;
let currentStreamKey = 'stream_key_wiji_hub';
let currentLiveVideoId: number | null = null;
let currentLiveUserId: number = 1;
let currentLiveTitle = 'Live Stream';
let currentLiveCategory = 'Gaming / Entertainment';
let currentLiveDescription = 'Siaran langsung resmi dari OmniHub Live Studio';
let liveStartedAt: string | null = null;
let ffmpegLiveProcess: any = null;
let liveChatMessages: Array<{
  id: string;
  userId: number;
  userName: string;
  avatarUrl: string;
  message: string;
  timestamp: string;
  isCreator?: boolean;
}> = [];

// Helper pendeteksi IP lokal dinamis
function getLocalIp(): string {
  try {
    const nets = os.networkInterfaces();
    // Prioritaskan adapter fisik (Abaikan virtual adapter WSL/VMware)
    for (const name of Object.keys(nets)) {
      const n = name.toLowerCase();
      if (n.includes('vmware') || n.includes('virtual') || n.includes('wsl') || n.includes('vbox') || n.includes('hyper')) continue;
      
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          if (net.address.startsWith('192.168.') || net.address.startsWith('10.') || net.address.startsWith('172.')) {
            return net.address;
          }
        }
      }
    }
    // Fallback jika tidak ada adapter fisik yang terdeteksi
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch (e) {}
  return '192.168.0.120';
}

// --- CONSOLE RESTORE HANDLER ---
export function restoreServerConsole() {
  // Console methods are handled cleanly by cliMonitor
}
// ----------------------------------------------

import multer from 'multer';
import ffmpeg from 'fluent-ffmpeg';
import PQueue from 'p-queue';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createServer as createViteServer } from 'vite';
import db, { initDB } from './src/lib/db';
import { Readable, Transform } from 'stream';

process.on('uncaughtException', (err) => { console.error('CRASH PREVENTED:', err); });
process.on('unhandledRejection', (reason) => { console.error('PROMISE REJECTION PREVENTED:', reason); });

// --- Binar Manipulation Helpers ---
const XOR_KEY = 0xAF;
const OBFUSCATE_SIZE = 100;

// Mengubah 100 byte pertama secara in-place tanpa memuat seluruh file ke RAM
export function obfuscateFileInPlace(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const fd = fs.openSync(filePath, 'r+');
  const buffer = Buffer.alloc(OBFUSCATE_SIZE);
  
  // Baca hanya byte pertama
  const bytesRead = fs.readSync(fd, buffer, 0, OBFUSCATE_SIZE, 0);
  
  // Lakukan XOR hanya pada byte yang berhasil dibaca
  for (let i = 0; i < bytesRead; i++) {
    buffer[i] = buffer[i] ^ XOR_KEY;
  }
  
  // Tulis kembali byte yang sudah diubah ke posisi paling awal (offset 0)
  fs.writeSync(fd, buffer, 0, bytesRead, 0);
  fs.closeSync(fd);
}

// Stream Decryptor ringan untuk menangani streaming file video s/d 20 GB
export function createRestoredStream(filePath: string, startOffset: number = 0, endOffset?: number) {
  let isHeaderProcessed = false;

  const decryptor = new Transform({
    transform(chunk, encoding, callback) {
      if (!isHeaderProcessed) {
        isHeaderProcessed = true;
        if (startOffset < OBFUSCATE_SIZE) {
          const overlap = OBFUSCATE_SIZE - startOffset;
          const headerSize = Math.min(overlap, chunk.length);
          for (let i = 0; i < headerSize; i++) {
            chunk[i] = chunk[i] ^ XOR_KEY;
          }
        }
      }
      this.push(chunk);
      callback();
    }
  });

  const options: any = { start: startOffset };
  if (endOffset !== undefined) options.end = endOffset;

  const targetStream = fs.createReadStream(filePath, options);
  targetStream.on('error', (err) => {
    console.error(`[STREAM FAIL] createRestoredStream error reading ${filePath}: ${err.message}`);
  });
  return targetStream.pipe(decryptor);
}
// ---------------------------------

// ============================================================================
// 1. KONFIGURASI FFMPEG & DIREKTORI
// ============================================================================
// Menggunakan global 'process' bawaan Node.js untuk menghindari error ES Module
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'ffprobe';

ffmpeg.setFfmpegPath(FFMPEG_PATH);
ffmpeg.setFfprobePath(FFPROBE_PATH);

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const THUMBNAIL_DIR = path.join(process.cwd(), 'thumbnails');
const PROCESSED_DIR = path.join(process.cwd(), 'processed');
const CHUNK_DIR = path.join(process.cwd(), 'chunks');
const LOG_DIR = path.join(process.cwd(), 'logs');

// Pastikan semua direktori eksis
[UPLOAD_DIR, THUMBNAIL_DIR, PROCESSED_DIR, CHUNK_DIR, LOG_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const JWT_SECRET = process.env.JWT_SECRET || 'OmniHub_Super_Secret_Key_2026_!@#_Permanent_Lock';
const hasNVENC = true;

// --- STAGE 1.17: AUTO-DETECT GPU ARCHITECTURE ---
let gpuProfile = 'modern';
try {
  const gpuOutput = execSync('nvidia-smi --query-gpu=name --format=csv,noheader', { encoding: 'utf8', stdio: 'pipe' }).toLowerCase();
  if (gpuOutput.includes('gtx 9') || gpuOutput.includes('gtx 8') || gpuOutput.includes('mx') || gpuOutput.includes('maxwell')) {
    gpuProfile = 'legacy';
    console.log(`[SYSTEM] Auto-Detected Legacy GPU (${gpuOutput.trim()}). Using NVENC Legacy Profile.`);
  } else {
    console.log(`[SYSTEM] Auto-Detected Modern GPU (${gpuOutput.trim()}). Using NVENC Modern Profile.`);
  }
} catch (e) {
  gpuProfile = 'legacy';
  console.log('[SYSTEM] nvidia-smi failed or not found. Defaulting to NVENC Legacy Profile for safety.');
}
// ------------------------------------------------

// ============================================================================
// 1.5 KONFIGURASI MULTI-RESOLUTION TRANCODING (ADMIN MANAGED)
// ============================================================================
const ENCODING_SETTINGS_FILE = path.join(process.cwd(), 'encoding-settings.json');
let encodingSettings: any = {
  maxUploadSizeGB: 5,
  "144p": { active: false, width: 256, height: 144, videoBitrate: "300k", audioBitrate: "64k" },
  "240p": { active: false, width: 426, height: 240, videoBitrate: "600k", audioBitrate: "64k" },
  "360p": { active: true, width: 640, height: 360, videoBitrate: "1000k", audioBitrate: "96k" },
  "480p": { active: true, width: 854, height: 480, videoBitrate: "1500k", audioBitrate: "128k" },
  "720p": { active: true, width: 1280, height: 720, videoBitrate: "4000k", audioBitrate: "128k" },
  "1080p": { active: true, width: 1920, height: 1080, videoBitrate: "8000k", audioBitrate: "192k" }
};

if (fs.existsSync(ENCODING_SETTINGS_FILE)) {
  try {
    encodingSettings = JSON.parse(fs.readFileSync(ENCODING_SETTINGS_FILE, 'utf-8'));
    if (encodingSettings.maxUploadSizeGB === undefined) {
      encodingSettings.maxUploadSizeGB = 5;
    }
  } catch (e) {
    console.error('[SYSTEM] Failed to parse encoding-settings.json, using defaults.');
  }
} else {
  fs.writeFileSync(ENCODING_SETTINGS_FILE, JSON.stringify(encodingSettings, null, 2));
}

const DISABLED_USERS_FILE = path.join(process.cwd(), 'disabled-users.json');
let disabledUsers: number[] = [];

if (fs.existsSync(DISABLED_USERS_FILE)) {
  try {
    disabledUsers = JSON.parse(fs.readFileSync(DISABLED_USERS_FILE, 'utf-8'));
  } catch (e) {
    console.error('[SYSTEM] Failed to parse disabled-users.json, using defaults.');
  }
} else {
  fs.writeFileSync(DISABLED_USERS_FILE, JSON.stringify(disabledUsers, null, 2));
}

// ============================================================================
// 2. INISIALISASI SERVER & ANTREAN FIFO
// ============================================================================
const app = express();
app.set('trust proxy', 1);

// ==========================================
// --- STAGE 1.29: SECURITY HARDENING ---
// ==========================================

// 1. HTTP Header Protection & Content Security Policy (Vite HMR & Media Streaming Safe)
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Memungkinkan loading gambar dari domain lain jika diperlukan
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:", "http:", "https:", "blob:"], // Mengizinkan Vite HMR, RTMP/FLV Stream & HLS
      imgSrc: ["'self'", "data:", "blob:", "*"],
      mediaSrc: ["'self'", "data:", "blob:", "*"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
    },
  },
}));

// 3. Strict Auth Limiter (Anti Brute-Force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 5, // Limit 5 percobaan gagal
  message: { error: 'Terlalu banyak percobaan login gagal. Demi keamanan, silakan tunggu 15 menit.' },
  standardHeaders: true, 
  legacyHeaders: false,
});

// --- NON-INVASIVE SYSTEM STABILITY NETWORK ENGINE (TAHAP 55.3) ---
let totalBytesRx = 0;
let totalBytesTx = 0;

let rxBytesInCurrentWindow = 0;
let txBytesInCurrentWindow = 0;

let currentRxBitsPerSec = 0;
let currentTxBitsPerSec = 0;

let lastSpeedCheckTime = performance.now();

// Middleware Non-Invasive (Aman dari Stream Lock & Freeze)
app.use((req, res, next) => {
  const socket = req.socket;
  const initialRx = socket ? socket.bytesRead : 0;
  const initialTx = socket ? socket.bytesWritten : 0;

  // Catat byte delta hanya ketika request/response selesai
  res.on('finish', () => {
    if (socket) {
      const deltaRx = Math.max(0, socket.bytesRead - initialRx);
      const deltaTx = Math.max(0, socket.bytesWritten - initialTx);

      if (deltaRx > 0) {
        totalBytesRx += deltaRx;
        rxBytesInCurrentWindow += deltaRx;
      }
      if (deltaTx > 0) {
        totalBytesTx += deltaTx;
        txBytesInCurrentWindow += deltaTx;
      }
    }
  });

  next();
});

// --- PRECISION TIMER & SMART FORMATTERS (TAHAP 55.3) ---
speedCheckInterval = setInterval(() => {
  const now = performance.now();
  const timeDeltaSec = Math.max(0.001, (now - lastSpeedCheckTime) / 1000); // Selisih waktu aktual dalam detik
  lastSpeedCheckTime = now;

  // Hitung Bits Per Second (Bytes * 8 / Δt)
  currentRxBitsPerSec = (rxBytesInCurrentWindow * 8) / timeDeltaSec;
  currentTxBitsPerSec = (txBytesInCurrentWindow * 8) / timeDeltaSec;

  // Reset jendela penghitung
  rxBytesInCurrentWindow = 0;
  txBytesInCurrentWindow = 0;

  // Export to global for dashboard
  (global as any).currentRxBitsPerSec = currentRxBitsPerSec;
  (global as any).currentTxBitsPerSec = currentTxBitsPerSec;
  (global as any).totalBytesRx = totalBytesRx;
  (global as any).totalBytesTx = totalBytesTx;
}, 1000);

// --- INJEKSI OMNIHUB CONFIG (TAHAP 22) ---
// Menggunakan process.cwd() sebagai pengganti __dirname di ekosistem ES Module
const CONFIG_PATH = path.join(process.cwd(), 'omnihub.config.json');

// Auto-generate file jika belum ada
if (!fs.existsSync(CONFIG_PATH)) {
    const defaultConfig = {
        resolutions: { "144p": false, "240p": false, "360p": true, "480p": true, "720p": true, "1080p": true }
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
}

// Endpoint GET konfigurasi
app.get('/api/admin/config', (req, res) => {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: true, message: 'Gagal membaca konfigurasi' });
    }
});

// Endpoint POST konfigurasi
app.post('/api/admin/config', (req, res) => {
    try {
        const { resolutions } = req.body;
        const config = { resolutions };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        res.json({ success: true, message: 'Konfigurasi resolusi diperbarui' });
    } catch (error) {
        res.status(500).json({ error: true, message: 'Gagal menyimpan konfigurasi' });
    }
});
// ------------------------------------------
const server = http.createServer(app);
// Setting up socket.io
const io = new Server(server, { cors: { origin: '*' } });

// --- SOCKET.IO REAL-TIME LIVE STREAMING & CHAT HANDLERS ---
io.on('connection', (socket) => {
  socket.on('join_live_room', () => {
    socket.join('live_stream_room');
    const room = io.sockets.adapter.rooms.get('live_stream_room');
    const count = room ? room.size : 1;
    io.to('live_stream_room').emit('live_viewer_count', { count });
  });

  socket.on('leave_live_room', () => {
    socket.leave('live_stream_room');
    const room = io.sockets.adapter.rooms.get('live_stream_room');
    const count = room ? room.size : 0;
    io.to('live_stream_room').emit('live_viewer_count', { count });
  });

  socket.on('send_live_chat', (data: any) => {
    try {
      const chatMsg = {
        id: 'chat_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        userId: Number(data.userId) || 0,
        userName: String(data.userName || 'Penonton').trim(),
        avatarUrl: String(data.avatarUrl || '').trim(),
        message: String(data.message || '').trim().slice(0, 300),
        timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        isCreator: Boolean(data.isCreator)
      };
      if (chatMsg.message) {
        liveChatMessages.push(chatMsg);
        if (liveChatMessages.length > 100) liveChatMessages.shift();
        io.to('live_stream_room').emit('new_live_chat', chatMsg);
      }
    } catch (e) {}
  });

  socket.on('disconnect', () => {
    const room = io.sockets.adapter.rooms.get('live_stream_room');
    const count = room ? room.size : 0;
    io.to('live_stream_room').emit('live_viewer_count', { count });
  });
});

// ============================================================================
// SMART NVENC VIDEO QUEUE & "GAMING MODE" RESOURCE MANAGER (3 PILLARS)
// ============================================================================
const queuedOrActiveVideos = new Set<number>();

// Helper membaca status Gaming Mode dari database SystemSettings
async function getGamingModeFromDB(): Promise<boolean> {
  try {
    const [rows]: any = await db.query(
      "SELECT setting_value FROM SystemSettings WHERE setting_key = 'gaming_mode' LIMIT 1"
    );
    if (rows && rows.length > 0) {
      return rows[0].setting_value === 'true' || rows[0].setting_value === '1';
    }
  } catch (err: any) {
    console.error('[SETTINGS] Gagal membaca status gaming_mode dari DB:', err.message);
  }
  return false;
}

// Helper memperbarui status Gaming Mode ke database SystemSettings
async function setGamingModeInDB(enabled: boolean): Promise<boolean> {
  try {
    await db.query(
      `INSERT INTO SystemSettings (setting_key, setting_value) 
       VALUES ('gaming_mode', ?) 
       ON DUPLICATE KEY UPDATE setting_value = ?`,
      [enabled ? 'true' : 'false', enabled ? 'true' : 'false']
    );
    isGamingModeActive = enabled;
    (global as any).isGamingModeActive = enabled;
    return true;
  } catch (err: any) {
    console.error('[SETTINGS] Gagal menyimpan status gaming_mode ke DB:', err.message);
    return false;
  }
}

// In-memory queue array (P-Queue / backward compatibility)
const ffmpegTranscodeQueue: Array<() => Promise<void>> = [];

// SMART QUEUE WORKER (Strict Concurrency = 1, NVENC Hardware Acceleration, Gaming Mode Aware)
async function processNextInFFmpegQueue(): Promise<void> {
  // Pillar 2: Strict Concurrency Limit (Maksimal 1 video diproses dalam satu waktu)
  if (isTranscodingActive) {
    return;
  }

  // Pillar 3: "Gaming Mode" Guard (Jika aktif, antrean berhenti agar 100% VRAM bebas untuk gaming)
  if (isGamingModeActive) {
    console.log('[SMART QUEUE] 🎮 Gaming Mode AKTIF: Antrean video dijeda (0% VRAM used by server).');
    return;
  }

  // 1. Eksekusi tugas in-memory jika tersedia
  if (ffmpegTranscodeQueue.length > 0) {
    const nextJob = ffmpegTranscodeQueue.shift();
    if (nextJob) {
      isTranscodingActive = true;
      try {
        await nextJob();
      } catch (e) {
        console.error('[FFMPEG QUEUE ERROR]:', e);
      } finally {
        isTranscodingActive = false;
        if (!isGamingModeActive) {
          setImmediate(processNextInFFmpegQueue);
        }
      }
      return;
    }
  }

  // 2. Polling Database: Ambil 1 video tertua berstatus 'pending' atau 'waiting'
  try {
    const [pendingRows]: any = await db.query(
      "SELECT id, url, title, upload_id, file_path FROM Videos WHERE status IN ('pending', 'waiting') ORDER BY id ASC LIMIT 1"
    );

    if (pendingRows && pendingRows.length > 0) {
      const vid = pendingRows[0];
      const vidId = vid.id;

      if (queuedOrActiveVideos.has(vidId)) {
        return;
      }

      isTranscodingActive = true;
      queuedOrActiveVideos.add(vidId);

      // Ubah status menjadi 'processing'
      await db.execute("UPDATE Videos SET status = 'processing' WHERE id = ?", [vidId]);
      io.emit('video-progress-' + vidId, { 
        status: 'processing', 
        progress: 0,
        engine: 'NVIDIA NVENC (RTX 3050)'
      });

      // Tentukan path video
      const fileName = vid.url ? path.basename(vid.url) : `${vid.upload_id}_${vid.title}`;
      let targetPath = path.join(UPLOAD_DIR, fileName);
      if (!fs.existsSync(targetPath) && vid.file_path && fs.existsSync(vid.file_path)) {
        targetPath = vid.file_path;
      }

      console.log(`[SMART QUEUE] 🎬 Memulai NVENC Video Processing untuk ID: ${vidId} (${vid.title})`);

      try {
        if (fs.existsSync(targetPath)) {
          await processVideo(vidId, targetPath, vid.title, vid.upload_id);
        } else {
          console.error(`[SMART QUEUE ERROR] File video tidak ditemukan di: ${targetPath}`);
          await db.execute("UPDATE Videos SET status = 'failed' WHERE id = ?", [vidId]);
        }
      } catch (err: any) {
        console.error(`[SMART QUEUE ERROR] Gagal memproses video ID ${vidId}:`, err.message);
      } finally {
        queuedOrActiveVideos.delete(vidId);
        isTranscodingActive = false;
        // Lanjutkan ke video berikutnya jika Gaming Mode masih non-aktif
        if (!isGamingModeActive) {
          setImmediate(processNextInFFmpegQueue);
        }
      }
    }
  } catch (dbErr: any) {
    console.error('[SMART QUEUE] Gagal membaca antrean video dari database:', dbErr.message);
  }
}

app.use(express.json());

// ============================================================================
// SYSTEM SETTINGS & GAMING MODE API
// ============================================================================
app.get('/api/settings', async (req, res) => {
  try {
    const [rows]: any = await db.query('SELECT setting_key, setting_value FROM SystemSettings');
    const settingsMap: Record<string, any> = {};
    if (rows && rows.length > 0) {
      for (const row of rows) {
        settingsMap[row.setting_key] = row.setting_value === 'true' ? true : row.setting_value === 'false' ? false : row.setting_value;
      }
    }

    const [pendingCountRows]: any = await db.query(
      "SELECT COUNT(*) as count FROM Videos WHERE status IN ('pending', 'waiting')"
    );

    res.json({
      success: true,
      settings: {
        gaming_mode: isGamingModeActive,
        ...settingsMap
      },
      gaming_mode: isGamingModeActive,
      isTranscodingActive,
      pendingVideosCount: pendingCountRows[0]?.count || 0
    });
  } catch (err: any) {
    console.error('[API ERROR] Gagal mengambil SystemSettings:', err.message);
    res.status(500).json({ error: true, message: 'Gagal mengambil pengaturan sistem' });
  }
});

app.post('/api/settings/gaming-mode', async (req, res) => {
  try {
    const { enabled } = req.body;
    const targetState = enabled !== undefined ? Boolean(enabled) : !isGamingModeActive;

    const saved = await setGamingModeInDB(targetState);
    if (!saved) {
      return res.status(500).json({ error: true, message: 'Gagal memperbarui status Gaming Mode' });
    }

    // Broadcast ke seluruh admin via WebSocket Socket.IO
    io.emit('gaming_mode_updated', {
      gaming_mode: isGamingModeActive,
      isTranscodingActive
    });

    console.log(`[GAMING MODE] 🎮 Status Gaming Mode: ${isGamingModeActive ? 'AKTIF (Queue Paused)' : 'NON-AKTIF (Queue Resumed)'}`);

    // Jika dinonaktifkan, langsung jalankan antrean pending
    if (!isGamingModeActive) {
      setImmediate(processNextInFFmpegQueue);
    }

    res.json({
      success: true,
      gaming_mode: isGamingModeActive,
      isTranscodingActive,
      message: isGamingModeActive 
        ? 'Gaming Mode AKTIF: Antrean video dijeda, 100% GPU VRAM dialokasikan untuk gaming.' 
        : 'Gaming Mode NON-AKTIF: Antrean video dilanjutkan secara otomatis.'
    });
  } catch (err: any) {
    console.error('[API ERROR] Gagal mengubah status Gaming Mode:', err.message);
    res.status(500).json({ error: true, message: 'Gagal mengubah status Gaming Mode' });
  }
});

// --- INJEKSI MAINTENANCE MIDDLEWARE (TAHAP 29) ---
app.use((req, res, next) => {
  if ((global as any).isMaintenance) {
    return res.status(503).json({ error: true, message: 'Sistem sedang dalam perawatan.' });
  }
  next();
});
// ------------------------------------------------

// Daftarkan ke dalam global scope agar bisa dijangkau oleh komponen dashboard CLI
(global as any).gracefulShutdown = () => (global as any).performGracefulShutdown?.(false);
(global as any).gracefulRestart = () => (global as any).performGracefulShutdown?.(true);

// --- DATABASE AUTO-INITIALIZATION (SELF-HEALING) ---
async function initializeDatabase(retryCount = 0) {
  try {
    // Pemanasan: Coba lakukan query ringan untuk memastikan Pool benar-benar siap
    await db.query('SELECT 1');
    
    if (retryCount === 0) console.log('[DB INIT] Memulai pengecekan struktur tabel otomatis...');
    
    // 1. Pembuatan Tabel Channels
    await db.query(`
      CREATE TABLE IF NOT EXISTS Channels (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        channel_name VARCHAR(255) NOT NULL,
        description TEXT NULL,
        avatar_url VARCHAR(255) NULL,
        banner_url VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_channels_user_id FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
      )
    `);
    
    // 1.5 Pembuatan Tabel Arsip (videos_deleted)
    await db.query(`
      CREATE TABLE IF NOT EXISTS videos_deleted (
        archive_id INT AUTO_INCREMENT PRIMARY KEY,
        original_video_id INT NOT NULL,
        uploader_id INT NOT NULL,
        title VARCHAR(255),
        archive_path VARCHAR(255),
        deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NULL
      )
    `);

    // 1.6 Pembuatan Tabel Tiket Reset Password
    await db.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        ticket_code VARCHAR(20) UNIQUE NOT NULL,
        status ENUM('pending', 'approved', 'used', 'expired') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NULL,
        CONSTRAINT fk_pwd_reset_user FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
      )
    `);

    // 1.65 Pembuatan Tabel Subscriptions
    await db.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        subscriber_id INT NOT NULL,
        leader_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_sub (subscriber_id, leader_id)
      )
    `);

    // 1.7 Penambahan Kolom Foto Profil (Auto-Migration)
    try {
      const [avatarCheck]: any = await db.query("SHOW COLUMNS FROM Users LIKE 'avatar_url'");
      if (avatarCheck.length === 0) {
        await db.query("ALTER TABLE Users ADD COLUMN avatar_url VARCHAR(255) NULL");
        console.log("[DB] Kolom 'avatar_url' berhasil ditambahkan ke tabel Users.");
      }
    } catch (err) {
      console.error("[DB ERROR] Gagal mengecek kolom avatar_url:", err);
    }

    // 2. Sinkronisasi Data Akun ke Channels
    const [syncResult]: any = await db.query(`
      INSERT INTO Channels (user_id, channel_name)
      SELECT 
        id, 
        CONCAT(firstName, ' ', lastName) 
      FROM Users 
      WHERE NOT EXISTS (SELECT 1 FROM Channels WHERE user_id = Users.id)
    `);
    
    if (syncResult && syncResult.affectedRows > 0) {
      console.log(`[DB INIT] Berhasil menyinkronkan ${syncResult.affectedRows} akun baru ke tabel Channels.`);
    }
    
    if (retryCount > 0) {
      console.log('[DB INIT] Pengecekan tertunda berhasil dieksekusi setelah database siap.');
    } else {
      console.log('[DB INIT] Struktur tabel Channels terverifikasi aman.');
    }
  } catch (error: any) {
    // Penanganan Race Condition: Menunggu db.ts selesai menghubungkan Pool
    if (error.message && error.message.includes('Pool is not ready') && retryCount < 5) {
      console.log(`[DB INIT WAIT] MySQL Pool belum siap. Menunggu koneksi... (Percobaan ${retryCount + 1}/5)`);
      setTimeout(() => initializeDatabase(retryCount + 1), 2000); // Coba lagi dalam 2 detik
      return;
    }
    console.error('[DB INIT ERROR] Gagal melakukan inisialisasi database otomatis:', error);
  }
}

// Eksekusi fungsi dengan jeda awal (memberi waktu db.ts untuk booting)
setTimeout(() => initializeDatabase(), 1000);
// ---------------------------------------------------

async function streamFileToResponse(req: any, res: any, filePath: string, fileName: string, isOmni: boolean) {
  if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) res.setHeader('Content-Type', 'image/jpeg');
  else if (fileName.endsWith('.mp4')) res.setHeader('Content-Type', 'video/mp4');

  try {
    const stat = await fs.promises.stat(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
      });
      
      if (isOmni) {
        const stream = createRestoredStream(filePath, start, end);
        stream.pipe(res);
        req.on('close', () => stream.destroy());
      } else {
        const stream = fs.createReadStream(filePath, { start, end });
        stream.on('error', (err) => {
          console.error(`[STREAM FAIL] Gagal membaca target video: ${err.message}`);
          if (!res.headersSent) res.status(500).end();
        });
        stream.pipe(res);
        req.on('close', () => stream.destroy());
      }
    } else {
      res.writeHead(200, { 'Content-Length': fileSize, 'Accept-Ranges': 'bytes' });
      if (isOmni) {
        const stream = createRestoredStream(filePath);
        stream.pipe(res);
        req.on('close', () => stream.destroy());
      } else {
        const stream = fs.createReadStream(filePath);
        stream.on('error', (err) => {
          console.error(`[STREAM FAIL] Gagal membaca target video: ${err.message}`);
          if (!res.headersSent) res.status(500).end();
        });
        stream.pipe(res);
        req.on('close', () => stream.destroy());
      }
    }
  } catch (err: any) {
    console.error(`[STREAM FAIL] Gagal membaca file: ${err.message}`);
    if (!res.headersSent) res.status(404).send('Not Found');
  }
}

// --- Binar Read/Restore Endpoint ---
app.get('/processed/:id/:filename', async (req: any, res: any) => {
  const fileId = req.params.id;
  const fileName = req.params.filename;
  // If it's a legacy actual .mp4/.jpg, serve it normally
  const normalPath = path.join(PROCESSED_DIR, fileId, fileName);
  const omniPath = path.join(PROCESSED_DIR, fileId, fileName + '.omni');
  
  if (await fs.promises.access(omniPath).then(() => true).catch(() => false)) {
     await streamFileToResponse(req, res, omniPath, fileName, true);
  } else if (await fs.promises.access(normalPath).then(() => true).catch(() => false)) {
     await streamFileToResponse(req, res, normalPath, fileName, false);
  } else {
     // Check if it's right in the processed directory itself (e.g. legacy)
     const directNormal = path.join(PROCESSED_DIR, fileId);
     const directOmni = path.join(PROCESSED_DIR, fileId + '.omni');
     if (await fs.promises.access(directOmni).then(() => true).catch(() => false)) {
         await streamFileToResponse(req, res, directOmni, fileName, true);
     } else if (await fs.promises.access(directNormal).then(() => true).catch(() => false)) {
         await streamFileToResponse(req, res, directNormal, fileName, false);
     } else {
         res.status(404).send('Not Found');
     }
  }
});

app.get('/thumbnails/:filename', async (req: any, res: any) => {
  const fileName = req.params.filename;
  const normalPath = path.join(THUMBNAIL_DIR, fileName);
  const omniPath = path.join(THUMBNAIL_DIR, fileName + '.omni');
  
  if (await fs.promises.access(omniPath).then(() => true).catch(() => false)) {
     await streamFileToResponse(req, res, omniPath, fileName, true);
  } else if (await fs.promises.access(normalPath).then(() => true).catch(() => false)) {
     await streamFileToResponse(req, res, normalPath, fileName, false);
  } else {
     res.status(404).send('Not Found');
  }
});

app.get('/uploads/:filename', async (req: any, res: any) => {
  const fileName = req.params.filename;
  const normalPath = path.join(UPLOAD_DIR, fileName);
  const omniPath = path.join(UPLOAD_DIR, fileName + '.omni');
  
  if (await fs.promises.access(omniPath).then(() => true).catch(() => false)) {
     await streamFileToResponse(req, res, omniPath, fileName, true);
  } else if (await fs.promises.access(normalPath).then(() => true).catch(() => false)) {
     await streamFileToResponse(req, res, normalPath, fileName, false);
  } else {
     res.status(404).send('Not Found');
  }
});
// -----------------------------------

// ============================================================================
// 3. SYSTEM LOGGER UTILITY
// ============================================================================
async function systemLog(level: string, source: string, message: string, metadata: any = null) {
  console.log(`[SYSTEM] [${level}] [${source}] ${message}`);
  try {
    await db.execute('INSERT INTO SystemLogs (level, source, message, metadata) VALUES (?, ?, ?, ?)', [
      level, source, message, metadata ? JSON.stringify(metadata) : null
    ]);
  } catch (e) {
    console.error('[SYSTEM] Failed to write to SystemLogs DB:', e);
  }

  if (source === 'FFmpeg' || level === 'ERROR' || level === 'CRITICAL') {
    try {
      const logLine = `[${new Date().toISOString()}] [${level}] [${source}] ${message} ${metadata ? JSON.stringify(metadata) : ''}\n`;
      fs.appendFileSync(path.join(LOG_DIR, 'system.log'), logLine);
    } catch (e) {
      console.error('[SYSTEM] Failed to write to system.log file:', e);
    }
  }

  io.emit('system-log', { level, source, message, metadata, created_at: new Date().toISOString() });
}

// ============================================================================
// 4. MIDDLEWARE OTENTIKASI & RBAC
// ============================================================================
const authenticate = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    console.log('[AUTH] Ditolak: Frontend tidak mengirimkan Token di Header!');
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (disabledUsers.includes(decoded.id)) {
      return res.status(403).json({ error: 'Forbidden: Account has been disabled. Please contact support.' });
    }
    req.user = decoded;
    next();
  } catch (e: any) {
    console.log('[AUTH] Ditolak: Token tidak cocok atau expired! Alasan:', e.message);
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

const isAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
};

// Middleware Khusus Download (Mendukung Header & Query URL)
const authenticateDownload = (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).send('Unauthorized: No token provided');
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (disabledUsers.includes(decoded.id)) {
      return res.status(403).send('Forbidden: Account has been disabled.');
    }
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).send('Unauthorized: Invalid token');
  }
};

// --- HELPER ENGINE KALKULASI PERTEMUAN SISWA (STAGE 1.12 OPTIMIZED) ---
async function calculateNextMeeting(studentName: string, programId: number, sessionDateStr?: string) {
  const cleanName = studentName.trim();
  const pId = typeof programId === 'number' ? programId : parseInt(String(programId), 10);

  if (isNaN(pId)) {
    return { recommendedMeeting: 1, type: 'reset_monthly', isReset: false, maxQuota: null, isQuotaExceeded: false };
  }

  // Helper ekstraksi string YYYY-MM tanpa terpengaruh offset timezone
  const getYearMonthString = (dateInput: Date | string): string => {
    if (!dateInput) return new Date().toISOString().slice(0, 7);
    if (typeof dateInput === 'string') {
      const match = dateInput.match(/^(\d{4})-(\d{2})/);
      if (match) return `${match[1]}-${match[2]}`;
    }
    const d = new Date(dateInput);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  };

  const targetYM = getYearMonthString(sessionDateStr || new Date());

  // 1. Ambil Informasi Program
  const [progs]: any = await db.query('SELECT * FROM Programs WHERE id = ?', [pId]);
  if (!progs || progs.length === 0) {
    return { recommendedMeeting: 1, type: 'reset_monthly', isReset: false, maxQuota: null, isQuotaExceeded: false };
  }

  const program = progs[0];
  const maxQuota = program.max_quota ? parseInt(program.max_quota, 10) : null;

  // 2. Cek Riwayat Terakhir Siswa (Urutkan dari sesi & ID terbaru)
  const [history]: any = await db.query(
    'SELECT * FROM StudentProgress WHERE LOWER(student_name) = LOWER(?) AND program_id = ? ORDER BY last_session_date DESC, id DESC LIMIT 1',
    [cleanName, pId]
  );

  if (!history || history.length === 0) {
    return {
      recommendedMeeting: 1,
      type: program.type,
      isReset: false,
      maxQuota,
      isQuotaExceeded: maxQuota ? 1 > maxQuota : false
    };
  }

  const lastRecord = history[0];
  const lastYM = getYearMonthString(lastRecord.last_session_date);

  if (program.type === 'reset_monthly') {
    const isNewMonth = targetYM !== lastYM;
    if (isNewMonth) {
      return {
        recommendedMeeting: 1,
        type: 'reset_monthly',
        isReset: true,
        maxQuota,
        isQuotaExceeded: maxQuota ? 1 > maxQuota : false
      };
    } else {
      let nextMeeting = (lastRecord.last_meeting_number || 0) + 1;
      let isQuotaExceeded = false;
      if (maxQuota && nextMeeting > maxQuota) {
        isQuotaExceeded = true;
        nextMeeting = maxQuota;
      }
      return {
        recommendedMeeting: nextMeeting,
        type: 'reset_monthly',
        isReset: false,
        maxQuota,
        isQuotaExceeded
      };
    }
  } else {
    // Tipe Continuous
    let nextMeeting = (lastRecord.last_meeting_number || 0) + 1;
    let isQuotaExceeded = false;
    if (maxQuota && nextMeeting > maxQuota) {
      isQuotaExceeded = true;
      nextMeeting = maxQuota;
    }
    return {
      recommendedMeeting: nextMeeting,
      type: 'continuous',
      isReset: false,
      maxQuota,
      isQuotaExceeded
    };
  }
}

// ============================================================================
// 5. MULTI-RESOLUTION FFMPEG GPU CUDA (RTX 3050 HARDWARE PIPELINE)
// ============================================================================
function processVideo(videoId: number, inputPath: string, originalFilename: string, uploadId?: string): Promise<void> {
  return new Promise(async (resolveQueue, rejectQueue) => {
    const startTime = Date.now();
    let activeInputPath = inputPath;

    try {
      await systemLog('INFO', 'FFmpeg', `Started multi-resolution processing for video ${videoId}`, { inputPath, originalFilename });
      console.log(`[SYSTEM] Starting FFmpeg NVENC Multi-Resolution Pipeline for VideoID: ${videoId}`);

      // De-obfuscate in-place directly on source file without disk duplication (Stage 1.3)
      if (fs.existsSync(inputPath)) {
        obfuscateFileInPlace(inputPath);
      } else {
        throw new Error('Input obfuscated file not found');
      }

      let highestResUrl = '';
      let highestResWidth = 0;

      await db.execute('UPDATE Videos SET status = ? WHERE id = ?', ['processing', videoId]);
      io.emit('video-progress-' + videoId, { status: 'processing', progress: 0 });

      // Generate Thumbnail consistently
      const relativeThumbPath = `processed/${videoId}/thumbnail.jpg`;
      const absoluteThumbDir = path.join(PROCESSED_DIR, String(videoId));
      const absoluteThumbPath = path.join(absoluteThumbDir, 'thumbnail.jpg');
      
      if (!fs.existsSync(absoluteThumbDir)) {
        fs.mkdirSync(absoluteThumbDir, { recursive: true });
      }

      await new Promise<void>((resolveThumb) => {
        const stat = fs.statSync(activeInputPath);
        if (!stat.isFile()) {
            resolveThumb();
            return;
        }
        const thumbCommand = ffmpeg(activeInputPath);
        if (uploadId) activeFFmpegProcesses.set(uploadId, thumbCommand);
        activeFFmpegProcesses.set(String(videoId), thumbCommand);

        thumbCommand
          .on('end', () => {
            if (uploadId) activeFFmpegProcesses.delete(uploadId);
            activeFFmpegProcesses.delete(String(videoId));
            console.log(`[SYSTEM] Generated thumbnail for VideoID: ${videoId}`);
            const omniThumb = absoluteThumbPath + '.omni';
            fs.renameSync(absoluteThumbPath, omniThumb);
            obfuscateFileInPlace(omniThumb);
            resolveThumb();
          })
          .on('error', (err) => {
            if (uploadId) activeFFmpegProcesses.delete(uploadId);
            activeFFmpegProcesses.delete(String(videoId));
            console.error(`[SYSTEM] Thumbnail generation failed:`, err);
            resolveThumb();
          })
          .seekInput('00:00:01')
          .frames(1)
          .outputOptions(['-q:v 2'])
          .output(absoluteThumbPath)
          .run();
      });

      await db.execute('UPDATE Videos SET thumbnail_url = ? WHERE id = ?', [`/${relativeThumbPath}`, videoId]);

      // Probe Source Video Resolution
      const metadataStr = await new Promise<any>((resolve, reject) => {
        ffmpeg.ffprobe(activeInputPath, (err: any, data: any) => {
          if (err) resolve(null);
          else resolve(data);
        });
      });
      
      let sourceHeight = 0;
      let sourceWidth = 0;
      if (metadataStr && metadataStr.streams) {
        const videoStream = metadataStr.streams.find((s: any) => s.codec_type === 'video');
        if (videoStream) {
          sourceHeight = videoStream.height || 0;
          sourceWidth = videoStream.width || 0;
          console.log(`[SYSTEM] Detected source video resolution: ${sourceWidth}x${sourceHeight}`);
        }
      }

      // Phase 1 (Efficiency Pass) & Phase 2 (Quality Pass) Hybrid Transcoding
      let activeResolutions = Object.entries(encodingSettings).filter(([_, config]: any) => config.active);
      
      // --- INJEKSI FILTER RESOLUSI DINAMIS ---
      try {
        const configData = await fs.promises.readFile(CONFIG_PATH, 'utf-8');
        const currentConfig = JSON.parse(configData).resolutions;
        activeResolutions = activeResolutions.filter(([resName, _]: any) => {
            return currentConfig[resName] === true;
        });
      } catch (err) {
        console.error('[SYSTEM] Gagal membaca konfigurasi resolusi dinamis', err);
      }
      // ---------------------------------------
      
      // Adaptive input mechanism: skip generating output resolutions higher than source height
      if (sourceHeight > 0) {
        activeResolutions = activeResolutions.filter(([_, config]: any) => config.height <= sourceHeight + 16);
        if (activeResolutions.length === 0) {
           const smallest = Object.entries(encodingSettings).filter(([_, config]: any) => config.active).sort((a: any, b: any) => a[1].height - b[1].height)[0];
           if (smallest) activeResolutions.push(smallest);
        }
      }

      if (activeResolutions.length === 0) {
        throw new Error('No active resolutions were processed - check admin configuration');
      }

      const phase1Resolutions = activeResolutions.filter(([_, config]: any) => config.height <= 480);
      const phase2Resolutions = activeResolutions.filter(([_, config]: any) => config.height > 480);

      const totalWeight = (phase1Resolutions.length > 0 ? 40 : 0) + (phase2Resolutions.length > 0 ? 60 : 0);
      let currentProgressBase = 0;

      const runPhase = async (resolutions: any[], passName: string, preset: string, weightInfo: {base: number, weight: number}) => {
        if (resolutions.length === 0) return;
        console.log(`[SYSTEM] Starting ${passName} for VideoID: ${videoId} with resolutions:`, resolutions.map(r => r[0]).join(', '));
        
        // --- ADAPTIVE RESOLUTION COMPRESSION MATRIX (TAHAP 55.4) ---
        interface ResolutionProfile {
          name: string;
          width: number;
          height: number;
          bitrate: string;      // Target Bitrate (e.g. '2500k')
          maxrate: string;      // Peak Bitrate (e.g. '3500k')
          bufsize: string;      // Buffer Size (e.g. '5000k')
          cq: number;           // Constant Quality Factor NVENC (26 - 32)
        }

        // STAGE 1.24: Extreme Compression Target (Visually Lossless at ultra-low bitrates)
        const RESOLUTION_PROFILES: Record<string, ResolutionProfile> = {
          '1080p': { name: '1080p', width: 1920, height: 1080, bitrate: '1800k', maxrate: '2500k', bufsize: '3500k', cq: 27 },
          '720p':  { name: '720p',  width: 1280, height: 720,  bitrate: '900k',  maxrate: '1200k', bufsize: '1800k', cq: 29 },
          '480p':  { name: '480p',  width: 854,  height: 480,  bitrate: '450k',  maxrate: '700k',  bufsize: '1000k', cq: 31 },
          '360p':  { name: '360p',  width: 640,  height: 360,  bitrate: '250k',  maxrate: '400k',  bufsize: '600k',  cq: 33 }
        };

        // --- TAHAP 67.0: ASPECT RATIO SAFEGUARD & GPU ADAPTIVE (STAGE 1.17) ---
        const buildPureGPUVRAMArgs = (inputPath: string, outputPath: string, targetResName: string, srcW: number, srcH: number) => {
          const profile = RESOLUTION_PROFILES[targetResName] || RESOLUTION_PROFILES['720p'];
          const isVertical = srcH > srcW;
          const scaleFilter = isVertical 
            ? `scale_cuda=${profile.height}:-2` 
            : `scale_cuda=${profile.width}:-2`;

          const isModern = gpuProfile === 'modern';
          // STAGE 1.24: Use p7 (Slowest, Best Quality) for extreme compression efficiency
          const nvencPreset = isModern ? 'p7' : 'slow';

          const baseArgs = [
            '-progress', 'pipe:1',
            '-nostats',
            
            // Demuxer Fixes & Timestamp Sync
            '-fflags', '+genpts+discardcorrupt',
            '-avoid_negative_ts', 'make_zero',
            '-analyzeduration', '100M',
            '-probesize', '100M',

            // --- OPTIMIZED NVENC EXTREME COMPRESSION COMMAND GENERATOR ---
            '-hwaccel', 'cuda',
            '-hwaccel_output_format', 'cuda',
            '-i', inputPath,
            '-vf', scaleFilter,
            '-c:v', 'h264_nvenc',
            '-preset', nvencPreset,
            '-profile:v', 'high', // Force High Profile for better compression ratio
            '-rc', 'vbr',
            '-cq', profile.cq.toString(),
            '-b:v', profile.bitrate,
            '-maxrate', profile.maxrate,
            '-bufsize', profile.bufsize
          ];

          if (isModern) {
              // Enable Two-Pass encoding (-multipass 2) to maintain sharpness at low bitrates
              baseArgs.push('-spatial_aq', '1', '-temporal_aq', '1', '-bf', '3', '-multipass', '2');
          } else {
              baseArgs.push('-bf', '0'); // Legacy Maxwell safe fallback
          }

          baseArgs.push(
            '-c:a', 'aac',
            '-b:a', profile.height <= 480 ? '96k' : '128k',
            '-ac', '2',
            '-y', outputPath
          );
          
          return baseArgs;
        };

        const attachFFmpegProgressListeners = (proc: any, uploadIdStr: string) => {
          let fileTotalDuration = 0;
          let lastProgressEmit = 0;
          let lastEmitTimestamp = 0;
          let remainder = '';

          proc.stdout.on('data', (chunk: any) => {
            remainder += chunk.toString();
            const lines = remainder.split('\n');
            remainder = lines.pop() || '';
            
            for (const line of lines) {
              const [key, value] = line.trim().split('=');
              // --- STRICT 99% CAP FFMPEG PARSER + THROTTLED SOCKET EMISSION (STAGE 1.2) ---
              if (key === 'out_time_ms') {
                const microseconds = parseInt(value, 10);
                if (!isNaN(microseconds) && fileTotalDuration > 0) {
                  const currentSeconds = microseconds / 1000000;
                  const calculatedPercent = Math.min(99, Math.max(1, Math.floor((currentSeconds / fileTotalDuration) * 100)));
                  
                  const passProgress = (calculatedPercent * weightInfo.weight) / 100;
                  const totalProgress = Math.min(99, Math.floor(weightInfo.base + passProgress));
                  
                  if (uploadIdStr) {
                      encodingProgressMap.set(uploadIdStr, totalProgress);
                  }

                  const now = Date.now();
                  // Throttling: Emit hanya jika progress naik DAN (selisih >= 300ms ATAU mencapai batas 99%)
                  if (totalProgress > lastProgressEmit && (now - lastEmitTimestamp >= 300 || totalProgress === 99)) {
                    lastProgressEmit = totalProgress;
                    lastEmitTimestamp = now;
                    io.emit('video-progress-' + videoId, { 
                      status: 'processing', 
                      progress: totalProgress,
                      encodingProgress: totalProgress,
                      resolution: `${passName} (${resolutions.map(r => r[0]).join(', ')})`,
                      engine: 'NVENC Hybrid Two-Pass'
                    });
                  }
                }
              }
            }
          });

          proc.stderr.on('data', (chunk: any) => {
            const logStr = chunk.toString();
            if (!fileTotalDuration) {
              const durationMatch = logStr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/) || logStr.match(/Duration:\s*(\d+):(\d+):(\d+)/);
              if (durationMatch) {
                const h = parseFloat(durationMatch[1]);
                const m = parseFloat(durationMatch[2]);
                const s = parseFloat(durationMatch[3]);
                fileTotalDuration = h * 3600 + m * 60 + s;
                console.log(`[FFMPEG PROBE] Durasi Total Video Detected: ${fileTotalDuration} Detik (ID: ${uploadIdStr})`);
                db.execute('UPDATE Videos SET duration = ? WHERE id = ?', [Math.round(fileTotalDuration), videoId]).catch(() => {});
              }
            }
            
            // --- FFMPEG PROGRESS PARSING DARI STDERR (TAHAP 55.7) ---
            if (fileTotalDuration > 0) {
              const timeMatch = logStr.match(/time=(\d+):(\d+):(\d+\.\d+)/) || logStr.match(/time=(\d+):(\d+):(\d+)/);
              if (timeMatch) {
                const h = parseFloat(timeMatch[1]);
                const m = parseFloat(timeMatch[2]);
                const s = parseFloat(timeMatch[3]);
                const currentSeconds = h * 3600 + m * 60 + s;
                
                const calculatedPercent = Math.min(99, Math.max(1, Math.floor((currentSeconds / fileTotalDuration) * 100)));
                const passProgress = (calculatedPercent * weightInfo.weight) / 100;
                const totalProgress = Math.min(99, Math.floor(weightInfo.base + passProgress));

                if (uploadIdStr) {
                    encodingProgressMap.set(uploadIdStr, totalProgress);
                }

                const now = Date.now();
                if (totalProgress > lastProgressEmit && (now - lastEmitTimestamp >= 300 || totalProgress === 99)) {
                  lastProgressEmit = totalProgress;
                  lastEmitTimestamp = now;
                  
                  io.emit('video-progress-' + videoId, { 
                    status: 'processing', 
                    progress: totalProgress,
                    encodingProgress: totalProgress,
                    resolution: `${passName} (${resolutions.map(r => r[0]).join(', ')})`,
                    engine: 'NVENC Hybrid Two-Pass'
                  });
                }
              }
            }
          });
        };

        // --- PURE CUDA VRAM EXECUTION ENGINE (TAHAP 54.4) ---
        const executePureGPUVRAMTranscoding = async (uploadIdStr: string, inputPath: string, outputPath: string, targetResName: string) => {
          return new Promise<void>((resolve, reject) => {
            console.log(`[PURE GPU VRAM 54.4] Memulai 100% Pure CUDA VRAM Transcoding untuk ID: ${uploadIdStr} (Res: ${targetResName})...`);
            
            const args = buildPureGPUVRAMArgs(inputPath, outputPath, targetResName, sourceWidth, sourceHeight);
            
            // STAGE 1.30: Detached process mapping for reliable Cross-OS termination
            const ffmpegProc = spawn('ffmpeg', args, { detached: os.platform() !== 'win32' });

            // Mendaftarkan instance untuk Force Stop / Abort Engine
            if (uploadIdStr) activeFFmpegProcesses.set(uploadIdStr, ffmpegProc);
            attachFFmpegProgressListeners(ffmpegProc, uploadIdStr);

            ffmpegProc.on('close', async (code) => {
              if (uploadIdStr) activeFFmpegProcesses.delete(uploadIdStr);
              
              if (code === 0) {
                console.log(`[PURE GPU VRAM 54.4] Sub-pass resolution ${targetResName} completed for ID: ${uploadIdStr}`);
                resolve();
              } else {
                console.error(`[PURE GPU VRAM 54.4] ERROR: GPU Processing exited with code ${code}.`);
                reject(new Error(`Pure GPU Transcoding failed with exit code ${code}`));
              }
            });

            ffmpegProc.on('error', (err) => {
              if (uploadIdStr) activeFFmpegProcesses.delete(uploadIdStr);
              console.error(`[PURE GPU VRAM 54.4] PROCESS ERROR:`, err);
              reject(err);
            });
          });
        };

        for (let i = 0; i < resolutions.length; i++) {
          const [resKey, resConfig] = resolutions[i];
          const outputPath = path.join(PROCESSED_DIR, `processed-${videoId}-${resKey}.mp4`);
          try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }
          
          await executePureGPUVRAMTranscoding(uploadId || '', activeInputPath, outputPath, resKey);
        }
      };

      try {
        if (phase1Resolutions.length > 0) {
          const weight = (40 / totalWeight) * 100;
          await runPhase(phase1Resolutions, 'Phase 1 (Efficiency)', 'p1', { base: currentProgressBase, weight });
          currentProgressBase += weight;
        }

        if (phase2Resolutions.length > 0) {
          const weight = (60 / totalWeight) * 100;
          await runPhase(phase2Resolutions, 'Phase 2 (Quality)', 'p2', { base: currentProgressBase, weight });
          currentProgressBase += weight;
        }

        for (const [resKey, resConfig] of activeResolutions) {
          const publicUrl = `/processed/processed-${videoId}-${resKey}.mp4`;
          const actualPath = path.join(PROCESSED_DIR, `processed-${videoId}-${resKey}.mp4`);
          const omniPath = actualPath + '.omni';
          
          if (fs.existsSync(actualPath)) {
            fs.renameSync(actualPath, omniPath);
            obfuscateFileInPlace(omniPath);
          }

          const resConfigAny = resConfig as any;
          const [existingRes]: any = await db.query('SELECT id FROM VideoResolutions WHERE video_id = ? AND resolution = ?', [videoId, resKey]);
          
          if (existingRes && existingRes.length > 0) {
            await db.execute('UPDATE VideoResolutions SET url = ?, status = ? WHERE id = ?', [publicUrl, 'ready', existingRes[0].id]);
          } else {
            await db.execute('INSERT INTO VideoResolutions (video_id, resolution, url, status) VALUES (?, ?, ?, ?)', [videoId, resKey, publicUrl, 'ready']);
          }

          if (resConfigAny.width > highestResWidth) {
            highestResWidth = resConfigAny.width;
            highestResUrl = publicUrl;
          }
        }
      } catch (error: any) {
        throw new Error(`Hybrid Phase Transcoding failed: ${error.message}`);
      }

      // --- TAHAP 63.0: GEMINI 3.6 FLASH AUTO-REPORT GENERATOR PIPELINE ---
      try {
        const [videoMetaRows]: any = await db.query('SELECT title, description, student_name, program_id, meeting_number, session_date FROM Videos WHERE id = ?', [videoId]);
        if (videoMetaRows && videoMetaRows.length > 0) {
          const meta = videoMetaRows[0];
          const studentName = meta.student_name || meta.title || 'Siswa';
          const programId = meta.program_id;
          const sessionDateStr = meta.session_date ? new Date(meta.session_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

          if (programId) {
            console.log(`[GEMINI 63.0] Memulai analisis video dengan model gemini-3.6-flash untuk VideoID: ${videoId}...`);
            
            // 1. Ambil Nama Program
            const [progRows]: any = await db.query('SELECT program_name FROM Programs WHERE id = ?', [programId]);
            const programName = progRows.length > 0 ? progRows[0].program_name : 'Koding Akademi';

            // 2. Hitung/Validasi Nomor Pertemuan Otomatis
            const meetingCalc = await calculateNextMeeting(studentName, programId, meta.session_date);
            const validMeetingNumber = meta.meeting_number || meetingCalc.recommendedMeeting;

            // 3. Baca Berkas Video untuk Gemini Multimodal
            const videoBuffer = fs.readFileSync(activeInputPath);
            const videoBase64 = videoBuffer.toString('base64');

            const promptText = `Kamu adalah Asisten Pengajar & Pembuat Laporan Pembelajaran Otomatis untuk Koding Akademi di OmniHub.
Tugasmu adalah menganalisis berkas video pembelajaran yang diberikan dan mengekstrak materi serta ringkasan pembelajaran hari ini.

Keluaran WAJIB berupa blok kode (markdown code block) dengan format persis seperti ini:

\`\`\`text
*WEEKLY REPORT*

Tanggal: ${sessionDateStr}
Nama: ${studentName}
Pertemuan : ${validMeetingNumber}
Program : ${programName}
Materi: [Tuliskan ringkasan singkat materi teknis yang dipelajari di video]
Pembelajaran hari ini : [Tuliskan 2-4 kalimat detail aktivitas siswa, perangkat/kode yang dibuat, serta kendala/troubleshooting yang berhasil diselesaikan]

Note :Good Job ${studentName}, [Tuliskan kata-kata penyemangat yang relevan dengan pembelajaran siswa]
\`\`\`

Aturan Penulisan:
1. "Materi" berupa ringkasan topik teknis yang dibahas dalam video.
2. "Pembelajaran hari ini" menceritakan aktivitas siswa dalam video secara profesional dan ramah.
3. "Note" wajib diawali dengan "Good Job ${studentName}," diikuti kata penyemangat.
4. TAMPILKAN HANYA BLOK KODE KELUARAN TANPA TEKS PENGANTAR LAIN.`;

            const aiResponse = await aiInstance.models.generateContent({
              model: 'gemini-3.6-flash',
              contents: [
                {
                  inlineData: {
                    mimeType: 'video/mp4',
                    data: videoBase64
                  }
                },
                { text: promptText }
              ]
            });

            const generatedReport = aiResponse.text ? aiResponse.text.trim() : '';

            if (generatedReport) {
              // Update Deskripsi Video dengan Laporan Gemini
              await db.execute('UPDATE Videos SET description = ? WHERE id = ?', [generatedReport, videoId]);

              // Update/Upsert StudentProgress
              const sqlUpsert = `
                INSERT INTO StudentProgress (student_name, program_id, last_meeting_number, last_session_date)
                VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE 
                  last_meeting_number = VALUES(last_meeting_number),
                  last_session_date = VALUES(last_session_date)
              `;
              const dbDate = meta.session_date ? new Date(meta.session_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
              await db.execute(sqlUpsert, [studentName.trim(), programId, validMeetingNumber, dbDate]);
              console.log(`[GEMINI 63.0] Weekly Report berhasil digenerate dan dikaitkan ke VideoID: ${videoId}`);
            }
          }
        }
      } catch (geminiErr: any) {
        console.error(`[GEMINI ERROR 63.0] Gagal membuat laporan otomatis untuk VideoID ${videoId}:`, geminiErr.message || geminiErr);
      }

      // STAGE 77.8: Finalize master video record ONLY after ALL resolutions & Gemini tasks finish
      await db.execute('UPDATE Videos SET status = ?, url = ? WHERE id = ? OR upload_id = ?', ['ready', highestResUrl, videoId, uploadId || '']);
      if (uploadId) {
          encodingProgressMap.set(uploadId, 100);
      }
      await systemLog('INFO', 'FFmpeg', `Successfully completed multi-resolution processing for video ${videoId}`, { encodingTime: Math.round((Date.now() - startTime) / 1000) });
      console.log(`[SYSTEM] FFmpeg Transcoding PIPELINE SUCCESS for VideoID: ${videoId}`);
      
      // Cleanup source file to drop storage use (Stage 1.6)
      if (fs.existsSync(activeInputPath)) {
        try { fs.unlinkSync(activeInputPath); } catch (e) { /* ignore */ }
      }

      // MANDATORY: Emit completion signal to UI ONLY AFTER everything is finished
      io.emit('video-progress-' + videoId, { status: 'ready', progress: 100 });
      
      // GUARANTEED RESOLVE explicitly to release the PQueue lock!
      return resolveQueue();
    } catch (error: any) {
      console.error(`[SYSTEM] PIPELINE ERROR for VideoID: ${videoId}:`, error.message || error);
      await db.execute('UPDATE Videos SET status = ? WHERE id = ?', ['failed', videoId]);
      io.emit('video-progress-' + videoId, { status: 'failed', error: error.message || 'Processing failed' });
      await systemLog('ERROR', 'FFmpeg', `Multi-resolution processing failed for video ${videoId}`, { error: error.message });
      
      // Cleanup source file (Stage 1.6)
      if (fs.existsSync(activeInputPath)) {
        try { fs.unlinkSync(activeInputPath); } catch (e) { /* ignore */ }
      }
      
      // Important to call resolveQueue even on error to unblock PQueue
      return resolveQueue();
    }

  });
}

// ============================================================================
// 6. API ROUTES (AUTH, RBAC, STUDIO, ADMIN CONFIG)
// ============================================================================

app.get('/api/settings/upload-limit', (req, res) => {
  res.json({ maxUploadSizeGB: encodingSettings.maxUploadSizeGB });
});

// --- Auth Routes ---
app.post('/api/auth/reset-request', async (req, res) => {
  try {
    const { fullName, email, complaint } = req.body;
    if (!fullName || !email || !complaint) {
      return res.status(400).json({ error: 'Please provide full name, email, and complaint' });
    }
    const ticketId = 'OMNI-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    await db.execute(
      'INSERT INTO password_reset_requests (ticket_id, full_name, email, complaint) VALUES (?, ?, ?, ?)',
      [ticketId, fullName, email, complaint]
    );
    res.json({ ticketId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create reset request' });
  }
});

app.get('/api/auth/reset-status/:ticketId', async (req, res) => {
  try {
    const [rows]: any = await db.query('SELECT status, new_password FROM password_reset_requests WHERE ticket_id = ?', [req.params.ticketId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Ticket not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

app.post('/api/auth/register', authLimiter, async (req: any, res) => {
  console.log('[API CALL] ' + req.originalUrl);
  try {
    const { email, password, firstName, lastName } = req.body;
    
    const [existing]: any = await db.execute('SELECT id FROM Users WHERE email = ?', [email]);
    if (existing.length > 0) return res.status(400).json({ error: 'Email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const [result]: any = await db.execute(
      'INSERT INTO Users (email, password, firstName, lastName, role) VALUES (?, ?, ?, ?, ?)',
      [email, hashedPassword, firstName, lastName, 'user']
    );
    
    const token = jwt.sign({ id: result.insertId, email, role: 'user' }, JWT_SECRET);
    res.json({ token, user: { id: result.insertId, email, firstName, lastName, role: 'user' } });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', authLimiter, async (req: any, res) => {
  console.log('[API CALL] ' + req.originalUrl);
  try {
    const { email, password } = req.body;
    const [users]: any = await db.execute('SELECT * FROM Users WHERE email = ?', [email]);
    
    if (users.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    
    const user = users[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) return res.status(401).json({ error: 'Invalid credentials' });
    
    // PASTIKAN TOKEN DIBUAT DENGAN VARIABEL JWT_SECRET STATIS
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );
    
    // PASTIKAN TOKEN DIKIRIMKAN SECARA EKSPLISIT DENGAN KEY 'token'
    res.json({ 
      message: 'Login successful', 
      token: token, 
      user: { 
        id: user.id, 
        email: user.email, 
        firstName: user.firstName, 
        lastName: user.lastName, 
        role: user.role 
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', authenticate, async (req: any, res) => {
  try {
    const [users]: any = await db.query('SELECT id, firstName, lastName, email, role FROM Users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(users[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

  // ==========================================
  // --- SISTEM TIKET RESET PASSWORD (SELF-SERVICE) ---
  // ==========================================

  // 1. USER: Request Tiket Reset (Berdasarkan username)
  app.post('/api/auth/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;
      const [users]: any = await db.query('SELECT id FROM Users WHERE email = ?', [email]);
      if (users.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });
      
      const userId = users[0].id;
      // Generate Tiket Unik (contoh: RST-A1B2C3D4)
      const crypto = await import('crypto');
      const ticketCode = 'RST-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      
      // Expired 24 jam dari sekarang
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db.query(
        'INSERT INTO password_resets (user_id, ticket_code, expires_at) VALUES (?, ?, ?)',
        [userId, ticketCode, expiresAt]
      );

      res.json({ message: 'Tiket berhasil dibuat', ticket: ticketCode });
    } catch (error) {
      console.error('[FORGOT PWD ERROR]', error);
      res.status(500).json({ error: 'Gagal membuat tiket' });
    }
  });

  // 2. USER: Cek Status Tiket
  app.get('/api/auth/reset-ticket/:ticket', async (req, res) => {
    try {
      const [tickets]: any = await db.query(
        'SELECT status, expires_at FROM password_resets WHERE ticket_code = ?', 
        [req.params.ticket]
      );
      if (tickets.length === 0) return res.status(404).json({ error: 'Tiket tidak valid' });
      
      const ticket = tickets[0];
      if (new Date(ticket.expires_at) < new Date() && ticket.status === 'pending') {
        await db.query('UPDATE password_resets SET status = "expired" WHERE ticket_code = ?', [req.params.ticket]);
        return res.json({ status: 'expired' });
      }

      res.json({ status: ticket.status });
    } catch (error) {
      res.status(500).json({ error: 'Gagal mengecek tiket' });
    }
  });

  // 3. USER: Eksekusi Ganti Password (Jika tiket Approved)
  app.post('/api/auth/execute-reset', async (req, res) => {
    try {
      const { ticket, newPassword } = req.body;
      const [tickets]: any = await db.query(
        'SELECT user_id, status FROM password_resets WHERE ticket_code = ?', [ticket]
      );
      
      if (tickets.length === 0) return res.status(404).json({ error: 'Tiket tidak valid' });
      if (tickets[0].status !== 'approved') return res.status(403).json({ error: 'Tiket belum disetujui atau sudah hangus' });

      // Hash password baru (Asumsi bcrypt sudah tersedia di scope atas file)
      const bcrypt = await import('bcrypt');
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Update password user & hanguskan tiket
      await db.query('UPDATE Users SET password = ? WHERE id = ?', [hashedPassword, tickets[0].user_id]);
      await db.query('UPDATE password_resets SET status = "used" WHERE ticket_code = ?', [ticket]);

      res.json({ message: 'Password berhasil diubah. Silakan login.' });
    } catch (error) {
      console.error('[EXECUTE RESET ERROR]', error);
      res.status(500).json({ error: 'Gagal mereset password' });
    }
  });

  // 4. ADMIN: Ambil Semua Tiket
  app.get('/api/admin/password-tickets', async (req, res) => {
    try {
      const [tickets]: any = await db.query(`
        SELECT p.*, u.email, u.firstName, u.lastName 
        FROM password_resets p 
        JOIN Users u ON p.user_id = u.id 
        ORDER BY p.created_at DESC
      `);
      res.json(tickets);
    } catch (error) {
      res.status(500).json({ error: 'Gagal mengambil data tiket' });
    }
  });

  // 5. ADMIN: Setujui (Approve) Tiket
  app.put('/api/admin/password-tickets/:id/approve', async (req, res) => {
    try {
      await db.query('UPDATE password_resets SET status = "approved" WHERE id = ?', [req.params.id]);
      res.json({ message: 'Tiket disetujui' });
    } catch (error) {
      res.status(500).json({ error: 'Gagal menyetujui tiket' });
    }
  });

  // ==========================================
  // --- TAHAP 3: API PENGATURAN PROFIL & AVATAR ---
  // ==========================================

  // 1. GET: Ambil Data Profil User Saat Ini
  app.get('/api/user/profile', authenticate, async (req: any, res) => {
    try {
      const [users]: any = await db.query(
        'SELECT id, email, firstName, lastName, avatar_url FROM users WHERE id = ?', 
        [req.user.id]
      );
      if (users.length === 0) return res.status(404).json({ error: 'User tidak ditemukan' });
      res.json(users[0]);
    } catch (error) {
      console.error('[GET PROFILE ERROR]', error);
      res.status(500).json({ error: 'Gagal mengambil data profil' });
    }
  });

  // 2. PUT: Update Data Teks Profil & Password
  app.put('/api/user/profile', authenticate, async (req: any, res) => {
    try {
      const { firstName, lastName, email, currentPassword, newPassword } = req.body;
      const userId = req.user.id;

      // Jika user ingin ganti password, wajib validasi password lama
      if (newPassword && currentPassword) {
        const [users]: any = await db.query('SELECT password FROM users WHERE id = ?', [userId]);
        const bcrypt = await import('bcrypt');
        const isMatch = await bcrypt.compare(currentPassword, users[0].password);
        
        if (!isMatch) return res.status(400).json({ error: 'Password saat ini salah!' });
        
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.query(
          'UPDATE users SET firstName = ?, lastName = ?, email = ?, password = ? WHERE id = ?', 
          [firstName, lastName, email, hashedPassword, userId]
        );
      } else {
        // Update profil biasa tanpa ganti password
        await db.query(
          'UPDATE users SET firstName = ?, lastName = ?, email = ? WHERE id = ?', 
          [firstName, lastName, email, userId]
        );
      }
      res.json({ message: 'Profil berhasil diperbarui' });
    } catch (error) {
      console.error('[UPDATE PROFILE ERROR]', error);
      res.status(500).json({ error: 'Gagal memperbarui profil' });
    }
  });

  // 3. POST: Upload Foto Profil (Avatar)
  app.post('/api/user/avatar', authenticate, (req: any, res: any, next: any) => {
    uploadAvatar.single('avatar')(req, res, next);
  }, async (req: any, res: any) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Tidak ada file gambar yang diunggah' });
      
      const avatarUrl = '/uploads/avatars/' + req.file.filename;
      await db.query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, req.user.id]);
      
      res.json({ message: 'Foto profil berhasil diperbarui', avatar_url: avatarUrl });
    } catch (error) {
      console.error('[UPLOAD AVATAR ERROR]', error);
      res.status(500).json({ error: 'Gagal mengunggah foto profil' });
    }
  });

  // ==========================================
  // --- STAGE 1.26: HISTORY & WATCH LATER ---
  // ==========================================

  // History API
  app.get('/api/user/history', authenticate, async (req: any, res) => {
    try {
      const [videos]: any = await db.query(`
        SELECT v.*, u.firstName, u.lastName, wh.watched_at
        FROM WatchHistory wh
        JOIN Videos v ON wh.video_id = v.id
        JOIN Users u ON v.user_id = u.id
        WHERE wh.user_id = ? AND v.status = 'ready'
        ORDER BY wh.watched_at DESC
      `, [req.user.id]);
      res.json(videos);
    } catch (error) {
      console.error('[HISTORY GET ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch watch history' });
    }
  });

  app.post('/api/user/history', authenticate, async (req: any, res) => {
    try {
      const { videoId } = req.body;
      if (!videoId) return res.status(400).json({ error: 'videoId is required' });
      
      await db.execute(`
        INSERT INTO WatchHistory (user_id, video_id) 
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE watched_at = CURRENT_TIMESTAMP
      `, [req.user.id, videoId]);
      res.json({ success: true });
    } catch (error) {
      console.error('[HISTORY POST ERROR]', error);
      res.status(500).json({ error: 'Failed to update watch history' });
    }
  });

  // Watch Later API
  app.get('/api/user/watch-later', authenticate, async (req: any, res) => {
    try {
      const [videos]: any = await db.query(`
        SELECT v.*, u.firstName, u.lastName, wl.added_at
        FROM WatchLater wl
        JOIN Videos v ON wl.video_id = v.id
        JOIN Users u ON v.user_id = u.id
        WHERE wl.user_id = ? AND v.status = 'ready'
        ORDER BY wl.added_at DESC
      `, [req.user.id]);
      res.json(videos);
    } catch (error) {
      console.error('[WATCH LATER GET ERROR]', error);
      res.status(500).json({ error: 'Failed to fetch watch later list' });
    }
  });

  app.post('/api/user/watch-later', authenticate, async (req: any, res) => {
    try {
      const { videoId } = req.body;
      if (!videoId) return res.status(400).json({ error: 'videoId is required' });

      await db.execute(`
        INSERT INTO WatchLater (user_id, video_id) 
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE added_at = CURRENT_TIMESTAMP
      `, [req.user.id, videoId]);
      res.json({ success: true, message: 'Added to Watch Later' });
    } catch (error) {
      console.error('[WATCH LATER POST ERROR]', error);
      res.status(500).json({ error: 'Failed to add to watch later' });
    }
  });

  app.delete('/api/user/watch-later/:videoId', authenticate, async (req: any, res) => {
    try {
      await db.execute('DELETE FROM WatchLater WHERE user_id = ? AND video_id = ?', [req.user.id, req.params.videoId]);
      res.json({ success: true, message: 'Removed from Watch Later' });
    } catch (error) {
      console.error('[WATCH LATER DELETE ERROR]', error);
      res.status(500).json({ error: 'Failed to remove from watch later' });
    }
  });

// --- Studio & Video Management Routes ---
app.get('/api/analytics/creator-overview', authenticate, async (req: any, res) => {
  try {
    const creatorId = req.user.id;
    const [summary]: any = await db.query(`
      SELECT 
        COUNT(DISTINCT v.id) as totalVideos,
        SUM(COALESCE(v.views, 0)) as totalViews,
        SUM(COALESCE(va.watch_duration, 0)) as totalWatchTime
      FROM Videos v
      LEFT JOIN (
        SELECT video_id, SUM(duration) as watch_duration 
        FROM video_analytics GROUP BY video_id
      ) va ON v.id = va.video_id
      WHERE v.user_id = ?`, [creatorId]);
    
    // Format strictly to number
    res.json({
      totalVideos: Number(summary[0]?.totalVideos) || 0,
      totalViews: Number(summary[0]?.totalViews) || 0,
      totalWatchTime: Number(summary[0]?.totalWatchTime) || 0
    });
  } catch (err) {
    console.error('Fetch creator overview error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

app.get('/api/studio/videos', authenticate, async (req: any, res) => {
  console.log('[API CALL] ' + req.originalUrl);
  try {
    const [videos]: any = await db.execute(`
      SELECT v.*, 
        (SELECT COUNT(id) FROM Views WHERE video_id = v.id) as views,
        (SELECT COALESCE(SUM(duration), 0) FROM video_analytics WHERE video_id = v.id) as watch_time 
      FROM Videos v 
      WHERE v.user_id = ? 
      ORDER BY v.created_at DESC
    `, [req.user.id]);
    
    // Cast watch_time explicitly to guarantee number processing
    const processedVideos = videos.map((v: any) => ({
      ...v,
      watch_time: Number(v.watch_time) || 0,
      views: Number(v.views) || 0
    }));
    
    res.json(processedVideos);
  } catch (error) {
    console.error('Fetch studio videos error:', error);
    res.status(500).json({ error: 'Failed to fetch studio videos' });
  }
});

const activeMerges = new Set<string>();

app.post('/api/videos/draft', authenticate, async (req: any, res) => {
  console.log('[API CALL] ' + req.originalUrl);
  try {
    const { title, description, allowDownload, student_name, program_id, meeting_number, session_date } = req.body;
    
    // Helper sanitasi integer aman dari string 'undefined' / 'null' / NaN
    const parseSafeInt = (val: any): number | null => {
      if (!val || val === 'undefined' || val === 'null' || isNaN(Number(val))) return null;
      const parsed = parseInt(val, 10);
      return isNaN(parsed) ? null : parsed;
    };

    let safeProgramId = parseSafeInt(program_id);
    const safeMeetingNumber = parseSafeInt(meeting_number);
    const safeSessionDate = (session_date && session_date !== 'undefined' && session_date !== 'null') ? session_date : null;

    // Verifikasi keberadaan program_id di tabel Programs sebelum insert untuk cegah Foreign Key error
    if (safeProgramId !== null) {
      const [progCheck]: any = await db.query('SELECT id FROM Programs WHERE id = ?', [safeProgramId]);
      if (!progCheck || progCheck.length === 0) {
        safeProgramId = null; // Reset ke NULL jika ID program tidak ada di DB
      }
    }

    // Layer 3: Database Insertion Idempotency
    const [existing]: any = await db.query(
      `SELECT id FROM Videos WHERE user_id = ? AND title = ? AND created_at >= NOW() - INTERVAL 1 MINUTE LIMIT 1`,
      [req.user.id, title || 'Untitled']
    );
    
    if (existing && existing.length > 0) {
      return res.json({ id: existing[0].id, uploadId: Date.now().toString() });
    }

    const uploadId = req.body.uploadId || Date.now().toString();
    const [result]: any = await db.execute(
      'INSERT INTO Videos (user_id, title, description, status, allow_download, student_name, program_id, meeting_number, session_date, upload_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        req.user.id, 
        title || 'Untitled', 
        description || '', 
        'pending', 
        allowDownload ? 1 : 0,
        student_name?.trim() || null,
        safeProgramId,
        safeMeetingNumber,
        safeSessionDate,
        uploadId
      ]
    );
    res.json({ id: result.insertId, uploadId });
  } catch (error) {
    console.error('Create draft error:', error);
    res.status(500).json({ error: 'Failed to create draft' });
  }
});

const upload = multer({
  dest: UPLOAD_DIR, // TETAP gunakan variabel destinasi lama yang sudah terdefinisi di file ini
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // Batas aman maksimal 2GB
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = ['.mp4', '.mov', '.ts', '.mpeg', '.m4v'];
    
    // Daftar MIME yang sah (Termasuk penangkal jebakan TypeScript .ts)
    const allowedMimes = [
      'video/mp4',
      'video/quicktime',         // .mov (Apple)
      'video/mp2t',              // .ts (Transport Stream standar)
      'video/mpeg',              // .mpeg
      'application/typescript',  // <-- TRAP FIX: Node.js sering salah mendeteksi video .ts sebagai TypeScript
      'application/octet-stream' // <-- TRAP FIX: Beberapa browser mengirim video mpeg/ts sebagai binary mentah
    ];

    if (allowedExtensions.includes(ext) || allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format ditolak! OmniHub hanya menerima file .mp4, .mov, .ts, dan .mpeg'));
    }
  }
});

// --- KONFIGURASI PENYIMPANAN FOTO PROFIL (AVATAR) ---
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads/avatars');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const uploadAvatar = multer({ storage: avatarStorage });

// --- PROCESS TRACKER & ABORT ENGINE (TAHAP 53) ---
const encodingProgressMap = new Map<string, number>();
const activeFFmpegProcesses = new Map<string, any>();

// Endpoint Hentikan Paksa Pemrosesan (Abort API)
app.post('/api/video/abort-processing', async (req, res) => {
  const { uploadId } = req.body;

  if (!uploadId) {
    return res.status(400).json({ error: 'uploadId wajib diberikan' });
  }

  try {
    // 1. Matikan Child Process FFmpeg jika sedang berjalan
    if (activeFFmpegProcesses.has(uploadId)) {
      const proc = activeFFmpegProcesses.get(uploadId);
      try {
        const pid = proc.pid || proc.ffmpegProc?.pid;
        if (pid) {
          // STAGE 1.30: OS-Aware Process Termination (Prevent Zombie FFmpeg)
          if (os.platform() === 'win32') {
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
          } else {
            // Send SIGKILL to the entire process group (Linux/Mac)
            process.kill(-pid, 'SIGKILL');
          }
          console.log(`[PROCESS KILLER] FFmpeg Process (PID: ${pid}) untuk ID ${uploadId} BERHASIL DIHENTIKAN PAKSA.`);
        }

        // Gracefully kill fluent-ffmpeg or ChildProcess instance if proc.kill exists
        if (typeof proc.kill === 'function') {
          proc.kill('SIGKILL');
        }
        console.log(`[PROCESS KILLER] FFmpeg Process untuk ID ${uploadId} BERHASIL DIHENTIKAN PAKSA (OS: ${os.platform()}).`);
      } catch (e) {
        // Fallback if strict group kill fails
        try {
          if (typeof proc?.kill === 'function') {
            proc.kill('SIGKILL');
          }
        } catch (fallbackErr) {}
        console.error(`[PROCESS KILLER ERROR] Peringatan saat mematikan FFmpeg:`, e);
      }
      activeFFmpegProcesses.delete(uploadId);
    }

    // 2. Bersihkan Progress Map & Hapus Record MySQL jika ada
    encodingProgressMap.delete(uploadId);
    await db.query('DELETE FROM Videos WHERE upload_id = ? OR title LIKE ?', [uploadId, `%${uploadId}%`]);

    // STAGE 1.24: Immediate Chunk Purge on Abort
    try {
      const chunkFiles = await fs.promises.readdir(CHUNK_DIR);
      for (const file of chunkFiles) {
        if (file.startsWith(uploadId + '_')) {
          await fs.promises.unlink(path.join(CHUNK_DIR, file)).catch(() => {});
        }
      }
      console.log(`[PROCESS KILLER] Semua chunk tertinggal untuk ID ${uploadId} telah disapu bersih.`);
    } catch (e) {
      console.error(`[PROCESS KILLER ERROR] Gagal menyapu chunk:`, e);
    }

    res.json({ success: true, message: `Proses ${uploadId} berhasil dihentikan paksa dan dibersihkan.` });
  } catch (err) {
    console.error('[ABORT ERROR]:', err);
    res.status(500).json({ error: 'Gagal menghentikan proses.' });
  }
});

// --- SAFE ENCODING STATUS ENDPOINT (TAHAP 54.2) ---
// --- STRICT ENCODING STATUS API (TAHAP 54.9) ---
app.get('/api/video/encoding-status/:uploadId', async (req, res) => {
  const { uploadId } = req.params;
  const progress = encodingProgressMap.get(uploadId) || 0;

  try {
    const [rows]: any = await db.query('SELECT status FROM videos WHERE upload_id = ? OR title LIKE ?', [uploadId, `%${uploadId}%`]);
    const dbStatus = rows && rows.length > 0 ? rows[0].status : 'processing';

    // Jika progress belum 100%, paksa dbStatus tetap 'processing' di respons API
    const finalStatus = progress < 100 ? 'processing' : dbStatus;

    res.json({ 
      encodingProgress: progress,
      status: finalStatus
    });
  } catch (err) {
    res.json({ encodingProgress: progress, status: 'processing' });
  }
});

app.post('/api/upload/chunk', authenticate, upload.single('chunk'), async (req: any, res) => {
  // Dalam endpoint upload chunk, catat byte yang diterima secara instan (Tahap 55.3)
  if (req.file && req.file.size) {
    totalBytesRx += req.file.size;
    rxBytesInCurrentWindow += req.file.size;
  }

  // Pertahankan jalur pipa jaringan tetap terbuka (Tahap 48 Optimization)
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Keep-Alive', 'timeout=30, max=1000');

  console.log('[API CALL] ' + req.originalUrl);
  try {
    const { chunkIndex, totalChunks, fileName, uploadId, videoId } = req.body;
    const lockKey = `${req.user.id}_${fileName}_${videoId}`;

    // Establish lock check before merge validation logic
    if (activeMerges.has(lockKey)) {
      console.log(`[IDEMPOTENCY] Caught duplicate merge trigger for ${fileName}`);
      return res.json({ status: 'waiting', message: 'Duplicate prevented' });
    }
    
    const chunkPath = path.join(CHUNK_DIR, `${uploadId}_${chunkIndex}`);
    fs.renameSync(req.file.path, chunkPath);

    let allUploaded = true;
    for (let i = 0; i < parseInt(totalChunks); i++) {
      if (!fs.existsSync(path.join(CHUNK_DIR, `${uploadId}_${i}`))) {
        allUploaded = false;
        break;
      }
    }

    if (allUploaded) {
      // Move idempotency lock check to the VERY TOP of the if (allUploaded) block
      if (activeMerges.has(lockKey)) {
        console.log(`[IDEMPOTENCY] Caught duplicate merge trigger for ${fileName}`);
        return res.json({ status: 'waiting', message: 'Duplicate prevented' });
      }
      activeMerges.add(lockKey);

      // Auto-clear lock after 10 mins as a failsafe
      setTimeout(() => activeMerges.delete(lockKey), 600000);

      const finalPath = path.join(UPLOAD_DIR, `${uploadId}_${fileName}`);
      const writeStream = fs.createWriteStream(finalPath);
      
      const mergeNextChunk = (index: number) => {
        if (index >= parseInt(totalChunks)) {
          writeStream.end();
          return;
        }
        
        const chunkFile = path.join(CHUNK_DIR, `${uploadId}_${index}`);
        const stat = fs.statSync(chunkFile);
        if (!stat.isFile()) {
          return; 
        }
        const readStream = fs.createReadStream(chunkFile);
        
        readStream.pipe(writeStream, { end: false });
        
        readStream.on('end', () => {
          try { fs.unlinkSync(chunkFile); } catch (e) { /* ignore */ }
          mergeNextChunk(index + 1);
        });
        
        readStream.on('error', (err) => {
          console.error(`[STREAM] Error reading chunk ${index}:`, err);
          writeStream.end();
        });
      };
      
      mergeNextChunk(0);
      
      writeStream.on('finish', async () => {
        // Place video into the Backend Decoding Queue visually and structurally
        // Apply Binar Obfuscation here
        const omniPath = finalPath + '.omni';
        fs.renameSync(finalPath, omniPath);
        obfuscateFileInPlace(omniPath);
        
        await db.execute('UPDATE Videos SET url = ?, status = ? WHERE id = ?', [`/uploads/${uploadId}_${fileName}.omni`, 'pending', videoId]);
        
        io.emit('video-progress-' + videoId, { status: 'pending' });
        
        // Memicu Smart Queue NVENC
        processNextInFFmpegQueue();
        
        // INSTANTLY return response so React releases the network slot without hanging
        return res.json({ status: 'pending' });
      });
      
    } else {
      res.json({ status: 'uploading' });
    }
  } catch (error) {
    console.error('Chunk upload error:', error);
    res.status(500).json({ error: 'Chunk upload failed' });
  }
});

app.post('/api/videos/upload', authenticate, upload.single('video'), async (req: any, res) => {
  console.log('[API CALL] ' + req.originalUrl);
  try {
    const omniPath = req.file.path + '.omni';
    fs.renameSync(req.file.path, omniPath);
    obfuscateFileInPlace(omniPath);

    // --- BENTENG DECOUPLING METADATA (TAHAP 38) ---
    // Memastikan judul tidak pernah mengutip fallback yang salah
    let sanitizedTitle = 'Untitled_Video';

    if (req.file) {
        sanitizedTitle = req.body && req.body.title ? req.body.title.trim() : req.file.originalname;
    } else if (req.body && req.body.title) {
        sanitizedTitle = req.body.title.trim();
    }

    // Jika sistem menerima request berupa array/batch, pastikan proses pembacaan title di dalam loop 
    // mengambil nilai dari req.files[i].originalname sebagai baseline mutlak.

    // --- OTOMATISASI AUTO-ENCODE REKAMAN KAMERA (TAHAP 41) ---
    try {
      const [result]: any = await db.execute(
        'INSERT INTO Videos (user_id, title, description, visibility, category_id, allow_download, url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
           req.user.id, 
           sanitizedTitle, 
           req.body.description || '', 
           req.body.visibility || 'public', 
           req.body.categoryId ? parseInt(req.body.categoryId) : 1, 
           req.body.allowDownload === 'true' || req.body.allowDownload === true ? 1 : 0,
           `/uploads/${req.file.filename}.omni`, 
           'pending'
        ]
      );
      
      const newVideoId = result.insertId;
      console.log(`[SYSTEM] Video baru terdaftar. ID: ${newVideoId}. Memasukkan ke antrean Smart Queue NVENC...`);
      io.emit('video-progress-' + newVideoId, { status: 'pending' });
      
      // Pemicu Smart Queue (Concurrency = 1, NVENC, Gaming Mode Check)
      processNextInFFmpegQueue();
      
      // Kirim respons ke frontend bahwa video telah terdaftar dan berada dalam antrean
      return res.json({ 
          success: true, 
          videoId: newVideoId, 
          message: 'Video berhasil disimpan di drive dan antrean encoding dimulai.' 
      });
    } catch (err) {
      console.error('[DATABASE ERROR] Gagal mendaftarkan video baru:', err);
      return res.status(500).json({ error: true, message: 'Gagal menyimpan metadata video' });
    }
    // ---------------------------------------------------------
  } catch (error) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

const uploadThumbnail = multer({ dest: THUMBNAIL_DIR });

app.patch('/api/videos/:id/thumbnail', authenticate, uploadThumbnail.single('thumbnail'), async (req: any, res) => {
  console.log('[API CALL] ' + req.originalUrl);
  try {
    const videoId = req.params.id;
    if (!req.file) {
      return res.status(400).json({ error: 'No thumbnail file uploaded' });
    }

    const [videos]: any = await db.query('SELECT * FROM Videos WHERE id = ?', [videoId]);
    if (!videos || videos.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    if (req.user.role !== 'admin' && videos[0].user_id !== req.user.id) {
       return res.status(403).json({ error: 'Unauthorized' });
    }

    const timestamp = Date.now();
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '');
    const newFileName = `custom-thumb-${timestamp}-${safeName}`;
    const newPath = path.join(THUMBNAIL_DIR, newFileName);
    
    fs.renameSync(req.file.path, newPath);
    
    const omniPath = newPath + '.omni';
    fs.renameSync(newPath, omniPath);
    obfuscateFileInPlace(omniPath);
    
    const publicUrl = `/thumbnails/${newFileName}`;
    await db.execute('UPDATE Videos SET thumbnail_url = ? WHERE id = ?', [publicUrl, videoId]);
    
    res.json({ success: true, url: publicUrl });
  } catch (error) {
    console.error('Thumbnail upload error:', error);
    res.status(500).json({ error: 'Failed to upload thumbnail' });
  }
});

app.patch('/api/videos/:id/progress', authenticate, async (req: any, res) => {
  res.json({ success: true });
});

app.patch('/api/videos/:id', authenticate, async (req: any, res) => {
  console.log('[API CALL] ' + req.originalUrl);
  try {
    const { title, description } = req.body;
    if (req.user.role === 'admin') {
      await db.execute('UPDATE Videos SET title = ?, description = ? WHERE id = ?', [title, description, req.params.id]);
    } else {
      await db.execute('UPDATE Videos SET title = ?, description = ? WHERE id = ? AND user_id = ?', [title, description, req.params.id, req.user.id]);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update video' });
  }
});

// --- BULK VIDEO DELETION ENDPOINT (TAHAP 51) ---
app.post('/api/videos/bulk-delete', authenticate, async (req: any, res) => {
  const { videoIds } = req.body;

  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    return res.status(400).json({ error: 'Tidak ada ID video yang diberikan.' });
  }

  try {
    // 1. Ambil path file video dan thumbnail sebelum data dihapus dari DB
    const [videos]: any = await db.query(
      'SELECT id, url, thumbnail_url FROM Videos WHERE id IN (?) AND user_id = ?',
      [videoIds, req.user.id]
    );

    // 2. Hapus berkas fisik di folder storage/public (Asynchronous I/O)
    for (const vid of videos) {
      if (vid.url) {
        const videoPath = path.join(process.cwd(), 'public', vid.url.replace(/^\//, ''));
        if (fs.existsSync(videoPath)) {
          await fs.promises.rm(videoPath, { recursive: true, force: true }).catch(() => {});
        }
      }
      if (vid.thumbnail_url) {
        const thumbPath = path.join(process.cwd(), 'public', vid.thumbnail_url.replace(/^\//, ''));
        if (fs.existsSync(thumbPath)) {
          await fs.promises.unlink(thumbPath).catch(() => {});
        }
      }
    }

    // 3. Hapus baris dari MySQL (cascade handles related tables ideally)
    await db.query('DELETE FROM Videos WHERE id IN (?) AND user_id = ?', [videoIds, req.user.id]);

    res.json({ 
      success: true, 
      message: `${videoIds.length} video berhasil dihapus permanen.`,
      deletedCount: videoIds.length 
    });
  } catch (err) {
    console.error('[BULK DELETE ERROR]:', err);
    res.status(500).json({ error: 'Gagal menghapus kumpulan video dari server.' });
  }
});

  app.delete('/api/videos/:id', async (req, res) => {
    try {
      const videoId = req.params.id;
      
      // 1. Ambil info video sebelum dihapus
      const [videoRows]: any = await db.query('SELECT * FROM Videos WHERE id = ?', [videoId]);
      if (videoRows.length === 0) return res.status(404).json({ error: 'Video not found' });
      const video = videoRows[0];

      // 2. Siapkan direktori tanggal YYYY/MM/DD
      const date = new Date();
      const year = date.getFullYear().toString();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const archivePath = path.join(process.cwd(), 'deleted', year, month, day, videoId.toString());
      
      if (!fs.existsSync(archivePath)) {
        fs.mkdirSync(archivePath, { recursive: true });
      }

      const processedDir = path.join(process.cwd(), 'processed');
      const filesDir = fs.existsSync(processedDir) ? fs.readdirSync(processedDir) : [];
      
      // 3. Cari resolusi terkecil
      const videoFiles = filesDir.filter(f => f.startsWith(`processed-${videoId}-`) && f.endsWith('.mp4.omni'));
      let smallestRes = Infinity;
      let smallestFile = '';

      videoFiles.forEach(file => {
        const resMatch = file.match(/-(\d+)\.mp4\.omni$/);
        if (resMatch) {
          const res = parseInt(resMatch[1]);
          if (res < smallestRes) {
            smallestRes = res;
            smallestFile = file;
          }
        }
      });

      // 4. Pindah file terkecil, hapus sisanya
      videoFiles.forEach(file => {
        const oldPath = path.join(processedDir, file);
        if (file === smallestFile) {
          fs.renameSync(oldPath, path.join(archivePath, file)); // Pindah file terkecil
        } else {
          fs.unlinkSync(oldPath); // Hapus resolusi besar
        }
      });

      // 5. Pindah folder thumbnail
      const thumbDir = path.join(processedDir, videoId.toString());
      if (fs.existsSync(thumbDir)) {
        fs.renameSync(thumbDir, path.join(archivePath, 'thumbnails'));
      }

      // 6. Masukkan ke tabel arsip (videos_deleted) + 14 Hari Expiry
      const expiresAt = new Date(date.getTime() + 14 * 24 * 60 * 60 * 1000);
      await db.query(`
        INSERT INTO videos_deleted (original_video_id, uploader_id, title, archive_path, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `, [video.id, video.uploader_id || video.user_id, video.title, archivePath, expiresAt]);

      // 7. Hapus dari tabel utama (Cascade akan menghapus komen/like otomatis)
      await db.query('DELETE FROM Videos WHERE id = ?', [videoId]);

      res.json({ message: 'Video berhasil diarsipkan secara otomatis' });
    } catch (error) {
      console.error('[DELETE ARCHIVE ERROR]:', error);
      res.status(500).json({ error: 'Gagal menghapus dan mengarsipkan video' });
    }
  });

  // --- RUTE KHUSUS ADMIN: DAFTAR ARSIP VIDEO TERHAPUS ---
  app.get('/api/admin/archives', async (req, res) => {
    try {
      const [archives]: any = await db.query('SELECT * FROM videos_deleted ORDER BY deleted_at DESC');
      res.json(archives);
    } catch (error) {
      console.error('[ADMIN ARCHIVE API ERROR]:', error);
      res.status(500).json({ error: 'Gagal mengambil data arsip dari database' });
    }
  });

// --- Public Video Routes ---
// --- YOUTUBE-STYLE SEARCH SUGGESTIONS API (TAHAP 55) ---
app.get('/api/search/suggestions', async (req, res) => {
  const query = (req.query.q as string || '').trim();

  if (!query || query.length < 1) {
    return res.json([]);
  }

  try {
    // Cari judul video yang cocok, urutkan berdasarkan views/kepopuleran
    const [rows]: any = await db.query(
      `SELECT DISTINCT title FROM Videos 
       WHERE (title LIKE ? OR description LIKE ?) AND status = 'ready' 
       ORDER BY views DESC LIMIT 8`,
      [`%${query}%`, `%${query}%`]
    );

    const suggestions = rows.map((r: any) => r.title);
    res.json(suggestions);
  } catch (err) {
    console.error("Suggestions API error:", err);
    res.status(500).json({ error: 'Gagal mengambil saran pencarian' });
  }
});

// Endpoint Hasil Pencarian Utama
app.get('/api/search', async (req, res) => {
  const query = (req.query.q as string || '').trim();

  try {
    const [rows]: any = await db.query(
      `SELECT v.*, u.firstName, u.lastName FROM Videos v JOIN Users u ON v.user_id = u.id
       WHERE v.status IN ('ready', 'live') AND (v.title LIKE ? OR v.description LIKE ?) 
       ORDER BY (v.status = 'live') DESC, v.created_at DESC`,
      [`%${query}%`, `%${query}%`]
    );
    res.json(rows);
  } catch (err) {
    console.error("Search API error:", err);
    res.status(500).json({ error: 'Gagal mencari video' });
  }
});

app.get('/api/videos', async (req, res) => {
  console.log('[API CALL] ' + req.originalUrl);
  try {
    const { q } = req.query;
    let query = "SELECT v.*, u.firstName, u.lastName FROM Videos v JOIN Users u ON v.user_id = u.id WHERE v.status IN ('ready', 'live')";
    const params: any[] = [];
    if (q) {
      query += ' AND v.title LIKE ?';
      params.push(`%${q}%`);
    }
    query += " ORDER BY (v.status = 'live') DESC, v.created_at DESC";
    const [videos]: any = await db.execute(query, params);
    res.json(videos);
  } catch (error) {
    console.error('Fetch videos error:', error);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

app.post('/api/videos/:id/view', async (req, res) => {
  try {
    const videoId = req.params.id;
    await db.execute('UPDATE Videos SET views = views + 1 WHERE id = ?', [videoId]);
    
    // Also track in video_stats if needed, but video_stats might just accumulate
    await db.execute(
      "INSERT INTO video_stats (video_id, views) VALUES (?, 1) ON DUPLICATE KEY UPDATE views = views + 1",
      [videoId]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Update view error:', error);
    res.status(500).json({ error: 'Failed to update view' });
  }
});

app.post('/api/videos/:id/heartbeat', async (req, res) => {
  try {
    const videoId = req.params.id;
    const increment = 10; // 10 seconds per heartbeat
    await db.execute(
      "INSERT INTO video_stats (video_id, watch_time_seconds) VALUES (?, ?) ON DUPLICATE KEY UPDATE watch_time_seconds = watch_time_seconds + ?",
      [videoId, increment, increment]
    );
    res.sendStatus(200);
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ error: 'Failed to record heartbeat' });
  }
});

app.get('/api/creator/analytics', authenticate, async (req: any, res) => {
  try {
    const creatorId = req.user.id;
    
    // Global stats
    const [globalStats]: any = await db.query(`
      SELECT 
        COUNT(v.id) as totalVideos,
        SUM(COALESCE(vs.views, 0)) as totalViews,
        SUM(COALESCE(vs.watch_time_seconds, 0)) / 60 as totalWatchTime,
        (SELECT COUNT(*) FROM Likes l JOIN Videos v2 ON l.video_id = v2.id WHERE v2.user_id = ? AND type = 'like') as totalLikes,
        (SELECT COUNT(*) FROM Comments c JOIN Videos v3 ON c.video_id = v3.id WHERE v3.user_id = ?) as totalComments
      FROM Videos v
      LEFT JOIN video_stats vs ON v.id = vs.video_id
      WHERE v.user_id = ?
    `, [creatorId, creatorId, creatorId]);

    // Per-video stats
    const [videoStats]: any = await db.query(`
      SELECT 
        v.id, v.title, 
        COALESCE(vs.views, 0) as views,
        (SELECT COUNT(*) FROM Likes WHERE video_id = v.id AND type = 'like') as likes,
        (SELECT COUNT(*) FROM Comments WHERE video_id = v.id) as comments,
        COALESCE(vs.watch_time_seconds, 0) / 60 as watch_time
      FROM Videos v
      LEFT JOIN video_stats vs ON v.id = vs.video_id
      WHERE v.user_id = ?
      ORDER BY v.created_at DESC
    `, [creatorId]);

    res.json({
      global: {
        totalVideos: Number(globalStats[0]?.totalVideos) || 0,
        totalViews: Number(globalStats[0]?.totalViews) || 0,
        totalWatchTime: Number(globalStats[0]?.totalWatchTime) || 0,
        totalLikes: Number(globalStats[0]?.totalLikes) || 0,
        totalComments: Number(globalStats[0]?.totalComments) || 0
      },
      videos: videoStats
    });
  } catch (error) {
    console.error('Fetch creator analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch creator analytics' });
  }
});

app.get('/api/videos/:id', async (req, res) => {
  console.log('[API CALL] ' + req.originalUrl);
  try {
    const [videos]: any = await db.execute('SELECT v.*, u.firstName, u.lastName FROM Videos v JOIN Users u ON v.user_id = u.id WHERE v.id = ?', [req.params.id]);
    if (videos.length === 0) return res.status(404).json({ error: 'Video not found' });
    res.json(videos[0]);
  } catch (error) {
    console.error('Fetch video error:', error);
    res.status(500).json({ error: 'Failed to fetch video' });
  }
});

app.get('/api/videos/:id/comments', async (req, res) => {
  try {
    const [comments]: any = await db.execute('SELECT c.*, u.firstName, u.lastName FROM Comments c JOIN Users u ON c.user_id = u.id WHERE c.video_id = ? ORDER BY c.created_at DESC', [req.params.id]);
    res.json(comments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

app.post('/api/videos/:id/comments', authenticate, async (req: any, res) => {
  try {
    const { content } = req.body;
    await db.execute('INSERT INTO Comments (video_id, user_id, content) VALUES (?, ?, ?)', [req.params.id, req.user.id, content]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// --- STAGE 1.28: LIKED VIDEOS ENDPOINT ---
app.get('/api/user/liked-videos', authenticate, async (req: any, res) => {
  try {
    const [videos]: any = await db.query(`
      SELECT v.*, u.firstName, u.lastName, l.created_at as liked_at
      FROM Likes l
      JOIN Videos v ON l.video_id = v.id
      JOIN Users u ON v.user_id = u.id
      WHERE l.user_id = ? AND l.type = 'like' AND v.status = 'ready'
      ORDER BY l.created_at DESC
    `, [req.user.id]);
    res.json(videos);
  } catch (error) {
    console.error('[LIKED VIDEOS GET ERROR]', error);
    res.status(500).json({ error: 'Failed to fetch liked videos' });
  }
});

app.get('/api/videos/:id/likes', async (req, res) => {
  try {
    const [likes]: any = await db.execute("SELECT COUNT(*) as count FROM Likes WHERE video_id = ? AND type = 'like'", [req.params.id]);
    const [dislikes]: any = await db.execute("SELECT COUNT(*) as count FROM Likes WHERE video_id = ? AND type = 'dislike'", [req.params.id]);
    res.json({ likes: likes[0].count, dislikes: dislikes[0].count, userAction: null });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch likes' });
  }
});

app.post('/api/videos/:id/like', authenticate, async (req: any, res) => {
  try {
    const { type } = req.body;
    const videoId = req.params.id;
    const userId = req.user.id;

    const [existing]: any = await db.execute('SELECT * FROM Likes WHERE video_id = ? AND user_id = ?', [videoId, userId]);
    
    if (existing.length > 0) {
      if (existing[0].type === type) {
        await db.execute('DELETE FROM Likes WHERE id = ?', [existing[0].id]);
      } else {
        await db.execute('UPDATE Likes SET type = ? WHERE id = ?', [type, existing[0].id]);
      }
    } else {
      await db.execute('INSERT INTO Likes (video_id, user_id, type) VALUES (?, ?, ?)', [videoId, userId, type]);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to like video' });
  }
});

app.get('/api/videos/:id/related', async (req, res) => {
  try {
    const [videos]: any = await db.execute("SELECT v.*, u.firstName, u.lastName FROM Videos v JOIN Users u ON v.user_id = u.id WHERE v.status = 'ready' AND v.id != ? LIMIT 10", [req.params.id]);
    res.json(videos);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch related videos' });
  }
});

app.get('/api/videos/:id/analytics', authenticate, async (req: any, res) => {
  try {
    const videoId = req.params.id;
    const userId = req.user.id;
    
    // Auth Check
    let authQuery = "SELECT * FROM Videos WHERE id = ?";
    let authParams = [videoId];
    if (req.user.role !== 'admin') {
      authQuery += " AND user_id = ?";
      authParams.push(userId);
    }
    const [videos]: any = await db.execute(authQuery, authParams);
    
    if (videos.length === 0) return res.status(403).json({ error: 'Access Denied' });
    
    // Get total stats
    const [stats]: any = await db.execute(`
      SELECT 
        (SELECT COUNT(id) FROM Views WHERE video_id = ?) as total_views,
        (SELECT COALESCE(SUM(duration), 0) FROM video_analytics WHERE video_id = ?) as total_watch_time
    `, [videoId, videoId]);

    // Format stats with strict number safety
    const safeTotalViews = Number(stats[0]?.total_views) || 0;
    const safeWatchTime = Number(stats[0]?.total_watch_time) || 0;

    // Dummy timeline data for charts if none exists
    const viewsByDay = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return {
        date: d.toISOString().split('T')[0],
        count: Math.floor(Math.random() * 50)
      };
    });
    
    const retention = Array.from({ length: 10 }).map((_, i) => ({
      timestamp: i * 10,
      count: Math.max(0, 100 - i * 10)
    }));

    res.json({
      video: {
        ...videos[0],
        views: safeTotalViews,
        watch_time: safeWatchTime
      },
      viewsByDay,
      retention
    });
  } catch (error) {
    console.error('Fetch analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

app.get('/api/stats/video/:id', async (req, res) => {
  try {
    const [rows]: any = await db.query(
      "SELECT COALESCE(SUM(duration), 0) as totalTime FROM video_analytics WHERE video_id = ?",
      [req.params.id]
    );
    res.json({ watchTime: Number(rows[0]?.totalTime || 0) });
  } catch (error) {
    console.error('Fetch video stats error:', error);
    res.status(500).json({ error: 'Failed to fetch video stats' });
  }
});

app.get('/api/videos/:id/resolutions', async (req, res) => {
  console.log('[API CALL] ' + req.originalUrl);
  try {
    const [rows]: any = await db.execute('SELECT resolution FROM VideoResolutions WHERE video_id = ?', [req.params.id]);
      // Mapping resolusi sekaligus menimbang ukuran file fisik
      const resolutionDetails = rows.map((r: any) => {
        const resValue = r.resolution;
        let sizeStr = "Unknown Size";
        try {
          const filePath = path.join(process.cwd(), 'processed', `processed-${req.params.id}-${resValue}.mp4.omni`);
          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
            sizeStr = `${sizeInMB} MB`;
          }
        } catch (err) {
          console.error('[SIZE CHECK ERROR]', err);
        }
        
        return {
          res: resValue,
          size: sizeStr
        };
      });

      res.status(200).json(resolutionDetails);
  } catch (error) {
    console.error('Fetch resolutions error:', error);
    res.status(500).json({ error: 'Failed to fetch resolutions' });
  }
});

app.get('/api/channels/:id', async (req, res) => {
  try {
    const [rows]: any = await db.query(`
      SELECT 
        u.id,
        CONCAT(u.firstName, ' ', u.lastName) AS fallback_name,
        c.channel_name,
        c.description,
        c.avatar_url,
        c.banner_url,
        (SELECT COUNT(*) FROM Videos WHERE user_id = u.id) AS total_videos,
        (SELECT SUM(views) FROM Videos WHERE user_id = u.id) AS total_views
      FROM Users u
      LEFT JOIN Channels c ON u.id = c.user_id
      WHERE u.id = ?
    `, [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Creator not found' });
    }
    
    const user = rows[0];
    res.json({
      id: user.id,
      channel_name: user.channel_name || user.fallback_name,
      description: user.description || '',
      avatar_url: user.avatar_url || null,
      banner_url: user.banner_url || null,
      total_videos: user.total_videos || 0,
      total_views: user.total_views || 0
    });
  } catch (error) {
    console.error('[API CHANNELS ERROR]:', error);
    res.status(500).json({ error: 'Database query failed' });
  }
});

app.get('/api/channels/:id/videos', async (req, res) => {
  try {
    const [videos]: any = await db.execute(`
      SELECT v.*, 
        (SELECT COUNT(id) FROM Views WHERE video_id = v.id) as views,
        (SELECT COALESCE(SUM(duration), 0) FROM video_analytics WHERE video_id = v.id) as watch_time 
      FROM Videos v 
      WHERE v.user_id = ? AND v.processing_status = 'ready' 
      ORDER BY v.created_at DESC
    `, [req.params.id]);

    const processedVideos = videos.map((v: any) => ({
      ...v,
      watch_time: Number(v.watch_time) || 0,
      views: Number(v.views) || 0
    }));

    res.json(processedVideos || []);
  } catch (error) {
    console.error('Fetch channel videos error:', error);
    res.status(500).json({ error: 'Failed to fetch channel videos' });
  }
});

app.post('/api/subscriptions/toggle', authenticate, async (req: any, res) => {
  try {
    const leaderId = Number(req.body.leaderId);
    const followerId = Number(req.user.id);

    if (!leaderId || isNaN(leaderId)) {
      return res.status(400).json({ error: 'Invalid leaderId' });
    }

    if (leaderId === followerId) {
      return res.status(400).json({ error: 'Cannot subscribe to your own channel' });
    }
    
    const [existing]: any = await db.execute(
      'SELECT id FROM subscriptions WHERE subscriber_id = ? AND leader_id = ?', 
      [followerId, leaderId]
    );
    
    let isSubscribed = false;
    if (existing.length > 0) {
      await db.execute('DELETE FROM subscriptions WHERE id = ?', [existing[0].id]);
      isSubscribed = false;
    } else {
      await db.execute(
        'INSERT INTO subscriptions (subscriber_id, leader_id) VALUES (?, ?)', 
        [followerId, leaderId]
      );
      isSubscribed = true;
    }

    const [subCountRows]: any = await db.execute(
      'SELECT COUNT(*) as count FROM subscriptions WHERE leader_id = ?',
      [leaderId]
    );
    const subscriberCount = Number(subCountRows[0]?.count) || 0;

    res.json({ success: true, isSubscribed, subscriberCount });
  } catch (error) {
    console.error('Failed to toggle subscription:', error);
    res.status(500).json({ error: 'Failed to toggle subscription' });
  }
});

app.get('/api/channels/:id', async (req: any, res) => {
  try {
    const channelUserId = Number(req.params.id);
    const [userRows]: any = await db.execute(
      'SELECT id, firstName, lastName, avatar_url, role FROM Users WHERE id = ?',
      [channelUserId]
    );

    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const userData = userRows[0];
    const [channelRows]: any = await db.execute(
      'SELECT id, channel_name, description, avatar_url, banner_url FROM Channels WHERE user_id = ?',
      [channelUserId]
    );
    const channelData = channelRows[0] || {};

    const [subCountRows]: any = await db.execute(
      'SELECT COUNT(*) as count FROM subscriptions WHERE leader_id = ?',
      [channelUserId]
    );
    const subscriberCount = Number(subCountRows[0]?.count) || 0;

    let isSubscribed = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded: any = jwt.verify(token, JWT_SECRET);
        if (decoded && decoded.id) {
          const [subCheck]: any = await db.execute(
            'SELECT id FROM subscriptions WHERE subscriber_id = ? AND leader_id = ?',
            [decoded.id, channelUserId]
          );
          isSubscribed = subCheck.length > 0;
        }
      } catch (e) {
        // Token invalid, ignore
      }
    }

    res.json({
      id: channelUserId,
      channel_id: channelData.id || channelUserId,
      channel_name: channelData.channel_name || `${userData.firstName} ${userData.lastName || ''}`.trim(),
      firstName: userData.firstName,
      lastName: userData.lastName,
      avatar_url: channelData.avatar_url || userData.avatar_url,
      description: channelData.description,
      subscriberCount,
      isSubscribed
    });
  } catch (error) {
    console.error('Fetch channel error:', error);
    res.status(500).json({ error: 'Failed to fetch channel' });
  }
});

app.get('/api/user/subscriptions', authenticate, async (req: any, res) => {
  try {
    const userId = Number(req.user.id);
    const [subs]: any = await db.execute(
      `SELECT 
         s.id as subscription_id,
         s.leader_id,
         s.created_at,
         COALESCE(c.channel_name, CONCAT(u.firstName, ' ', COALESCE(u.lastName, ''))) as channel_name,
         COALESCE(c.avatar_url, u.avatar_url) as avatar_url,
         (SELECT COUNT(*) FROM Videos v WHERE v.user_id = s.leader_id AND v.status = 'ready') as video_count,
         EXISTS(
           SELECT 1 FROM Videos v 
           WHERE v.user_id = s.leader_id 
             AND v.status = 'ready' 
             AND v.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         ) as hasUnread
       FROM subscriptions s
       LEFT JOIN Users u ON s.leader_id = u.id
       LEFT JOIN Channels c ON s.leader_id = c.user_id
       WHERE s.subscriber_id = ?
       ORDER BY s.created_at DESC`,
      [userId]
    );

    res.json({ success: true, subscriptions: subs });
  } catch (error) {
    console.error('Failed to fetch user subscriptions:', error);
    res.status(500).json({ error: 'Failed to fetch user subscriptions' });
  }
});

app.get('/api/channels', async (req, res) => {
  try {
    const [channels]: any = await db.query(
      `SELECT c.id, c.user_id, c.channel_name, c.avatar_url, 
              (SELECT COUNT(*) FROM Videos v WHERE v.user_id = c.user_id AND v.status = 'ready') as video_count
       FROM Channels c 
       ORDER BY c.id ASC LIMIT 20`
    );
    res.json({ success: true, channels });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

app.get('/api/playlists', async (req, res) => {
  try {
    const [playlists]: any = await db.execute('SELECT * FROM Playlists');
    res.json(playlists);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

app.post('/api/playlists', authenticate, async (req: any, res) => {
  try {
    const { title, description } = req.body;
    await db.execute('INSERT INTO Playlists (user_id, title, description) VALUES (?, ?, ?)', [req.user.id, title, description]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

// --- Admin RBAC & Encoding Config Routes ---
app.get('/api/admin/logs', authenticate, isAdmin, async (req, res) => {
  try {
    const [logs]: any = await db.query('SELECT * FROM SystemLogs ORDER BY created_at DESC LIMIT 500');
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// --- ADMIN DASHBOARD API ENDPOINTS ---
app.get('/api/admin/stats', authenticate, isAdmin, async (req, res) => {
  try {
    const [userCount]: any = await db.query('SELECT COUNT(*) as total FROM Users');
    const [videoCount]: any = await db.query('SELECT COUNT(*) as total FROM Videos');
    const [viewsCount]: any = await db.query('SELECT SUM(views) as total FROM Videos');
    const [topVideos]: any = await db.query("SELECT id, title, 0 as size, views, 'CPU' as encoding_engine, status, thumbnail_url FROM Videos ORDER BY views DESC LIMIT 5");
    
    res.json({
      totalUsers: { count: userCount[0]?.total || 0, trend: 0 },
      totalVideos: { count: videoCount[0]?.total || 0, trend: 0 },
      totalViews: { count: viewsCount[0]?.total || 0, trend: 0 },
      resources: { hasNVENC: false }, // CPU ONLY status by default, matching screenshot
      topVideos: topVideos,
      viewsByDay: [
        { date: 'Mon', views: 120 },
        { date: 'Tue', views: 200 },
        { date: 'Wed', views: 150 },
        { date: 'Thu', views: 300 },
        { date: 'Fri', views: 250 },
        { date: 'Sat', views: 400 },
        { date: 'Sun', views: 350 }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

app.get('/api/admin/reports', authenticate, isAdmin, async (req, res) => {
  try {
    // Dummy reports data to satisfy AdminDashboard/Admin components
    res.json({
      totals: { totalVideos: 0, totalUsers: 0 },
      gpu: 'CPU ONLY',
      health: 'Optimal',
      reportsList: []
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch admin reports' });
  }
});

app.get('/api/admin/queue', authenticate, isAdmin, async (req, res) => {
  try {
    const [processingVideos]: any = await db.query(
      "SELECT id, title, status, created_at FROM Videos WHERE status IN ('processing', 'waiting') ORDER BY created_at DESC"
    );
    res.json(processingVideos);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

app.get('/api/admin/settings', authenticate, isAdmin, async (req, res) => {
  try {
    res.json(encodingSettings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.get('/api/admin/comments', authenticate, isAdmin, async (req, res) => {
  try {
    const [comments]: any = await db.query(
      `SELECT c.*, u.firstName, u.lastName, v.title as videoTitle 
       FROM Comments c 
       JOIN Users u ON c.user_id = u.id 
       JOIN Videos v ON c.video_id = v.id 
       ORDER BY c.created_at DESC LIMIT 50`
    );
    res.json(comments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

app.get('/api/admin/users', authenticate, isAdmin, async (req, res) => {
  try {
    const [users]: any = await db.query('SELECT id, email, firstName, lastName, role, created_at FROM Users ORDER BY created_at DESC');
    const mappedUsers = users.map((u: any) => ({
      ...u,
      is_blocked: disabledUsers.includes(u.id)
    }));
    res.json(mappedUsers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/admin/reset-requests', authenticate, isAdmin, async (req, res) => {
  try {
    const [requests]: any = await db.query('SELECT * FROM password_reset_requests ORDER BY created_at DESC');
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

app.post('/api/admin/reset-requests/:id/resolve', authenticate, isAdmin, async (req, res) => {
  try {
    const ticketId = req.params.id; // actually id from DB
    const [requests]: any = await db.query('SELECT email FROM password_reset_requests WHERE id = ?', [ticketId]);
    if (requests.length === 0) return res.status(404).json({ error: 'Ticket not found' });
    
    const email = requests[0].email;
    const [users]: any = await db.query('SELECT id FROM Users WHERE email = ?', [email]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found for this email' });
    
    const defaultPassword = 'User!1234@';
    const hash = await bcrypt.hash(defaultPassword, 10);
    
    // Update user password
    await db.execute('UPDATE Users SET password = ? WHERE email = ?', [hash, email]);
    
    // Update ticket status
    await db.execute("UPDATE password_reset_requests SET status = 'resolved', new_password = ? WHERE id = ?", [defaultPassword, ticketId]);
    
    res.json({ message: 'Password reset to default User!1234@' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resolve request' });
  }
});

app.post('/api/admin/reset-password-execute', authenticate, isAdmin, async (req, res) => {
  try {
    const { ticketId, newPassword } = req.body;
    
    if (!ticketId || !newPassword) {
      return res.status(400).json({ error: 'ticketId and newPassword are required' });
    }

    const [requests]: any = await db.query('SELECT email FROM password_reset_requests WHERE id = ?', [ticketId]);
    if (requests.length === 0) return res.status(404).json({ error: 'Ticket not found' });
    
    const email = requests[0].email;
    const [users]: any = await db.query('SELECT id FROM Users WHERE email = ?', [email]);
    if (users.length === 0) return res.status(404).json({ error: 'User not found for this email' });
    
    const hash = await bcrypt.hash(newPassword, 10);
    
    // Update user password
    await db.execute('UPDATE Users SET password = ? WHERE email = ?', [hash, email]);
    
    // Update ticket status
    await db.execute("UPDATE password_reset_requests SET status = 'resolved', new_password = ? WHERE id = ?", [newPassword, ticketId]);
    
    res.json({ message: 'Password successfully reset' });
  } catch (error) {
    console.error('Password manual reset error:', error);
    res.status(500).json({ error: 'Failed to execute reset password' });
  }
});

app.get('/api/admin/reset-requests/template', authenticate, isAdmin, async (req, res) => {
  try {
    const XLSX = require('xlsx');
    // Kolom: No, Nama Lengkap, Jabatan (atau Pangkat), NRP, Kesatuan, Prioritas. DENGAN TIDAK ADA status atau waktu request.
    const ws = XLSX.utils.json_to_sheet([{
      'No': 1,
      'Nama Lengkap': 'John Doe',
      'Jabatan (atau Pangkat)': 'Kopral',
      'NRP': '1234567890',
      'Kesatuan': 'Pusat',
      'Prioritas': 'High'
    }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Disposition', 'attachment; filename="Template_Reset_Password.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate template' });
  }
});

app.post('/api/admin/reset-requests/import', authenticate, isAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    let successCount = 0;
    let errors: string[] = [];

    for (let i = 0; i < data.length; i++) {
      const row: any = data[i];
      const rowNum = i + 2; // Assuming header is row 1
      
      const nama = row['Nama Lengkap'] || row['NAMA LENGKAP'] || '';
      const jabatan = row['Jabatan (atau Pangkat)'] || row['JABATAN'] || '';
      const nrpRaw = row['NRP'] || '';
      const nrp = String(nrpRaw).trim();
      const kesatuan = row['Kesatuan'] || row['KESATUAN'] || '';
      const prioritas = row['Prioritas'] || row['PRIORITAS'] || '';

      if (!jabatan) {
         errors.push(`Baris ${rowNum}: JABATAN KOSONG`);
         continue;
      }
      if (!nrp) {
         errors.push(`Baris ${rowNum}: NRP KOSONG`);
         continue;
      }
      if (!nama) {
         errors.push(`Baris ${rowNum}: NAMA KOSONG`);
         continue;
      }

      // Check duplicates
      const [existingNrp]: any = await db.query('SELECT id FROM password_reset_requests WHERE nrp = ? AND status = "pending"', [nrp]);
      if (existingNrp && existingNrp.length > 0) {
         errors.push(`Baris ${rowNum}: NRP DUPLIKAT`);
         continue;
      }

      const ticketId = 'OMNI-' + Math.random().toString(36).substr(2, 6).toUpperCase();
      
      // Auto inject values (waktu request, status default)
      await db.execute(
        `INSERT INTO password_reset_requests 
        (ticket_id, full_name, email, complaint, status, jabatan, nrp, kesatuan, prioritas, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ticketId, nama, `${nrp}@omnihub.local`, 'Imported via Excel Reset Tool', 'pending', jabatan, nrp, kesatuan, prioritas, new Date()]
      );
      successCount++;
    }

    try { fs.unlinkSync(req.file.path); } catch (e) {}

    res.json({ message: `Selesai diimpor. ${successCount} berhasil.`, errors, successCount });

  } catch (err: any) {
    console.error('Import error:', err);
    if (req.file && fs.existsSync(req.file.path)) {
       try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ error: 'Failed to import data', details: err.message });
  }
});

app.post('/api/admin/users', authenticate, isAdmin, async (req, res) => {
  try {
    const { email, password, firstName, lastName, role } = req.body;
    const hash = await bcrypt.hash(password, 10);
    await db.execute('INSERT INTO Users (email, password, firstName, lastName, role) VALUES (?, ?, ?, ?, ?)', 
      [email, hash, firstName, lastName, role || 'user']);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

app.put('/api/admin/users/:id/password', authenticate, isAdmin, async (req: any, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { newPassword } = req.body;
    if (!newPassword) {
      return res.status(400).json({ error: 'newPassword is required' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await db.execute('UPDATE Users SET password = ? WHERE id = ?', [hash, userId]);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Update user password error:', error);
    res.status(500).json({ error: 'Failed to update user password' });
  }
});

app.put('/api/admin/users/:id', authenticate, isAdmin, async (req: any, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { role, firstName, lastName, is_blocked, password } = req.body;

    if (role || firstName || lastName) {
      await db.execute('UPDATE Users SET role = COALESCE(?, role), firstName = COALESCE(?, firstName), lastName = COALESCE(?, lastName) WHERE id = ?', 
        [role, firstName, lastName, userId]);
    }
    
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await db.execute('UPDATE Users SET password = ? WHERE id = ?', [hash, userId]);
    }

    if (typeof is_blocked === 'boolean') {
      if (is_blocked && !disabledUsers.includes(userId)) {
        disabledUsers.push(userId);
      } else if (!is_blocked) {
        disabledUsers = disabledUsers.filter(id => id !== userId);
      }
      fs.writeFileSync(DISABLED_USERS_FILE, JSON.stringify(disabledUsers, null, 2));
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

app.delete('/api/admin/users/:id', authenticate, isAdmin, async (req: any, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (userId === req.user.id) return res.status(403).json({ error: 'Cannot delete yourself' });

    // Pre-Deletion Intelligence: Find all videos owned by user to physically wipe them
    const [videos]: any = await db.query('SELECT id, url, thumbnail_url FROM Videos WHERE user_id = ?', [userId]);

    for (const video of videos) {
      const [resolutions]: any = await db.query('SELECT url FROM VideoResolutions WHERE video_id = ?', [video.id]);
      const filesToDelete: string[] = [];

      for (const resRec of resolutions) {
        if (resRec.url && resRec.url.startsWith('/processed/')) {
          filesToDelete.push(path.join(PROCESSED_DIR, path.basename(resRec.url)));
        }
      }

      if (video.url) {
         if (video.url.startsWith('/uploads/')) filesToDelete.push(path.join(UPLOAD_DIR, path.basename(video.url)));
         else if (video.url.startsWith('/processed/')) filesToDelete.push(path.join(PROCESSED_DIR, path.basename(video.url)));
      }

      if (video.thumbnail_url) {
         if (video.thumbnail_url.startsWith('/thumbnails/')) filesToDelete.push(path.join(THUMBNAIL_DIR, path.basename(video.thumbnail_url)));
      }

      const uniqueFilesToDelete = [...new Set(filesToDelete)];

      for (const filePath of uniqueFilesToDelete) {
        try { await fs.promises.unlink(filePath); } catch (e) {}
      }
    }

    // Now safely rely on ON DELETE CASCADE in the database level to destroy associations
    await db.execute('DELETE FROM Users WHERE id = ?', [userId]);

    // Also remove from disabled list if present
    disabledUsers = disabledUsers.filter(id => id !== userId);
    fs.writeFileSync(DISABLED_USERS_FILE, JSON.stringify(disabledUsers, null, 2));

    res.json({ success: true, message: 'User and all associated content eradicated.' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// NEW: GET Admin Multi-Resolution Encoding Config
app.get('/api/admin/encoding-settings', authenticate, isAdmin, async (req, res) => {
  console.log('[API CALL] ' + req.originalUrl);
  res.json(encodingSettings);
});

// --- TAHAP 64.0: ADMIN MANAGEMENT API FOR PROGRAMS & STUDENT PROGRESS ---
// 1. Tambah Program Baru
app.post('/api/admin/programs', authenticate, isAdmin, async (req, res) => {
  try {
    const { program_name, type, max_quota } = req.body;
    if (!program_name || !type) {
      return res.status(400).json({ error: 'program_name dan type (reset_monthly/continuous) wajib diisi.' });
    }
    const quotaVal = type === 'continuous' ? (parseInt(max_quota, 10) || 10) : null;
    await db.execute(
      'INSERT INTO Programs (program_name, type, max_quota) VALUES (?, ?, ?)',
      [program_name.trim(), type, quotaVal]
    );
    res.json({ success: true, message: 'Program baru berhasil ditambahkan.' });
  } catch (err: any) {
    console.error('[ADMIN PROGRAM CREATE ERROR 64.0]:', err);
    res.status(500).json({ error: 'Gagal menambah program baru.' });
  }
});

// 2. Update Program
app.put('/api/admin/programs/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { program_name, type, max_quota } = req.body;
    const quotaVal = type === 'continuous' ? (parseInt(max_quota, 10) || 10) : null;
    await db.execute(
      'UPDATE Programs SET program_name = COALESCE(?, program_name), type = COALESCE(?, type), max_quota = ? WHERE id = ?',
      [program_name ? program_name.trim() : null, type, quotaVal, id]
    );
    res.json({ success: true, message: 'Data program berhasil diperbarui.' });
  } catch (err: any) {
    console.error('[ADMIN PROGRAM UPDATE ERROR 64.0]:', err);
    res.status(500).json({ error: 'Gagal memperbarui data program.' });
  }
});

// 3. Hapus Program
app.delete('/api/admin/programs/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await db.execute('DELETE FROM Programs WHERE id = ?', [id]);
    res.json({ success: true, message: 'Program berhasil dihapus.' });
  } catch (err: any) {
    console.error('[ADMIN PROGRAM DELETE ERROR 64.0]:', err);
    res.status(500).json({ error: 'Gagal menghapus program.' });
  }
});

// 4. Ambil Seluruh Progress Siswa
app.get('/api/admin/student-progress', authenticate, isAdmin, async (req, res) => {
  try {
    const [progress]: any = await db.query(`
      SELECT sp.*, p.program_name, p.type as program_type, p.max_quota 
      FROM StudentProgress sp 
      JOIN Programs p ON sp.program_id = p.id 
      ORDER BY sp.updated_at DESC
    `);
    res.json(progress);
  } catch (err: any) {
    console.error('[ADMIN STUDENT PROGRESS FETCH ERROR 64.0]:', err);
    res.status(500).json({ error: 'Gagal mengambil riwayat progress siswa.' });
  }
});

// 5. Override / Edit Manual Pertemuan Siswa
app.put('/api/admin/student-progress/:id', authenticate, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { last_meeting_number, last_session_date } = req.body;
    await db.execute(
      'UPDATE StudentProgress SET last_meeting_number = ?, last_session_date = ? WHERE id = ?',
      [last_meeting_number, last_session_date, id]
    );
    res.json({ success: true, message: 'Progress pertemuan siswa berhasil disesuaikan.' });
  } catch (err: any) {
    console.error('[ADMIN STUDENT PROGRESS EDIT ERROR 64.0]:', err);
    res.status(500).json({ error: 'Gagal menyesuaikan progress siswa.' });
  }
});

// NEW ADMIN ROUTES
app.get('/api/admin/videos', authenticate, isAdmin, async (req: any, res) => {
  try {
    const [videos]: any = await db.query(
      `SELECT v.*, u.firstName, u.lastName, u.email 
       FROM Videos v 
       JOIN Users u ON v.user_id = u.id 
       ORDER BY v.created_at DESC`
    );
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch platform videos' });
  }
});

app.delete('/api/admin/video/:id', authenticate, isAdmin, async (req: any, res) => {
  console.log('[API CALL] ADMIN TAKEDOWN ' + req.originalUrl);
  try {
    const videoId = req.params.id;

    // We reuse the scorched earth intelligence logic
    const [videos]: any = await db.query(`SELECT * FROM Videos WHERE id = ?`, [videoId]);
    if (!videos || videos.length === 0) return res.status(404).json({ error: 'Video not found' });
    const video = videos[0];

    const [resolutions]: any = await db.query('SELECT url FROM VideoResolutions WHERE video_id = ?', [videoId]);

    const filesToDelete: string[] = [];

    for (const resRec of resolutions) {
      if (resRec.url && resRec.url.startsWith('/processed/')) {
        filesToDelete.push(path.join(PROCESSED_DIR, path.basename(resRec.url)));
      }
    }

    if (video.url) {
       if (video.url.startsWith('/uploads/')) filesToDelete.push(path.join(UPLOAD_DIR, path.basename(video.url)));
       else if (video.url.startsWith('/processed/')) filesToDelete.push(path.join(PROCESSED_DIR, path.basename(video.url)));
    }

    if (video.thumbnail_url) {
       if (video.thumbnail_url.startsWith('/thumbnails/')) filesToDelete.push(path.join(THUMBNAIL_DIR, path.basename(video.thumbnail_url)));
    }

    const uniqueFilesToDelete = [...new Set(filesToDelete)];

    for (const filePath of uniqueFilesToDelete) {
      try {
        await fs.promises.unlink(filePath);
      } catch (err: any) {
        /* Ignore missing files on disk */
      }
    }

    // DB Cascaded Deletion
    await db.execute('DELETE FROM VideoResolutions WHERE video_id = ?', [videoId]);
    await db.execute('DELETE FROM Views WHERE video_id = ?', [videoId]);
    await db.execute('DELETE FROM Likes WHERE video_id = ?', [videoId]);
    await db.execute('DELETE FROM Comments WHERE video_id = ?', [videoId]);
    await db.execute('DELETE FROM Videos WHERE id = ?', [videoId]);

    res.json({ success: true, message: 'Video completely destroyed' });
  } catch (error) {
    console.error('Admin delete error:', error);
    res.status(500).json({ error: 'Failed to takedown video' });
  }
});

app.get('/api/admin/reports', authenticate, isAdmin, async (req: any, res) => {
  try {
    const [stats]: any = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM Videos) as totalVideos,
        (SELECT COUNT(*) FROM Users) as totalUsers,
        (SELECT COUNT(*) FROM Views) as totalViews
    `);
    
    // Simulate system health metrics for the dashboard
    res.json({
       health: 'Optimal',
       totals: stats[0],
       gpu: hasNVENC ? 'NVENC Active' : 'CPU Software Mode',
       uptime: process.uptime()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// --- STAGE 1.19: REPORTING ANALYTICS AGGREGATION ENDPOINT ---
app.get('/api/admin/reports/chart', authenticate, isAdmin, async (req: any, res) => {
  try {
    const filter = req.query.filter || 'daily';
    let groupBy, dateSelect, limit;

    if (filter === 'monthly') {
      groupBy = `DATE_FORMAT(created_at, '%Y-%m')`;
      dateSelect = `DATE_FORMAT(created_at, '%b %Y') as label`;
      limit = 12;
    } else if (filter === 'weekly') {
      groupBy = `YEARWEEK(created_at, 1)`;
      dateSelect = `CONCAT('W', WEEK(created_at, 1), ' ', YEAR(created_at)) as label`;
      limit = 12;
    } else {
      // Default: Daily
      groupBy = `DATE(created_at)`;
      dateSelect = `DATE_FORMAT(created_at, '%d %b') as label`;
      limit = 14;
    }

    const [chartData]: any = await db.query(`
      SELECT 
        ${dateSelect},
        COUNT(id) as uploaded_videos,
        COALESCE(SUM(duration), 0) as total_duration_seconds,
        COALESCE(SUM(downloads), 0) as total_downloads
      FROM Videos
      WHERE deleted_at IS NULL
      GROUP BY ${groupBy}
      ORDER BY ${groupBy} DESC
      LIMIT ${limit}
    `);

    const [topVideos]: any = await db.query(`
      SELECT id, title, downloads, duration, views, created_at 
      FROM Videos 
      WHERE deleted_at IS NULL AND downloads > 0
      ORDER BY downloads DESC, views DESC 
      LIMIT 10
    `);

    // Reverse chart data to make it chronological (left-to-right) for Recharts UI
    res.json({
      chart: chartData.reverse(),
      topDownloaded: topVideos
    });
  } catch (err) {
    console.error('[REPORTING API ERROR]:', err);
    res.status(500).json({ error: 'Failed to fetch reporting chart data' });
  }
});

// NEW: PUT Admin Multi-Resolution Encoding Config
app.put('/api/admin/encoding-settings', authenticate, isAdmin, async (req: any, res) => {
  console.log('[API CALL] ' + req.originalUrl);
  try {
    const newSettings = req.body;
    if (newSettings.maxUploadSizeGB !== undefined) {
      encodingSettings.maxUploadSizeGB = newSettings.maxUploadSizeGB;
    }
    for (const key of Object.keys(encodingSettings)) {
      if (newSettings[key] && typeof newSettings[key].active === 'boolean') {
        encodingSettings[key].active = newSettings[key].active;
        if (newSettings[key].videoBitrate) encodingSettings[key].videoBitrate = newSettings[key].videoBitrate;
        if (newSettings[key].audioBitrate) encodingSettings[key].audioBitrate = newSettings[key].audioBitrate;
      }
    }
    fs.writeFileSync(ENCODING_SETTINGS_FILE, JSON.stringify(encodingSettings, null, 2));
    await systemLog('INFO', 'Admin', `Encoding settings updated by user ${req.user.id}`);
    res.json({ success: true, settings: encodingSettings });
  } catch (error) {
    console.error('Update encoding settings error:', error);
    res.status(500).json({ error: 'Failed to update encoding settings' });
  }
});

// ============================================================================
// 7. ENDPOINT DOWNLOAD EKSKLUSIF
// ============================================================================
app.get('/api/videos/download/:id/:res', authenticateDownload, async (req: any, res) => {
  try {
    const { id: videoId, res: resolution } = req.params;
    
    const [videos]: any = await db.query('SELECT id, title, url, allow_download, status FROM Videos WHERE id = ?', [videoId]);
    const video = videos[0];
    
    if (!video) return res.status(404).send('Video not found');
    if (video.status !== 'ready') return res.status(403).send('Video is not ready for download');
    if (!video.allow_download && req.user.role !== 'admin') return res.status(403).send('Download is disabled for this video');

    // STAGE 1.18: Track Download Event
    db.execute('UPDATE Videos SET downloads = downloads + 1 WHERE id = ?', [videoId]).catch(() => {});

    let downloadUrl = video.url;
    if (resolution && resolution !== 'original') {
      const [resolutions]: any = await db.query("SELECT url FROM VideoResolutions WHERE video_id = ? AND resolution = ? AND status = 'ready'", [videoId, resolution]);
      if (resolutions && resolutions.length > 0 && resolutions[0].url) {
        downloadUrl = resolutions[0].url;
      } else {
         return res.status(404).send('Resolution not found');
      }
    }

    let targetPath = '';
    if (downloadUrl.startsWith('/processed/')) {
      targetPath = path.join(PROCESSED_DIR, path.basename(downloadUrl));
    } else if (downloadUrl.startsWith('/uploads/')) {
      targetPath = path.join(UPLOAD_DIR, path.basename(downloadUrl));
    } else {
      targetPath = path.join(process.cwd(), downloadUrl.startsWith('/') ? downloadUrl.substring(1) : downloadUrl);
    }

    if (fs.existsSync(targetPath + '.omni')) {
      const realPath = targetPath + '.omni';
      const stat = fs.statSync(realPath);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="video-${resolution}.mp4"`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      });
      const stream = createRestoredStream(realPath);
      stream.on('error', (err) => {
        console.error(`[STREAM ERROR] ${err.message}`);
        if (!res.headersSent) res.status(500).end();
      });
      stream.pipe(res);
      
      req.on('close', () => {
        stream.destroy();
      });
    } else if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="video-${resolution}.mp4"`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      });
      const stream = fs.createReadStream(targetPath);
      stream.on('error', (err) => {
        console.error(`[STREAM ERROR] ${err.message}`);
        if (!res.headersSent) res.status(500).end();
      });
      stream.pipe(res);
      
      // Handle koneksi putus dari browser (ECONNABORTED)
      req.on('close', () => {
        stream.destroy();
      });
    } else {
      res.status(404).json({ error: 'File not found' });
    }

  } catch (error: any) {
    console.error(`[DOWNLOAD_CRITICAL_ERROR] | VideoID: ${req.params.id} | ${error.message}`);
    console.error(error.stack);
    
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
});

// ============================================================================
// 8. VITE MIDDLEWARE & SERVER START
// ============================================================================
async function startServer() {
  console.log('[SYSTEM] Booting up OmniHub Server...');
  try {
    const runDBSetup = async () => {
      try {
        await initDB();
    try {
      await db.query("ALTER TABLE Videos ADD COLUMN processing_status VARCHAR(50) DEFAULT 'ready'");
    } catch (e: any) {
      if (e.code !== 'ER_DUP_FIELDNAME') {
        console.error('[SYSTEM] Failed to add processing_status column', e);
      }
    }
    try { await db.query("ALTER TABLE Videos ADD COLUMN duration INT DEFAULT 0"); } catch (e: any) {}
    try { await db.query("ALTER TABLE Videos ADD COLUMN downloads INT DEFAULT 0"); } catch (e: any) {}
    await db.query(`CREATE TABLE IF NOT EXISTS password_reset_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ticket_id VARCHAR(50) UNIQUE NOT NULL,
      full_name VARCHAR(100) NOT NULL,
      email VARCHAR(100) NOT NULL,
      complaint TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      new_password VARCHAR(255),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // --- TAHAP 61.0: AUTOCREATE PROGRAMS & STUDENT PROGRESS TABLES ---
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS Programs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          program_name VARCHAR(100) UNIQUE NOT NULL,
          type ENUM('reset_monthly', 'continuous') NOT NULL,
          max_quota INT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS StudentProgress (
          id INT AUTO_INCREMENT PRIMARY KEY,
          student_name VARCHAR(100) NOT NULL,
          program_id INT NOT NULL,
          last_meeting_number INT NOT NULL DEFAULT 1,
          last_session_date DATE NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (program_id) REFERENCES Programs(id) ON DELETE CASCADE
        )
      `);

      // Seeding Default Programs jika tabel masih kosong
      const [existingProgs]: any = await db.query('SELECT COUNT(*) as count FROM Programs');
      if (existingProgs[0].count === 0) {
        const defaultPrograms = [
          // Reset Bulanan
          ['Arduino Beginner', 'reset_monthly', null],
          ['Arduino Intermediate', 'reset_monthly', null],
          ['Arduino IoT', 'reset_monthly', null],
          ['Robotic Explorer 1', 'reset_monthly', null],
          ['Robotic Explorer 2', 'reset_monthly', null],
          // Kontinu
          ['Web Design', 'continuous', 12],
          ['Figma', 'continuous', 8],
          ['Basic Python 1', 'continuous', 10],
          ['Basic Python 2', 'continuous', 10],
          ['Java Programming', 'continuous', 24],
          ['Python Data Analyst', 'continuous', 16],
          ['Python Machine Learning', 'continuous', 16],
          ['JavaScript', 'continuous', 12]
        ];

        for (const prog of defaultPrograms) {
          await db.execute(
            'INSERT IGNORE INTO Programs (program_name, type, max_quota) VALUES (?, ?, ?)',
            prog
          );
        }
        console.log('[DB INIT 61.0] Master Data Programs berhasil di-seed otomatis.');
      }
      console.log('[DB INIT 61.0] Tabel Programs & StudentProgress terverifikasi aman.');
    } catch (progDbErr) {
      console.error('[DB INIT ERROR 61.0] Gagal inisialisasi tabel Programs/StudentProgress:', progDbErr);
    }
      } catch (err: any) {
        console.error('[DATABASE SETUP ERROR]:', err?.message || err);
      }
    };
    await runDBSetup();

    // --- API ENDPOINT FETCH PROGRAMS (TAHAP 61.0) ---
    app.get('/api/programs', async (req, res) => {
      try {
        const [programs]: any = await db.query('SELECT * FROM Programs ORDER BY program_name ASC');
        res.json(programs);
      } catch (err) {
        res.status(500).json({ error: 'Gagal mengambil data program.' });
      }
    });

    // --- API ENDPOINT REKOMENDASI PERTEMUAN (TAHAP 62.0) ---
    app.post('/api/students/next-meeting', async (req, res) => {
      try {
        const { studentName, programId, sessionDate } = req.body;
        if (!studentName || !programId) {
          return res.status(400).json({ error: 'studentName dan programId wajib diisi.' });
        }
        const result = await calculateNextMeeting(studentName, parseInt(programId, 10), sessionDate);
        res.json(result);
      } catch (err: any) {
        console.error('[MEETING CALC ERROR 62.0]:', err);
        res.status(500).json({ error: 'Gagal mengkalkulasi rekomendasi pertemuan.' });
      }
    });

    // --- AUTOCREATE MISSING ANALYTICS TABLES ---
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS Views (
          id INT AUTO_INCREMENT PRIMARY KEY,
          video_id INT NOT NULL,
          user_id INT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS video_analytics (
          id INT AUTO_INCREMENT PRIMARY KEY,
          video_id INT NOT NULL,
          user_id INT,
          duration INT DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS VideoResolutions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          video_id INT NOT NULL,
          resolution VARCHAR(20) NOT NULL,
          url VARCHAR(255) NOT NULL,
          size INT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (video_id) REFERENCES Videos(id) ON DELETE CASCADE
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS SystemLogs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          level VARCHAR(50),
          source VARCHAR(100),
          message TEXT,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS video_stats (
          video_id INT PRIMARY KEY,
          views INT DEFAULT 0,
          FOREIGN KEY (video_id) REFERENCES Videos(id) ON DELETE CASCADE
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS Subscriptions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          subscriber_id INT NOT NULL,
          leader_id INT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_sub (subscriber_id, leader_id)
        )
      `);
      
      // --- STAGE 1.26: USER HISTORY & WATCH LATER TABLES ---
      await db.query(`
        CREATE TABLE IF NOT EXISTS WatchHistory (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          video_id INT NOT NULL,
          watched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_history (user_id, video_id),
          FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
          FOREIGN KEY (video_id) REFERENCES Videos(id) ON DELETE CASCADE
        )
      `);
      
      await db.query(`
        CREATE TABLE IF NOT EXISTS WatchLater (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          video_id INT NOT NULL,
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_watch_later (user_id, video_id),
          FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
          FOREIGN KEY (video_id) REFERENCES Videos(id) ON DELETE CASCADE
        )
      `);
      // --- AUTOCREATE MISSING TABLES REVEALED IN SCREENSHOT ---
      await db.query(`
        CREATE TABLE IF NOT EXISTS admin_deletion_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          admin_id INT NOT NULL,
          action VARCHAR(255) NOT NULL,
          target_type VARCHAR(50),
          target_id VARCHAR(255),
          reason TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (admin_id) REFERENCES Users(id) ON DELETE CASCADE
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS comments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          video_id INT NOT NULL,
          user_id INT NOT NULL,
          content TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (video_id) REFERENCES Videos(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS likes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          video_id INT NOT NULL,
          user_id INT NOT NULL,
          type VARCHAR(20) NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (video_id) REFERENCES Videos(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS playlists (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS playlistvideos (
          id INT AUTO_INCREMENT PRIMARY KEY,
          playlist_id INT NOT NULL,
          video_id INT NOT NULL,
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
          FOREIGN KEY (video_id) REFERENCES Videos(id) ON DELETE CASCADE
        )
      `);

      console.log('[SYSTEM] Analytics & system tables (Views, video_analytics, VideoResolutions, SystemLogs, video_stats, Subscriptions, WatchHistory, WatchLater, comments, likes, playlists, playlistvideos, admin_deletion_logs) verified/created successfully.');
    } catch (analyticsError) {
      console.error('[SYSTEM] Failed to create analytics tables:', analyticsError);
    }
    // -------------------------------------------

    // Tambahkan kolom baru untuk template import Excel sesuai instruksi
    try { await db.query("ALTER TABLE Videos ADD COLUMN thumbnail_url VARCHAR(255)"); } catch (e: any) {}
    try { await db.query("ALTER TABLE VideoResolutions ADD COLUMN status VARCHAR(50) DEFAULT 'ready'"); } catch (e: any) {}
    try { await db.query("ALTER TABLE Videos ADD COLUMN status VARCHAR(50) DEFAULT 'processing'"); } catch (e: any) {}
    try { await db.query("ALTER TABLE Videos ADD COLUMN student_name VARCHAR(255)"); } catch (e: any) {}
    try { await db.query("ALTER TABLE Videos ADD COLUMN program_id INT"); } catch (e: any) {}
    try { await db.query("ALTER TABLE Videos ADD COLUMN meeting_number INT"); } catch (e: any) {}
    try { await db.query("ALTER TABLE Videos ADD COLUMN session_date DATE"); } catch (e: any) {}
    try { await db.query("ALTER TABLE Videos ADD COLUMN upload_id VARCHAR(255)"); } catch (e: any) {}
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS video_stats (
          video_id INT PRIMARY KEY,
          views INT DEFAULT 0,
          FOREIGN KEY (video_id) REFERENCES Videos(id) ON DELETE CASCADE
        )
      `);
    } catch (e: any) {}
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS Subscriptions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          subscriber_id INT NOT NULL,
          leader_id INT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_sub (subscriber_id, leader_id)
        )
      `);
    } catch (e: any) {}
    try { await db.query("ALTER TABLE password_reset_requests ADD COLUMN jabatan VARCHAR(255)"); } catch (e: any) {}
    try { await db.query("ALTER TABLE password_reset_requests ADD COLUMN nrp VARCHAR(255)"); } catch (e: any) {}
    try { await db.query("ALTER TABLE password_reset_requests ADD COLUMN kesatuan VARCHAR(255)"); } catch (e: any) {}
    try { await db.query("ALTER TABLE password_reset_requests ADD COLUMN prioritas VARCHAR(50)"); } catch (e: any) {}
    try { await db.query("ALTER TABLE Videos ADD COLUMN file_path VARCHAR(255)"); } catch (e: any) {}
    
  } catch (err) {
    console.error('[SYSTEM] Database initialization deferred (background retry):', err);
  }

  // ENDPOINT BARU: Streaming video dengan De-Obfuscate (XOR 0xAF)
  app.get('/api/videos/stream/:id', async (req, res) => {
    try {
      const resolution = req.query.res;
      if (!resolution) {
        return res.status(400).send('Resolution parameter required');
      }

      // Perbaikan typo nama file: Menghapus huruf 'p' setelah parameter resolusi
      const filePath = path.join(process.cwd(), 'processed', `processed-${req.params.id}-${req.query.res}.mp4.omni`);

      const fileExists = await fs.promises.access(filePath).then(() => true).catch(() => false);
      if (!fileExists) {
        return res.status(404).send('File not found on disk');
      }

      const stat = await fs.promises.stat(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
        });

        const stream = createRestoredStream(filePath, start, end);
        stream.pipe(res);
        req.on('close', () => stream.destroy());
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Accept-Ranges': 'bytes',
          'Content-Type': 'video/mp4',
        });
        
        const stream = createRestoredStream(filePath);
        stream.pipe(res);
        req.on('close', () => stream.destroy());
      }
    } catch (err) {
      console.error('[STREAM ERROR]', err);
      res.status(500).end();
    }
  });

  // --- RUTE KHUSUS DOWNLOAD VIDEO DEKRIPSI ---
  app.get('/api/videos/download/:id', async (req, res) => {
    try {
      const resParam = req.query.res || '360';
      const filePath = path.join(process.cwd(), 'processed', `processed-${req.params.id}-${resParam}.mp4.omni`);

      const fileExists = await fs.promises.access(filePath).then(() => true).catch(() => false);
      if (!fileExists) {
        return res.status(404).json({ error: 'Video file not found' });
      }

      const stat = await fs.promises.stat(filePath);
      const fileSize = stat.size;

      // Ambil judul asli dari database
      const [videoRows]: any = await db.query('SELECT title FROM Videos WHERE id = ?', [req.params.id]);
      let safeTitle = 'Video';
      if (videoRows.length > 0 && videoRows[0].title) {
        // Sanitasi karakter ilegal untuk nama file Windows/Linux
        safeTitle = videoRows[0].title.replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
      }

      // STAGE 1.18: Track Download Event
      db.execute('UPDATE Videos SET downloads = downloads + 1 WHERE id = ?', [req.params.id]).catch(() => {});

      // Header paksaan Download (Attachment) dengan judul dinamis
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${safeTitle} - ${resParam}p.mp4"`,
      });

      let bytesRead = 0;
      const { Transform } = await import('stream');
      const deobfuscateStream = new Transform({
        transform(chunk, encoding, callback) {
          if (bytesRead < 100) {
            for (let i = 0; i < chunk.length && bytesRead < 100; i++) {
              chunk[i] ^= 0xAF;
              bytesRead++;
            }
          }
          this.push(chunk);
          callback();
        }
      });

      const dlStream = fs.createReadStream(filePath);
      dlStream.on('error', (err) => {
        console.error(`[STREAM FAIL] Gagal membaca target video untuk didownload: ${err.message}`);
        if (!res.headersSent) res.status(500).end();
      });
      dlStream.pipe(deobfuscateStream).pipe(res);
    } catch (err) {
      console.error('[DOWNLOAD ERROR]', err);
      res.status(500).end();
    }
  });

  // --- STATIC ROUTE UNTUK HLS LIVE STREAMING (.m3u8 & .ts) ---
  const liveOutDir = path.join(__dirname, 'public', 'live');
  if (!fs.existsSync(liveOutDir)) {
    fs.mkdirSync(liveOutDir, { recursive: true });
  }
  app.use('/live', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Origin, Content-Type, Accept');
    if (req.path.endsWith('.m3u8')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (req.path.endsWith('.ts')) {
      res.setHeader('Cache-Control', 'public, max-age=10');
      res.setHeader('Content-Type', 'video/mp2t');
    }
    next();
  }, express.static(liveOutDir));

  // --- API LIVE CREDENTIALS & STATUS TRACKER ---
  app.get('/api/live/status', async (req, res) => {
    const serverIp = getLocalIp();
    const room = io.sockets.adapter.rooms.get('live_stream_room');
    const viewerCount = isStreamActive ? (room ? room.size : 1) : 0;
    const streamKey = currentStreamKey || 'stream_key_wiji_hub';
    
    // Query informasi akun channel kreator asli dari database
    let creator = {
      id: currentLiveUserId || 1,
      name: 'Host Channel',
      firstName: '',
      lastName: '',
      avatarUrl: '',
      subscriberCount: 0
    };

    try {
      const [userRows]: any = await db.query(
        'SELECT id, firstName, lastName, email, avatar_url FROM Users WHERE id = ?',
        [currentLiveUserId || 1]
      );
      if (userRows && userRows.length > 0) {
        const u = userRows[0];
        const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email.split('@')[0];
        const [subRows]: any = await db.query(
          'SELECT COUNT(*) as count FROM subscriptions WHERE leader_id = ?',
          [u.id]
        );
        creator = {
          id: u.id,
          name: fullName,
          firstName: u.firstName || '',
          lastName: u.lastName || '',
          avatarUrl: u.avatar_url || '',
          subscriberCount: subRows[0]?.count || 0
        };
      }
    } catch (e) {}

    // Periksa apakah penonton yang sedang membuka sudah subscribe channel ini
    let isSubscribed = false;
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const decoded: any = jwt.verify(token, JWT_SECRET);
        if (decoded && decoded.id) {
          const [subCheck]: any = await db.query(
            'SELECT id FROM subscriptions WHERE subscriber_id = ? AND leader_id = ?',
            [decoded.id, creator.id]
          );
          isSubscribed = subCheck.length > 0;
        }
      }
    } catch (e) {}

    res.json({
      isLive: isStreamActive,
      rtmpUrl: `rtmp://${serverIp}:1935/live`,
      streamKey,
      title: currentLiveTitle,
      category: currentLiveCategory,
      description: currentLiveDescription,
      flvUrl: `/api/live/stream/${streamKey}.flv`,
      directFlvUrl: `http://${serverIp}:8005/live/${streamKey}.flv`,
      hlsUrl: `/live/${streamKey}/index.m3u8`,
      directHlsUrl: `http://${serverIp}:8005/live/${streamKey}/index.m3u8`,
      viewerCount,
      startedAt: liveStartedAt,
      videoId: currentLiveVideoId,
      creator,
      isSubscribed
    });
  });

  // --- API ACTIVE LIVE STREAMS UNTUK VIEWERS & BERANDA ---
  app.get('/api/live/active', async (req, res) => {
    const serverIp = getLocalIp();
    if (!isStreamActive) {
      return res.json({ active: false, streams: [] });
    }
    const room = io.sockets.adapter.rooms.get('live_stream_room');
    const viewerCount = isStreamActive ? (room ? room.size : 1) : 0;
    const streamKey = currentStreamKey || 'stream_key_wiji_hub';

    let creatorName = 'Host Channel';
    let firstName = '';
    let lastName = '';
    let avatarUrl = '';

    try {
      const [userRows]: any = await db.query(
        'SELECT id, firstName, lastName, email, avatar_url FROM Users WHERE id = ?',
        [currentLiveUserId || 1]
      );
      if (userRows && userRows.length > 0) {
        const u = userRows[0];
        firstName = u.firstName || '';
        lastName = u.lastName || '';
        creatorName = `${firstName} ${lastName}`.trim() || u.email.split('@')[0];
        avatarUrl = u.avatar_url || '';
      }
    } catch (e) {}

    res.json({
      active: true,
      streams: [
        {
          id: currentLiveVideoId || 999999,
          streamKey,
          title: currentLiveTitle,
          category: currentLiveCategory,
          description: currentLiveDescription,
          flvUrl: `/api/live/stream/${streamKey}.flv`,
          directFlvUrl: `http://${serverIp}:8005/live/${streamKey}.flv`,
          hlsUrl: `/live/${streamKey}/index.m3u8`,
          viewerCount,
          startedAt: liveStartedAt,
          thumbnail_url: '/thumbnails/default_live.jpg',
          firstName,
          lastName,
          creatorName,
          avatarUrl,
          userId: currentLiveUserId || 1
        }
      ]
    });
  });

  // --- API UPDATE METADATA SIARAN OLEH KREATOR ---
  app.post('/api/live/update', async (req, res) => {
    const { title, category, description, userId, streamKey } = req.body;
    if (userId && Number(userId)) currentLiveUserId = Number(userId);
    if (streamKey) currentStreamKey = String(streamKey).trim();
    if (title) currentLiveTitle = String(title).trim();
    if (category) currentLiveCategory = String(category).trim();
    if (description !== undefined) currentLiveDescription = String(description).trim();

    if (currentLiveVideoId) {
      db.query(
        'UPDATE Videos SET title = ?, description = ?, user_id = ? WHERE id = ?', 
        [currentLiveTitle, currentLiveDescription, currentLiveUserId, currentLiveVideoId]
      ).catch(() => {});
    }

    let creator = {
      id: currentLiveUserId || 1,
      name: 'Host Channel',
      avatarUrl: '',
      subscriberCount: 0
    };
    try {
      const [uRows]: any = await db.query(
        'SELECT id, firstName, lastName, email, avatar_url FROM Users WHERE id = ?', 
        [currentLiveUserId]
      );
      if (uRows && uRows[0]) {
        const u = uRows[0];
        const [subRows]: any = await db.query(
          'SELECT COUNT(*) as count FROM subscriptions WHERE leader_id = ?', 
          [u.id]
        );
        creator = {
          id: u.id,
          name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email.split('@')[0],
          avatarUrl: u.avatar_url || '',
          subscriberCount: subRows[0]?.count || 0
        };
      }
    } catch (e) {}

    io.emit('live_meta_updated', {
      title: currentLiveTitle,
      category: currentLiveCategory,
      description: currentLiveDescription,
      creator
    });

    res.json({ 
      success: true, 
      title: currentLiveTitle, 
      category: currentLiveCategory, 
      description: currentLiveDescription,
      creator
    });
  });

  // --- API REVERSE PROXY HTTP-FLV LOW-LATENCY STREAMING ---
  app.get('/api/live/stream/:streamKey.flv', (req, res) => {
    const streamKey = req.params.streamKey.replace(/[^a-zA-Z0-9_\-]/g, '');
    const nmsFlvUrl = `http://127.0.0.1:8005/live/${streamKey}.flv`;
    
    res.setHeader('Content-Type', 'video/x-flv');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'no-cache, no-store');

    const proxyReq = http.get(nmsFlvUrl, (proxyRes) => {
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: 'Live stream offline atau media server tidak aktif' });
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });
  });

  // --- API GET LIVE CHAT MESSAGES ---
  app.get('/api/live/chat', (req, res) => {
    res.json({ success: true, messages: liveChatMessages });
  });

  // --- FUNGSI PEMBERSIH CACHE SIARAN SELESAI ---
  app.post('/api/live/cleanup', (req, res) => {
    const { streamKey } = req.body;
    if (!streamKey) return res.status(400).json({ error: 'StreamKey dibutuhkan' });

    const streamFolder = path.join(__dirname, 'public', 'live', streamKey);
    
    // Hapus pecahan file .ts jika folder ada (mencegah penumpukan penyimpanan)
    if (fs.existsSync(streamFolder)) {
      fs.readdir(streamFolder, (err, files) => {
        if (!err && files) {
          files.forEach(file => {
            if (file.endsWith('.ts')) {
              fs.unlink(path.join(streamFolder, file), () => {});
            }
          });
        }
      });
    }
    res.json({ success: true, message: 'Pembersihan cache segmen berhasil.' });
  });

  // Catch-all route untuk API yang tidak ditemukan agar tidak menabrak frontend
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  if (process.env.NODE_ENV !== 'production') {
    viteServer = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0' },
      appType: 'spa',
    });
    app.use(viteServer.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.use((err: any, req: any, res: any, next: any) => {
    res.status(err.status || 500).json({
      error: true,
      message: "Terjadi gangguan pada server, tim teknis kami sedang memperbaikinya."
    });
  });

  // --- GATEWAY RTMP LIVE STREAMING (TAHAP 42) ---
  // --- MEMBUAT DIREKTORI CACHE LIVE HLS JIKA BELUM ADA ---
  const liveOutPath = path.join(__dirname, 'public', 'live');
  if (!fs.existsSync(liveOutPath)) {
      fs.mkdirSync(liveOutPath, { recursive: true });
  }

  const rtmpConfig = {
    rtmp: {
      port: 1935,
      chunk_size: 60000,
      gop_cache: true,
      ping: 30,
      ping_timeout: 60
    },
    http: {
      port: 8005,
      allow_origin: '*',
      mediaroot: path.join(__dirname, 'public')
    }
  };

  const nms = new NodeMediaServer(rtmpConfig);
  nmsServer = nms;

  // Event Tracker: Mendeteksi saat HP atau OBS mulai connect (prePublish)
  nms.on('prePublish', (sessionOrId: any) => {
    try {
      const streamKey = typeof sessionOrId === 'object' && sessionOrId !== null
        ? (sessionOrId.streamName || (sessionOrId.streamPath ? sessionOrId.streamPath.split('/').pop() : 'stream_key_wiji_hub'))
        : (typeof sessionOrId === 'string' ? sessionOrId.split('/').pop() : 'stream_key_wiji_hub');
      console.log(`[LIVE SYSTEM] ⚡ RTMP Ingestion Incoming. StreamKey: ${streamKey}`);
    } catch (e: any) {
      console.error('[LIVE PREPUBLISH ERROR]:', e.message);
    }
  });

  // Event Tracker: Mendeteksi saat OBS/Streamlabs aktif memancarkan siaran (postPublish)
  nms.on('postPublish', (sessionOrId: any, streamPathArg?: string) => {
    try {
      let streamKey = 'stream_key_wiji_hub';
      if (typeof sessionOrId === 'object' && sessionOrId !== null) {
        streamKey = sessionOrId.streamName || (sessionOrId.streamPath ? sessionOrId.streamPath.split('/').pop() : 'stream_key_wiji_hub');
      } else if (typeof streamPathArg === 'string') {
        streamKey = streamPathArg.split('/').pop() || 'stream_key_wiji_hub';
      } else if (typeof sessionOrId === 'string') {
        streamKey = sessionOrId.split('/').pop() || 'stream_key_wiji_hub';
      }

      console.log(`[LIVE SYSTEM] 🔴 LIVE ON AIR DETECTED! StreamKey: ${streamKey}`);
      isStreamActive = true;
      currentStreamKey = streamKey;
      liveStartedAt = new Date().toISOString();
      (global as any).isStreamActive = true;
      (global as any).currentStreamKey = streamKey;

      // 1. Setup direktori HLS live playlist
      const streamFolder = path.join(__dirname, 'public', 'live', streamKey);
      if (!fs.existsSync(streamFolder)) {
        fs.mkdirSync(streamFolder, { recursive: true });
      }
      const hlsPlaylist = path.join(streamFolder, 'index.m3u8');

      // Bersihkan proses transcode ffmpeg sebelumnya jika ada
      if (ffmpegLiveProcess) {
        try { ffmpegLiveProcess.kill(); } catch (e) {}
        ffmpegLiveProcess = null;
      }

      // 2. Jalankan FFmpeg untuk membuat low-latency HLS (.m3u8 & .ts) dari RTMP lokal
      try {
        console.log(`[FFMPEG HLS] Menjalankan HLS segmenter untuk ${streamKey}...`);
        ffmpegLiveProcess = spawn('ffmpeg', [
          '-y',
          '-i', `rtmp://127.0.0.1:1935/live/${streamKey}`,
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-f', 'hls',
          '-hls_time', '2',
          '-hls_list_size', '4',
          '-hls_flags', 'delete_segments',
          hlsPlaylist
        ], {
          windowsHide: true
        });

        ffmpegLiveProcess.stderr?.on('data', (d: Buffer) => {
          const s = d.toString();
          if (s.includes('Error') || s.includes('error')) {
            console.error('[FFMPEG HLS WARNING]', s.trim());
          }
        });

        ffmpegLiveProcess.on('exit', (code: number | null) => {
          console.log(`[FFMPEG HLS] HLS process selesai dengan kode: ${code}`);
          ffmpegLiveProcess = null;
        });
      } catch (ffErr: any) {
        console.error('[FFMPEG HLS ERROR]:', ffErr.message);
      }

      // 3. Daftarkan siaran langsung ke tabel database Videos MySQL
      const hlsPlayUrl = `/live/${streamKey}/index.m3u8`;
      const defaultThumb = '/thumbnails/default_live.jpg';
      const liveTitle = currentLiveTitle || `Live Stream - ${new Date().toLocaleString('id-ID')}`;
      const liveDesc = currentLiveDescription || 'Siaran langsung resmi dari OmniHub Live Studio';
      
      const keyMatch = streamKey.match(/^stream_key_(\d+)$/);
      if (keyMatch) {
        currentLiveUserId = parseInt(keyMatch[1], 10);
      }
      const hostUserId = currentLiveUserId || 1;

      const sqlInsert = `
        INSERT INTO Videos (user_id, title, description, url, thumbnail_url, status, category_id, created_at) 
        VALUES (?, ?, ?, ?, ?, 'live', 1, NOW())
      `;
      
      db.query(sqlInsert, [hostUserId, liveTitle, liveDesc, hlsPlayUrl, defaultThumb])
        .then((result: any) => {
          currentLiveVideoId = result[0]?.insertId;
          console.log(`[DATABASE] ✅ Live Stream terdaftar di database dengan Video ID: ${currentLiveVideoId} untuk User ID: ${hostUserId}`);
        })
        .catch((err: any) => {
          console.error('[DATABASE ERROR] Gagal mendaftarkan Live Stream:', err.message);
        });

      // Ambil informasi akun channel kreator dari DB untuk WebSocket broadcast
      db.query('SELECT id, firstName, lastName, email, avatar_url FROM Users WHERE id = ?', [hostUserId])
        .then(async ([userRows]: any) => {
          let creatorInfo = {
            id: hostUserId,
            name: 'Host Channel',
            avatarUrl: '',
            subscriberCount: 0
          };
          if (userRows && userRows.length > 0) {
            const u = userRows[0];
            const [subRows]: any = await db.query('SELECT COUNT(*) as count FROM subscriptions WHERE leader_id = ?', [u.id]);
            creatorInfo = {
              id: u.id,
              name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email.split('@')[0],
              avatarUrl: u.avatar_url || '',
              subscriberCount: subRows[0]?.count || 0
            };
          }

          // 4. Siarkan notifikasi status live seketika via WebSocket ke seluruh client
          io.emit('live_status_change', {
            isLive: true,
            streamKey,
            title: liveTitle,
            category: currentLiveCategory,
            description: liveDesc,
            startedAt: liveStartedAt,
            flvUrl: `/api/live/stream/${streamKey}.flv`,
            hlsUrl: `/live/${streamKey}/index.m3u8`,
            creator: creatorInfo
          });
        })
        .catch(() => {
          io.emit('live_status_change', {
            isLive: true,
            streamKey,
            title: liveTitle,
            category: currentLiveCategory,
            description: liveDesc,
            startedAt: liveStartedAt,
            flvUrl: `/api/live/stream/${streamKey}.flv`,
            hlsUrl: `/live/${streamKey}/index.m3u8`
          });
        });

      if (typeof (global as any).renderDashboard === 'function') (global as any).renderDashboard();
      else if (typeof (global as any).drawInterface === 'function') (global as any).drawInterface();
    } catch (err: any) {
      console.error('[LIVE POSTPUBLISH ERROR]:', err);
    }
  });

  // Event Tracker: Mendeteksi saat OBS/Streamlabs berhenti siaran (donePublish)
  nms.on('donePublish', (sessionOrId: any, streamPathArg?: string) => {
    try {
      let streamKey = currentStreamKey || 'stream_key_wiji_hub';
      if (typeof sessionOrId === 'object' && sessionOrId !== null) {
        streamKey = sessionOrId.streamName || (sessionOrId.streamPath ? sessionOrId.streamPath.split('/').pop() : streamKey);
      } else if (typeof streamPathArg === 'string') {
        streamKey = streamPathArg.split('/').pop() || streamKey;
      } else if (typeof sessionOrId === 'string') {
        streamKey = sessionOrId.split('/').pop() || streamKey;
      }

      console.log(`[LIVE SYSTEM] ⏹️ Siaran langsung berhenti. StreamKey: ${streamKey}`);
      isStreamActive = false;

      // 1. Hentikan FFmpeg transcode proses
      if (ffmpegLiveProcess) {
        try {
          ffmpegLiveProcess.kill();
        } catch (e) {}
        ffmpegLiveProcess = null;
      }

      // 2. Arsipkan video di database dari 'live' menjadi 'ready' (VOD Replay)
      if (currentLiveVideoId) {
        const sqlUpdate = `UPDATE Videos SET status = 'ready' WHERE id = ?`;
        db.query(sqlUpdate, [currentLiveVideoId])
          .then(() => {
            console.log(`[DATABASE] ✅ Live Stream ID: ${currentLiveVideoId} berhasil diarsipkan menjadi VOD (status: ready)!`);
            currentLiveVideoId = null;
          })
          .catch((err: any) => {
            console.error('[DATABASE ERROR] Gagal arsipkan live stream:', err.message);
          });
      }

      // 3. Siarkan ke seluruh web client bahwa siaran telah berakhir
      io.emit('live_status_change', {
        isLive: false,
        streamKey
      });

      currentStreamKey = '';
      (global as any).isStreamActive = false;
      (global as any).currentStreamKey = '';

      if (typeof (global as any).renderDashboard === 'function') (global as any).renderDashboard();
      else if (typeof (global as any).drawInterface === 'function') (global as any).drawInterface();
    } catch (err: any) {
      console.error('[LIVE DONEPUBLISH ERROR]:', err);
    }
  });

  // Jalankan Media Server di background
  nms.run();

  // --- PERSISTENT QUEUE RECOVERY ON BOOT (STAGE 1.7) ---
  const recoverUnfinishedQueue = async () => {
    try {
      const [pendingVideos]: any = await db.query(
        "SELECT id, url, title, upload_id FROM Videos WHERE status IN ('waiting', 'processing')"
      );
      if (pendingVideos && pendingVideos.length > 0) {
        console.log(`[RECOVERY] Menemukan ${pendingVideos.length} video belum selesai. Memasukkan kembali ke antrean...`);
        for (const vid of pendingVideos) {
          const fileName = vid.url ? path.basename(vid.url) : `${vid.upload_id}_${vid.title}`;
          const targetPath = path.join(UPLOAD_DIR, fileName);
          if (fs.existsSync(targetPath)) {
            ffmpegTranscodeQueue.push(() => processVideo(vid.id, targetPath, vid.title, vid.upload_id));
          }
        }
        processNextInFFmpegQueue();
      }
    } catch (err) {
      console.error('[RECOVERY ERROR] Gagal memulihkan antrean video dari database:', err);
    }
  };

  const PORT = Number(process.env.APP_PORT) || 3000;
  server.listen(PORT, '0.0.0.0', async () => {
    // Mulai render UI Terminal Sticky Dashboard (btop-style)
    startCliMonitor();
    console.log(`[SYSTEM] Server OmniHub berjalan di port ${PORT}`);

    // Inisialisasi status Gaming Mode dari database pada saat boot
    isGamingModeActive = await getGamingModeFromDB();
    console.log(`[SYSTEM] Status Gaming Mode saat ini: ${isGamingModeActive ? '🎮 AKTIF (Antrean Dijeda)' : '⚡ NON-AKTIF (Antrean Berjalan)'}`);

    // Adaptive interval pemantau antrean video (10s idle, 1s saat busy)
    const scheduleQueuePoll = () => {
      const isSystemBusy = isTranscodingActive || isStreamActive;
      const intervalMs = isSystemBusy ? 1000 : 10000;
      queuePollingInterval = setTimeout(() => {
        if (!isTranscodingActive && !isGamingModeActive) {
          processNextInFFmpegQueue();
        }
        scheduleQueuePoll();
      }, intervalMs);
    };
    scheduleQueuePoll();

    // Binding Terminal Hotkeys (1: Clear Cache, 2: Toggle Gaming Mode, 3: Restart Queue)
    (global as any).toggleGamingMode = async () => {
      const targetState = !isGamingModeActive;
      await setGamingModeInDB(targetState);
      io.emit('gaming_mode_updated', {
        gaming_mode: isGamingModeActive,
        isTranscodingActive
      });
      console.log(`[GAMING MODE] 🎮 Status Gaming Mode: ${isGamingModeActive ? 'AKTIF (Queue Paused)' : 'NON-AKTIF (Queue Resumed)'}`);
      if (!isGamingModeActive) {
        setImmediate(processNextInFFmpegQueue);
      }
    };

    (global as any).restartQueue = () => {
      console.log('[SMART QUEUE] 🔄 Mereset antrean video dan memulai ulang transcode...');
      isTranscodingActive = false;
      queuedOrActiveVideos.clear();
      setImmediate(processNextInFFmpegQueue);
    };

    (global as any).clearCache = async () => {
      console.log('[CACHE] 🧹 Memulai pembersihan berkas temporary dan cache siaran...');
      try {
        const liveDir = path.join(__dirname, 'public', 'live');
        if (fs.existsSync(liveDir)) {
          const keys = await fs.promises.readdir(liveDir);
          for (const k of keys) {
            const p = path.join(liveDir, k);
            const files = await fs.promises.readdir(p).catch(() => []);
            for (const f of files) {
              if (f.endsWith('.ts')) {
                await fs.promises.unlink(path.join(p, f)).catch(() => {});
              }
            }
          }
        }
        console.log('[CACHE] ✅ Pembersihan berkas cache berhasil.');
      } catch (err: any) {
        console.error('[CACHE ERROR]:', err?.message || err);
      }
    };

    if (!isGamingModeActive) {
      setImmediate(processNextInFFmpegQueue);
    }
  });
}

// --- ROBOT PEMBERSIH ARSIP OTOMATIS (14 DAYS RETENTION) ---
async function runArchiveCleanup() {
  try {
    const [expiredVideos]: any = await db.query('SELECT * FROM videos_deleted WHERE expires_at <= NOW()');
    
    if (expiredVideos.length > 0) {
      console.log(`[CLEANUP] Menemukan ${expiredVideos.length} video kedaluwarsa. Memulai pembersihan permanen...`);
      
      for (const video of expiredVideos) {
        // Hapus fisik folder YYYY/MM/DD/ID (Asynchronous I/O to prevent Event Loop blocking)
        if (video.archive_path && fs.existsSync(video.archive_path)) {
          await fs.promises.rm(video.archive_path, { recursive: true, force: true }).catch(() => {});
        }
        // Hapus baris dari database
        await db.query('DELETE FROM videos_deleted WHERE archive_id = ?', [video.archive_id]);
      }
      console.log('[CLEANUP] Pembersihan permanen selesai.');
    }
  } catch (err) {
    console.error('[CLEANUP ERROR]:', err);
  }
}

// --- ZOMBIE CHUNK SWEEPER (24 HOURS RETENTION) ---
async function runChunkCleanup() {
  try {
    const now = Date.now();
    const files = await fs.promises.readdir(CHUNK_DIR);
    let deletedCount = 0;
    for (const file of files) {
      const filePath = path.join(CHUNK_DIR, file);
      const stats = await fs.promises.stat(filePath);
      // STAGE 1.24: Aggressive retention, delete if older than 3 hours
      if (now - stats.mtimeMs > 3 * 60 * 60 * 1000) {
        await fs.promises.unlink(filePath).catch(() => {});
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      console.log(`[CLEANUP] Berhasil menghapus ${deletedCount} file chunk usang (zombie chunks).`);
    }
  } catch (err) {
    console.error('[CLEANUP ERROR] Gagal membersihkan zombie chunks:', err);
  }
}
chunkCleanupInterval = setInterval(runChunkCleanup, 60 * 60 * 1000); // STAGE 1.24: Run every 1 hour

// Jalankan pembersihan saat server menyala pertama kali
initialArchiveTimeout = setTimeout(runArchiveCleanup, 5000); // Tunggu 5 detik setelah boot
// Jadwalkan pembersihan setiap 12 Jam (12 * 60 * 60 * 1000 ms)
archiveCleanupInterval = setInterval(runArchiveCleanup, 43200000);
// ----------------------------------------------------------

// --- OPTIMALISASI GRACEFUL SHUTDOWN & PEMULIHAN TERMINAL ---
let isShuttingDown = false;

async function performGracefulShutdown(isRestart = false) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  (global as any).isShuttingDown = true;

  // Failsafe Timeout: Maksimal 2 detik agar proses server tidak pernah tersangkut
  const failsafeTimeout = setTimeout(() => {
    try { stopCliMonitor(); } catch (e) {}
    try { restoreServerConsole(); } catch (e) {}
    try { restoreTerminal(); } catch (e) {}
    process.exit(isRestart ? 42 : 0);
  }, 2000);
  failsafeTimeout.unref();

  try {
    // 0. Hentikan monitor sticky dashboard
    try { stopCliMonitor(); } catch (e) {}

    // 1. Matikan proses ffmpeg live stream jika aktif
    if (ffmpegLiveProcess) {
      try {
        ffmpegLiveProcess.kill('SIGKILL');
      } catch (e) {}
      ffmpegLiveProcess = null;
    }

    // 2. Bersihkan timer / interval background
    if (speedCheckInterval) clearInterval(speedCheckInterval);
    if (chunkCleanupInterval) clearInterval(chunkCleanupInterval);
    if (archiveCleanupInterval) clearInterval(archiveCleanupInterval);
    if (initialArchiveTimeout) clearTimeout(initialArchiveTimeout);
    if (queuePollingInterval) clearTimeout(queuePollingInterval);

    // 3. Hentikan Node Media Server jika aktif
    if (nmsServer && typeof nmsServer.stop === 'function') {
      try {
        nmsServer.stop();
      } catch (e) {}
    }

    // 4. Tutup Socket.IO
    if (io && typeof io.close === 'function') {
      try {
        io.close();
      } catch (e) {}
    }

    // 5. Tutup HTTP Server Express
    if (server && typeof server.close === 'function') {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    // 6. Tutup Vite Server jika aktif
    if (viteServer && typeof viteServer.close === 'function') {
      try {
        await viteServer.close();
      } catch (e) {}
    }

    // 7. Tutup koneksi Database MySQL pool
    try {
      await db.end();
    } catch (e) {}
  } catch (err: any) {
    // Abaikan error saat cleanup agar proses keluar tidak terhambat
  } finally {
    clearTimeout(failsafeTimeout);
    try { stopCliMonitor(); } catch (e) {}
    try { restoreServerConsole(); } catch (e) {}
    try { restoreTerminal(); } catch (e) {}

    if (isRestart) {
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
    } else {
      console.log('\n[SYSTEM] ✅ Server OmniHub berhasil dimatikan secara optimal.');
      console.log('[SYSTEM] Terminal Anda telah dikembalikan ke kondisi normal.');
      process.exit(0);
    }
  }
}

(global as any).gracefulShutdown = () => performGracefulShutdown(false);
(global as any).gracefulRestart = () => performGracefulShutdown(true);

process.on('SIGINT', () => performGracefulShutdown(false));
process.on('SIGTERM', () => performGracefulShutdown(false));

startServer();
