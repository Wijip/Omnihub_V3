import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn, spawnSync, execSync } from 'child_process';
import os from 'os';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCK_FILE = path.join(__dirname, '.omnihub-setup-done');
const ENV_FILE = path.join(__dirname, '.env');
const DOCKER_FILE = path.join(__dirname, 'docker-compose.yml');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise(resolve => rl.question(query, resolve));

async function checkGPU() {
  try {
    const output = execSync('nvidia-smi --query-gpu=name --format=csv,noheader', { encoding: 'utf8', stdio: 'pipe' });
    return output.trim();
  } catch (e) {
    return 'No NVIDIA GPU Detected / nvidia-smi not found';
  }
}

async function testMySQLConnection(user, password) {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: user,
      password: password
    });
    await connection.end();
    return true;
  } catch (error) {
    console.error(`\n[ERROR] Koneksi Gagal: ${error.message}`);
    return false;
  }
}

async function createDatabaseIfNotExists(user, password, dbName) {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: user,
      password: password
    });
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
    console.log(`\n[SUCCESS] Database '${dbName}' dipastikan tersedia.`);
    await connection.end();
    return true;
  } catch (error) {
    console.error(`\n[ERROR] Gagal membuat database: ${error.message}`);
    return false;
  }
}

async function runSetup() {
  while (true) {
    console.log("\n============================================================");
    console.log("              OMNIHUB INSTALLATION WIZARD                   ");
    console.log("============================================================");
    console.log(`OS Detected: ${os.type()} ${os.release()} (${os.arch()})`);
    const gpu = await checkGPU();
    console.log(`GPU Detected: ${gpu}\n`);

    console.log("[INFORMASI PENTING SEBELUM MEMULAI]");
    console.log("- Mode Docker: Memerlukan Docker, Docker-Compose, & NVIDIA Container Toolkit.");
    console.log("- Mode Monolitik: Memerlukan Node.js v18+, MySQL Server, dan FFmpeg terinstal.\n");

    console.log("Pilih opsi menu:");
    console.log("1. Setup Docker (Fully Containerized + Auto MySQL)");
    console.log("2. Setup Monolithic (Bare-Metal Local Node.js + Local MySQL)");
    console.log("3. Test Koneksi MySQL Lokal (Diagnostik)");
    console.log("4. Keluar dari Setup");
    
    let mode = await question("\nPilih (1/2/3/4): ");

    if (mode === '4') {
      console.log("Setup dibatalkan. Keluar...");
      rl.close();
      process.exit(0);
    }

    if (mode === '3') {
      console.log("\n--- TEST KONEKSI MYSQL LOKAL ---");
      const dbUser = await question("Masukkan Username MySQL: ");
      const dbPass = await question("Masukkan Password MySQL: ");
      console.log("Mencoba terhubung ke MySQL...");
      const success = await testMySQLConnection(dbUser, dbPass);
      if (success) {
        console.log("\n[SUCCESS] Koneksi Berhasil! Kredensial MySQL Anda valid.");
      }
      await question("\nTekan Enter untuk kembali ke Menu Utama...");
      continue;
    }

    if (mode === '1' || mode === '2') {
      console.log("\n--- KONFIGURASI DATABASE ---");
      let dbName = await question("Masukkan Nama Database [Tekan Enter untuk default: omnihub_db]: ");
      if (!dbName.trim()) dbName = 'omnihub_db';

      let dbUser = '';
      while (!dbUser.trim()) {
        dbUser = await question("Masukkan Username MySQL (Wajib diisi): ");
      }

      let dbPass = '';
      while (!dbPass.trim()) {
        dbPass = await question("Masukkan Password MySQL (Wajib diisi): ");
      }

      if (mode === '2') {
        console.log("\nMemverifikasi kredensial dan menyiapkan database otomatis...");
        const connectionValid = await createDatabaseIfNotExists(dbUser.trim(), dbPass.trim(), dbName.trim());
        if (!connectionValid) {
          console.log("[GAGAL] Setup dibatalkan karena koneksi MySQL ditolak. Silakan periksa kredensial Anda.");
          await question("\nTekan Enter untuk kembali ke Menu Utama...");
          continue;
        }
      }

      // Create .env
      const envContent = `
DB_HOST=${mode === '1' ? 'mysql_db' : 'localhost'}
DB_USER=${dbUser.trim()}
DB_PASS=${dbPass.trim()}
DB_NAME=${dbName.trim()}
APP_PORT=3000
JWT_SECRET=OmniHub_Super_Secret_Key_2026_!@#_Permanent_Lock
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
`;
      fs.writeFileSync(ENV_FILE, envContent.trim());
      console.log("\n[SUCCESS] File .env berhasil di-generate.");

      if (mode === '1') {
        const dockerCompose = `
version: '3.8'
services:
  omnihub_app:
    build: .
    ports:
      - "3000:3000"
      - "1935:1935"
      - "8005:8005"
    environment:
      - DB_HOST=mysql_db
      - DB_USER=${dbUser.trim()}
      - DB_PASS=${dbPass.trim()}
      - DB_NAME=${dbName.trim()}
    depends_on:
      - mysql_db
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu, video]

  mysql_db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: ${dbPass.trim()}
      MYSQL_DATABASE: ${dbName.trim()}
      MYSQL_USER: ${dbUser.trim()}
      MYSQL_PASSWORD: ${dbPass.trim()}
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql

volumes:
  mysql_data:
`;
        fs.writeFileSync(DOCKER_FILE, dockerCompose.trim());
        console.log("[SUCCESS] File docker-compose.yml berhasil di-generate dengan binding NVENC GPU.");
      }

      // Create Lock File
      fs.writeFileSync(LOCK_FILE, "SETUP_COMPLETED=true\nMODE=" + (mode === '1' ? 'DOCKER' : 'MONOLITHIC'));
      console.log("\n[SUCCESS] Setup OmniHub Selesai! Mengunci konfigurasi...");
      console.log("Menjalankan server sekarang...\n");
      rl.close();
      startApp(mode === '1' ? 'DOCKER' : 'MONOLITHIC');
      break; 
    }
  }
}

