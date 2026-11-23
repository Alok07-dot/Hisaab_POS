'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
let envLoaded = false;

function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parseEnv(content) {
  const out = {};
  String(content || '').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const idx = normalized.indexOf('=');
    if (idx <= 0) return;
    const key = normalized.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    let value = normalized.slice(idx + 1).trim();
    value = stripQuotes(value);
    out[key] = value;
  });
  return out;
}

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const parsed = parseEnv(fs.readFileSync(filePath, 'utf8'));
    Object.keys(parsed).forEach((key) => {
      // Never override variables already provided by the runtime/host.
      if (process.env[key] === undefined) process.env[key] = parsed[key];
    });
  } catch (err) {
    console.warn('[CONFIG] Could not load env file: ' + path.basename(filePath) + ' (' + err.message + ')');
  }
}

function resolveRuntimeEnv() {
  const raw = String(process.env.APP_ENV || process.env.NODE_ENV || 'development').trim().toLowerCase();
  if (raw === 'prod') return 'production';
  if (raw === 'stage' || raw === 'staging') return 'staging';
  return raw || 'development';
}

function loadEnvFiles() {
  if (envLoaded) return;
  envLoaded = true;
  const env = resolveRuntimeEnv();
  const files = ['.env', '.env.local'];
  if (env === 'production') files.push('.env.production', '.env.production.local');
  else if (env === 'test') files.push('.env.test', '.env.test.local');
  else files.push('.env.development', '.env.development.local');
  files.forEach((name) => loadEnvFile(path.join(ROOT_DIR, name)));
}

loadEnvFiles();

const runtimeEnv = resolveRuntimeEnv();
const isProduction = runtimeEnv === 'production';
const isTest = runtimeEnv === 'test';
const isDevelopment = !isProduction && !isTest;

function env(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return String(value);
}

function boolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return !!fallback;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return !!fallback;
}

const INSECURE_ADMIN_PASSWORDS = new Set(['admin@12345', 'Admin@12345', 'changeme', 'password', '12345678']);
const DEFAULT_MOCK_SIGNING_SECRET = 'hisaab_dev_signing_secret_change_me';

function paymentConfig() {
  const keyId = env('RAZORPAY_KEY_ID', '').trim();
  const keySecret = env('RAZORPAY_KEY_SECRET', '').trim();
  const webhookSecret = env('RAZORPAY_WEBHOOK_SECRET', '').trim();
  const mockSigningSecret = env('PAYMENT_SIGNING_SECRET', '');
  const allowMockInProduction = boolEnv('ALLOW_MOCK_PAYMENTS', false) || boolEnv('ALLOW_MOCK_PAYMENTS_IN_PRODUCTION', false);
  const hasAnyRazorpay = !!(keyId || keySecret || webhookSecret);
  const razorpayConfigured = !!(keyId && keySecret);
  const provider = razorpayConfigured ? 'razorpay' : 'mock';
  return {
    keyId,
    keySecret,
    webhookSecret,
    mockSigningSecret: mockSigningSecret || DEFAULT_MOCK_SIGNING_SECRET,
    mockSigningSecretIsDefault: !mockSigningSecret || mockSigningSecret === DEFAULT_MOCK_SIGNING_SECRET,
    allowMockInProduction,
    hasAnyRazorpay,
    razorpayConfigured,
    provider
  };
}

function dataDir() {
  const configured = process.env.HISAAB_DATA_DIR;
  return configured ? path.resolve(configured) : path.join(ROOT_DIR, 'data');
}

function isStrongSecret(value) {
  const v = String(value || '');
  if (v.length < 12) return false;
  if (INSECURE_ADMIN_PASSWORDS.has(v)) return false;
  // Require some complexity to avoid trivial provisioning secrets.
  const classes = [/[a-z]/.test(v), /[A-Z]/.test(v), /[0-9]/.test(v), /[^A-Za-z0-9]/.test(v)].filter(Boolean).length;
  return classes >= 2;
}

