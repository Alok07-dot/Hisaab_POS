/* ══════════════════════════════════════════════════════════════
   HISAAB POS – payment gateway adapter

   Two providers are supported:

   • mock     – development / offline. A server-generated signature
                is produced and then verified by the server, so the
                full order → payment → verify flow is exercised.
   • razorpay – used automatically when RAZORPAY_KEY_ID and
                RAZORPAY_KEY_SECRET are set.

   The browser never decides the amount: the order amount always
   comes from the server-side plan catalogue.
   ══════════════════════════════════════════════════════════════ */

'use strict';

const crypto = require('crypto');
const runtimeConfig = require('../server/runtime-config');

function paymentEnv() {
  return runtimeConfig.paymentConfig();
}

const cfg = paymentEnv();
const KEY_ID = cfg.keyId;
const KEY_SECRET = cfg.keySecret;
const WEBHOOK_SECRET = cfg.webhookSecret;
const MOCK_SECRET = cfg.mockSigningSecret;

function provider() {
  return paymentEnv().provider;
}

function currency() {
  return 'INR';
}

function publicConfig() {
  const p = provider();
  const pconf = paymentEnv();
  return {
    provider: p,
    keyId: p === 'razorpay' ? pconf.keyId : null,
    testMode: p === 'mock'
  };
}

function hmacHex(value, secret) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Create the provider-side order.
 * Returns { providerOrderId, providerPayload }.
 */
async function createProviderOrder({ amount, receipt, notes }) {
  const p = provider();
  if (p === 'mock') {
    return {
      providerOrderId: 'mock_' + crypto.randomBytes(12).toString('hex'),
      providerPayload: { mode: 'test', receipt }
    };
  }

  const pconf = paymentEnv();
  const auth = Buffer.from(pconf.keyId + ':' + pconf.keySecret).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + auth,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount,
      currency: currency(),
      receipt: receipt,
      notes: notes || {}
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.id) {
    throw new Error((data.error && data.error.description) || ('Razorpay returned HTTP ' + r.status));
  }
  return { providerOrderId: data.id, providerPayload: data };
}

/**
 * Signature for a successful payment. This is the same formula
 * Razorpay uses: HMAC_SHA256(order_id + "|" + payment_id, secret).
 */
function secretFor(providerName) {
  const pconf = paymentEnv();
  return providerName === 'razorpay' ? pconf.keySecret : pconf.mockSigningSecret;
}

function signatureFor(providerOrderId, paymentId, providerName) {
  return hmacHex(providerOrderId + '|' + paymentId, secretFor(providerName || provider()));
}

function verifySignature(providerOrderId, paymentId, signature, providerName) {
  if (!providerOrderId || !paymentId || !signature) return false;
  return safeEqual(signatureFor(providerOrderId, paymentId, providerName), signature);
}

/** Development-only: create a payment id + valid signature. */
function mockPayment(providerOrderId) {
  if (provider() !== 'mock') {
    throw new Error('Mock payments are disabled while Razorpay keys are configured.');
  }
  const paymentId = 'mockpay_' + crypto.randomBytes(12).toString('hex');
  return { paymentId, signature: signatureFor(providerOrderId, paymentId) };
}

function verifyWebhook(rawBody, signature) {
  const secret = paymentEnv().webhookSecret;
  if (!secret || !signature) return false;
  return safeEqual(hmacHex(rawBody, secret), signature);
}

module.exports = {
  provider,
  currency,
  publicConfig,
  createProviderOrder,
  signatureFor,
  verifySignature,
  mockPayment,
  verifyWebhook,
  isMock: () => provider() === 'mock'
};
