import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function envStr(name, fallback = '') {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function envInt(name, fallback) {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
}

const nodeEnv = envStr('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';
// Môi trường development: hiện chi tiết lỗi (stack, file:dòng) dưới dạng toast + popup.
// Chỉ bật khi NODE_ENV=development (mặc định khi không đặt NODE_ENV).
const isDevelopment = nodeEnv === 'development';

// Thư mục gốc của project, không phụ thuộc vào nơi chạy lệnh `node`.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function generateSecret(prefix) {
  return `${prefix}-dev-${crypto.randomUUID()}${crypto.randomUUID()}`;
}

export const config = {
  env: nodeEnv,
  isProduction,
  isDevelopment,
  isTest,
  rootDir,
  port: envInt('PORT', 3000),
  host: '0.0.0.0',
  appUrl: envStr('APP_URL', `http://localhost:${envInt('PORT', 3000)}`),

  storageProvider: envStr('STORAGE_PROVIDER', 'memory'),

  // Production bat buoc co secret that; dev cho phep tu sinh de tien loi.
  sessionSecret: envStr('SESSION_SECRET', '') || generateSecret('session'),
  csrfSecret: envStr('CSRF_SECRET', '') || generateSecret('csrf'),

  sessionTtlMs: envInt('SESSION_TTL_HOURS', 168) * 3600 * 1000,
  sessionIdleMs: 7 * 24 * 3600 * 1000,

  bcryptRounds: Math.min(15, Math.max(4, envInt('BCRYPT_ROUNDS', 12))),

  rateLimits: {
    auth: envInt('RATE_LIMIT_LOGIN_MAX', 10),
    authWindowMs: 15 * 60 * 1000,
    register: envInt('RATE_LIMIT_REGISTER_MAX', 10),
    api: envInt('RATE_LIMIT_API_MAX', 300),
    apiWindowMs: 60 * 1000,
    share: envInt('RATE_LIMIT_SHARE_MAX', 60),
    shareWindowMs: 60 * 1000,
  },

  limits: {
    // Gioi han size de bao ve RAM (bytes + so luong)
    jsonBodyBytes: 512 * 1024,
    // Tệp sao lưu/khôi phục của admin (mặc định 30 MB, chỉnh bằng IMPORT_MAX_MB).
    importBodyBytes: Math.max(1, envInt('IMPORT_MAX_MB', 30)) * 1024 * 1024,
    diagramNameLength: 120,
    usernameMin: 3,
    usernameMax: 32,
    emailMax: 254,
    passwordMin: 8,
    passwordMax: 128,
    maxElements: 2000,
    maxDepth: 8,
    maxStyleKeys: 32,
    shareTokenBytes: 32,
  },

  firebase: {
    projectId: envStr('FIREBASE_PROJECT_ID'),
    clientEmail: envStr('FIREBASE_CLIENT_EMAIL'),
    privateKey: envStr('FIREBASE_PRIVATE_KEY').replaceAll('\\n', '\n'),
    storageBucket: envStr('FIREBASE_STORAGE_BUCKET'),
  },
};

if (isProduction) {
  if (!envStr('SESSION_SECRET')) {
    // Render co the generateValue; neu van thieu thi tu sinh moi lan khoi dong
    // (session se mat khi restart — nhu MemoryStore da ghi ro trong README).
    console.warn('[config] SESSION_SECRET missing in production; generated ephemeral secret.');
  }
}