function adminConfig() {
  const adminEmail = env('ADMIN_EMAIL', 'admin@hisaab.local');
  const adminPassword = env('ADMIN_PASSWORD', '');
  const adminName = env('ADMIN_NAME', 'Hisaab Admin');
  const superAdminEmail = env('SUPER_ADMIN_EMAIL', '') || adminEmail || 'owner@hisaab.local';
  const superAdminPassword = env('SUPER_ADMIN_PASSWORD', '') || adminPassword;
  const superAdminName = env('SUPER_ADMIN_NAME', 'Platform Owner');
  const resetSuperAdminPassword = boolEnv('RESET_SUPER_ADMIN_PASSWORD', false) || boolEnv('SUPER_ADMIN_PASSWORD_RESET', false);
  const explicitSuperProvided = !!env('SUPER_ADMIN_PASSWORD', '');
  const explicitAdminProvided = !!env('ADMIN_PASSWORD', '');
  return {
    adminEmail,
    adminPassword,
    adminName,
    superAdminEmail,
    superAdminPassword,
    superAdminName,
    resetSuperAdminPassword,
    adminPasswordProvided: explicitAdminProvided,
    superAdminPasswordProvided: explicitSuperProvided || explicitAdminProvided,
    superAdminPasswordExplicitlyProvided: explicitSuperProvided,
    devAdminPassword: 'Admin@12345'
  };
}

function superAdminStoreState() {
  const file = path.join(dataDir(), 'super-admin-users.json');
  try {
    if (!fs.existsSync(file)) return { exists: false, hasOwner: false, file };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const users = Array.isArray(parsed && parsed.users) ? parsed.users : [];
    const hasOwner = users.some((u) => u && u.role === 'owner' && u.status !== 'disabled');
    return { exists: true, hasOwner, file };
  } catch (e) {
    // If unreadable/corrupt, treat as requiring explicit provisioning attention.
    return { exists: true, hasOwner: false, unreadable: true, file };
  }
}

function saasAdminStoreState() {
  const file = path.join(dataDir(), 'saas.json');
  try {
    if (!fs.existsSync(file)) return { exists: false, hasAdmin: false, file };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const accounts = Array.isArray(parsed && parsed.accounts) ? parsed.accounts : [];
    const hasAdmin = accounts.some((a) => a && a.role === 'admin');
    return { exists: true, hasAdmin, file };
  } catch (e) {
    return { exists: true, hasAdmin: false, unreadable: true, file };
  }
}

function supabasePublicConfig() {
  // Public (anon) client config — safe to expose to frontend when RLS is enforced.
  // Never read or expose SUPABASE_SERVICE_ROLE_KEY here.
  const url = env('SUPABASE_URL', '') || env('VITE_SUPABASE_URL', '');
  const anonKey = env('SUPABASE_ANON_KEY', '') || env('VITE_SUPABASE_ANON_KEY', '');
  return {
    url: String(url || '').trim(),
    anonKey: String(anonKey || '').trim(),
    configured: !!(String(url || '').trim() && String(anonKey || '').trim())
  };
}

