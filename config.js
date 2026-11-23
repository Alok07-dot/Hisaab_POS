/**
 * ===============================================================
 * HISAAB POS - Supabase Configuration
 * ===============================================================
 *
 * YOU ONLY NEED TO CHANGE 2 LINES BELOW (url and anonKey).
 *
 * HOW TO GET THESE VALUES (step by step):
 *  1. Go to https://supabase.com and sign in (or create a free account).
 *  2. Open your project (or create a new one — any name is fine).
 *  3. Click the ⚙️  "Project Settings" icon (bottom-left).
 *  4. Click "API" (or "Data API") in the left menu.
 *  5. Copy "Project URL" and paste it below as `url`.
 *  6. Copy the "anon public" key (a long key starting with eyJ...)
 *     and paste it below as `anonKey`.
 *
 * IMPORTANT:
 *  - Paste the "anon / public" key ONLY. NEVER paste the "service_role" key.
 *  - Keep the quotes (' ') around both values.
 *  - The database schema must be installed first:
 *    run supabase/migrations/0001_core_tenancy.sql in the SQL Editor
 *    (full walkthrough in SUPABASE-SETUP.md).
 *  - After saving this file, refresh the app in your browser.
 *
 * With real values the app switches to cloud mode: Supabase Auth sign-in,
 * company onboarding, and multi-tenant data isolation enforced by Postgres
 * Row Level Security.
 *
 * If you leave the placeholders as-is, the app works offline (local only).
 */

window.SUPABASE_CONFIG = {
  url: 'https://wltybaooghuutqxgbomm.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsdHliYW9vZ2h1dXRxeGdib21tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzMDI4MDYsImV4cCI6MjEwOTg3ODgwNn0.fV1DkKt91DlRvAsQhJcApy0VNlgfe_sSfVwIxhG609c'
};