function resetTerminal() {
  try {
    if (process.stdout.isTTY) {
      process.stdout.write(
        '\x1b[?1049l\x1b[?47l\x1b[?1l\x1b>\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[0m\r\n'
      );
    }
    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch (e) {}
      try { process.stdin.pause(); } catch (e) {}
    }
  } catch (e) {}
}

process.on('exit', resetTerminal);
process.on('SIGINT', () => {
  resetTerminal();
  process.exit(0);
});

async function startApp(mode) {
  if (mode === 'DOCKER') {
    console.log("Menjalankan Docker Compose di background...");
    spawnSync('docker-compose', ['up', '-d'], { stdio: 'inherit', shell: true });
    console.log("\n[SYSTEM] OmniHub berjalan di Docker! Akses http://localhost:3000");
  } else {
    const isWin = process.platform === 'win32';
    const npxCmd = isWin ? 'npx.cmd' : 'npx';

    while (true) {
      console.log("Menjalankan server Node.js Monolitik menggunakan tsx...");
      const childEnv = { ...process.env, OMNIHUB_SUPERVISOR: '1' };

      const exitCode = await new Promise((resolve) => {
        const child = spawn(npxCmd, ['tsx', 'server.ts'], {
          stdio: 'inherit',
          shell: isWin,
          env: childEnv
        });

        const forwardSigInt = () => {
          try { child.kill('SIGINT'); } catch (e) {}
        };
        process.on('SIGINT', forwardSigInt);

        child.on('exit', (code) => {
          process.removeListener('SIGINT', forwardSigInt);
          resolve(code ?? 0);
        });

        child.on('error', (err) => {
          process.removeListener('SIGINT', forwardSigInt);
          console.error('[SUPERVISOR ERROR]: Gagal menjalankan proses server:', err.message);
          resolve(1);
        });
      });

      // Kembalikan terminal ke kondisi bersih seketika setelah child exit
      resetTerminal();

      // Exit code 42 menandakan restart yang dipicu oleh shortcut tombol 4 pada dashboard
      if (exitCode === 42) {
        console.log("\n============================================================");
        console.log("[SYSTEM] 🔄 Memulai ulang (Restarting) OmniHub Server...");
        console.log("============================================================\n");
        continue;
      }
      break;
    }

    resetTerminal();
  }
}

// MAIN ENTRY POINT
if (!fs.existsSync(LOCK_FILE)) {
  runSetup();
} else {
  const lockData = fs.readFileSync(LOCK_FILE, 'utf-8');
  const mode = lockData.includes('MODE=DOCKER') ? 'DOCKER' : 'MONOLITHIC';
  startApp(mode);
}