function collectProductionIssues() {
  const issues = [];
  const admin = adminConfig();
  const pay = paymentConfig();
  const saState = superAdminStoreState();
  const saasState = saasAdminStoreState();

  // SaaS/admin bootstrap account: require secure credentials for initial provisioning.
  // Existing admin accounts are preserved to avoid unexpected lockout on restart.
  if (!saasState.hasAdmin) {
    if (!admin.adminPasswordProvided) {
      issues.push('Initial SaaS admin provisioning requires ADMIN_PASSWORD to be set (server-only, strong, non-default).');
    } else if (INSECURE_ADMIN_PASSWORDS.has(String(admin.adminPassword)) || !isStrongSecret(admin.adminPassword)) {
      issues.push('ADMIN_PASSWORD must be a strong, non-default secret (minimum 12 characters with mixed character types) for initial provisioning.');
    }
  } else if (admin.adminPasswordProvided && (INSECURE_ADMIN_PASSWORDS.has(String(admin.adminPassword)) || !isStrongSecret(admin.adminPassword))) {
    issues.push('ADMIN_PASSWORD, when provided, must be a strong, non-default secret (minimum 12 characters with mixed character types).');
  }

  // Super Admin provisioning/reset: preserve existing legitimate accounts and do
  // not lock out authorized administrators on restart. Require secure env
  // credentials for initial provisioning (no existing owner) or for an explicit reset.
  if (!saState.hasOwner) {
    if (!admin.superAdminPasswordProvided) {
      issues.push('Initial Super Admin provisioning requires SUPER_ADMIN_PASSWORD (or ADMIN_PASSWORD) to be set to a strong, server-side secret. No default credentials are allowed in production.');
    } else if (INSECURE_ADMIN_PASSWORDS.has(String(admin.superAdminPassword))) {
      issues.push('SUPER_ADMIN_PASSWORD is insecure/weak; provide a strong secret via environment variable for initial provisioning.');
    } else if (!isStrongSecret(admin.superAdminPassword)) {
      issues.push('SUPER_ADMIN_PASSWORD must be a strong secret (minimum 12 characters with mixed character types) for initial provisioning.');
    }
  } else if (admin.resetSuperAdminPassword) {
    if (!admin.superAdminPasswordProvided) {
      issues.push('RESET_SUPER_ADMIN_PASSWORD is set but no SUPER_ADMIN_PASSWORD (or ADMIN_PASSWORD) was provided. Set a strong new secret to reset the existing Super Admin password.');
    } else if (INSECURE_ADMIN_PASSWORDS.has(String(admin.superAdminPassword)) || !isStrongSecret(admin.superAdminPassword)) {
      issues.push('RESET_SUPER_ADMIN_PASSWORD requires a strong, non-default SUPER_ADMIN_PASSWORD (minimum 12 characters with mixed character types).');
    }
  }

  if (pay.provider === 'mock') {
    if (!pay.allowMockInProduction) {
      issues.push('Payment provider resolves to MOCK in production. Configure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (and RAZORPAY_WEBHOOK_SECRET) for live payments, or explicitly set ALLOW_MOCK_PAYMENTS=true only if intentionally running mock mode.');
    } else if (pay.mockSigningSecretIsDefault) {
      issues.push('PAYMENT_SIGNING_SECRET must be set to a strong, non-default value when mock payments are allowed in production.');
    }
  } else {
    // Razorpay configured: webhook secret strongly recommended/required for verification hardening.
    if (!pay.webhookSecret) {
      issues.push('RAZORPAY_WEBHOOK_SECRET must be set when Razorpay is configured (required for webhook signature verification).');
    }
    if (!pay.keySecret) {
      issues.push('RAZORPAY_KEY_SECRET must be set when Razorpay is configured.');
    }
  }

  // Guard against partial/misleading Razorpay config.
  if (!pay.razorpayConfigured && pay.hasAnyRazorpay) {
    issues.push('Razorpay configuration is incomplete: set both RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (and RAZORPAY_WEBHOOK_SECRET), or remove Razorpay variables to avoid ambiguous configuration.');
  }

  return issues;
}

let validated = false;
function validateForStartup() {
  if (validated) return { ok: true, issues: [] };
  validated = true;

  if (isProduction) {
    const issues = collectProductionIssues();
    if (issues.length) {
      const err = new Error('Invalid production configuration. Refusing to start with insecure or incomplete environment settings.');
      err.code = 'CONFIG_INVALID';
      err.issues = issues;
      throw err;
    }
  }

  return { ok: true, issues: [] };
}

function formatValidationError(err) {
  const issues = (err && err.issues) || [];
  const lines = [
    '[CONFIG] Startup blocked: production environment variables/configuration are missing or insecure.',
    '[CONFIG] Environment: ' + runtimeEnv
  ];
  issues.forEach((msg, i) => lines.push('[CONFIG]  ' + (i + 1) + '. ' + msg));
  lines.push('[CONFIG] Set required variables via the environment or an appropriate env file (do not commit secrets). See .env.example for a template.');
  lines.push('[CONFIG] Existing Super Admin accounts are preserved. For existing installations, rotate/reset credentials using the secure password-reset procedure (do not use default passwords).');
  return lines.join('\n');
}

function safeStartupSummary() {
  const pay = paymentConfig();
  const supabase = supabasePublicConfig();
  return {
    env: runtimeEnv,
    dataDirFromEnv: !!process.env.HISAAB_DATA_DIR,
    paymentProvider: pay.provider,
    razorpayKeyConfigured: !!pay.keyId,
    razorpaySecretConfigured: !!pay.keySecret,
    razorpayWebhookSecretConfigured: !!pay.webhookSecret,
    mockPaymentsAllowedInProduction: !!pay.allowMockInProduction,
    supabasePublicConfigFromEnv: supabase.configured
  };
}

module.exports = {
  ROOT_DIR,
  dataDir,
  runtimeEnv,
  isProduction,
  isTest,
  isDevelopment,
  env,
  boolEnv,
  paymentConfig,
  adminConfig,
  superAdminStoreState,
  saasAdminStoreState,
  isStrongSecret,
  validateForStartup,
  formatValidationError,
  safeStartupSummary
};
