// Lead Dialer — local CRM server
// Serves the UI, stores leads in leads.json, mints Twilio Voice tokens.
// Run: npm install && node server.js  → http://localhost:3333

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3333;
const DATA_FILE = path.join(__dirname, 'leads.json');
const ENV_FILE = path.join(__dirname, '.env');

// --- tiny .env loader (no dep) ---
const env = {};
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1]] = m[2];
  }
}

// --- workup field-level encryption (SSN / DL / banking) ---
// These fields are ciphertext everywhere at rest (leads.json, backups) and only
// decrypted when served to the browser over localhost. Key lives in .env (LEAD_ENC_KEY),
// same key on every machine. Format: "enc1:<iv>:<tag>:<cipher>" (AES-256-GCM, hex).
const crypto = require('crypto');
const ENC_KEY = env.LEAD_ENC_KEY ? Buffer.from(env.LEAD_ENC_KEY, 'hex') : null;
const SENSITIVE_WORKUP = { client: ['ssn', 'dl', 'bank', 'routing', 'account'], client2: ['ssn', 'dl'] };
function encVal(plain) {
  if (!ENC_KEY || !plain || String(plain).startsWith('enc1:')) return plain;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `enc1:${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
}
function decVal(stored) {
  if (!ENC_KEY || !stored || !String(stored).startsWith('enc1:')) return stored;
  try {
    const [, ivh, tagh, cth] = String(stored).split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivh, 'hex'));
    d.setAuthTag(Buffer.from(tagh, 'hex'));
    return Buffer.concat([d.update(Buffer.from(cth, 'hex')), d.final()]).toString('utf8');
  } catch (e) { return '(decrypt failed — wrong LEAD_ENC_KEY?)'; }
}
function encryptWorkupInPlace(lead) {
  const w = lead && lead.workup;
  if (!w) return;
  for (const [sec, keys] of Object.entries(SENSITIVE_WORKUP))
    for (const k of keys) if (w[sec] && w[sec][k]) w[sec][k] = encVal(w[sec][k]);
}
function decryptedLead(lead) {
  if (!lead || !lead.workup) return lead;
  const copy = JSON.parse(JSON.stringify(lead));
  for (const [sec, keys] of Object.entries(SENSITIVE_WORKUP))
    for (const k of keys) if (copy.workup[sec] && copy.workup[sec][k]) copy.workup[sec][k] = decVal(copy.workup[sec][k]);
  return copy;
}

// --- leads store ---
function loadLeads() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function saveLeads(leads) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(leads, null, 1));
  fs.renameSync(tmp, DATA_FILE);
}
let leads = loadLeads();

// --- clients store (sold leads → clients, each with one or more policies) ---
const CLIENTS_FILE = path.join(__dirname, 'clients.json');
function loadClients() {
  try { return JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8')); }
  catch { return []; }
}
let clients = loadClients();
function saveClients(list) {
  const tmp = CLIENTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 1));
  fs.renameSync(tmp, CLIENTS_FILE);
}
let nextClientId = clients.reduce((m, c) => Math.max(m, c.id || 0), 0) + 1;
let nextPolicyId = clients.reduce((m, c) => Math.max(m, ...(c.policies || []).map(p => p.id || 0), 0), 0) + 1;

// --- call event log (calls.json) ---
// One row per dial attempt: { ts, leadId, state, number (caller ID used), mode, outcome }.
// Outcomes from auto/parallel dials are AMD-verified; manual dials log as 'manual' (counted
// for per-number dial volume, excluded from answer-rate math). Feeds Number Health + Best Time to Call.
const CALLS_FILE = path.join(__dirname, 'calls.json');
function loadCalls() {
  try { return JSON.parse(fs.readFileSync(CALLS_FILE, 'utf8')); }
  catch { return []; }
}
let calls = loadCalls();
function logCall(entry) {
  const row = Object.assign({ ts: new Date().toISOString() }, entry);
  calls.push(row);
  if (calls.length > 50000) calls = calls.slice(-40000); // keep the file bounded
  const tmp = CALLS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(calls));
  fs.renameSync(tmp, CALLS_FILE);
}

// --- twilio token ---
function readConfig() {
  const cf = path.join(__dirname, 'config.json');
  try { return JSON.parse(fs.readFileSync(cf, 'utf8')); } catch { return {}; }
}
function writeConfig(cfg) {
  fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(cfg, null, 1));
}
function activeCallerId() {
  const cfg = readConfig();
  return (cfg.callSettings && cfg.callSettings.callerId) || env.TWILIO_CALLER_ID || null;
}
function twilioToken() {
  const need = ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_TWIML_APP_SID'];
  const missing = need.filter(k => !env[k]);
  if (missing.length) return { error: 'Twilio not configured. Missing in .env: ' + missing.join(', ') };
  const twilio = require('twilio');
  const AccessToken = twilio.jwt.AccessToken;
  const token = new AccessToken(env.TWILIO_ACCOUNT_SID, env.TWILIO_API_KEY, env.TWILIO_API_SECRET, {
    identity: 'brayden', ttl: 3600
  });
  token.addGrant(new AccessToken.VoiceGrant({
    outgoingApplicationSid: env.TWILIO_TWIML_APP_SID,
    incomingAllow: true // let the browser client receive inbound PSTN calls routed via /inbound
  }));
  const cfg = readConfig();
  return { token: token.toJwt(), callerId: activeCallerId(), inboundEnabled: !!(cfg.callSettings && cfg.callSettings.inboundEnabled) };
}

// --- state name/abbreviation resolver, for "search by state" number lookup ---
const STATES = {
  alabama:'AL', alaska:'AK', arizona:'AZ', arkansas:'AR', california:'CA', colorado:'CO',
  connecticut:'CT', delaware:'DE', florida:'FL', georgia:'GA', hawaii:'HI', idaho:'ID',
  illinois:'IL', indiana:'IN', iowa:'IA', kansas:'KS', kentucky:'KY', louisiana:'LA',
  maine:'ME', maryland:'MD', massachusetts:'MA', michigan:'MI', minnesota:'MN',
  mississippi:'MS', missouri:'MO', montana:'MT', nebraska:'NE', nevada:'NV',
  'new hampshire':'NH', 'new jersey':'NJ', 'new mexico':'NM', 'new york':'NY',
  'north carolina':'NC', 'north dakota':'ND', ohio:'OH', oklahoma:'OK', oregon:'OR',
  pennsylvania:'PA', 'rhode island':'RI', 'south carolina':'SC', 'south dakota':'SD',
  tennessee:'TN', texas:'TX', utah:'UT', vermont:'VT', virginia:'VA', washington:'WA',
  'west virginia':'WV', wisconsin:'WI', wyoming:'WY', 'district of columbia':'DC'
};
const STATE_ABBRS = new Set(Object.values(STATES));
function resolveState(q) {
  const s = String(q || '').trim().toLowerCase();
  if (STATE_ABBRS.has(s.toUpperCase())) return s.toUpperCase();
  return STATES[s] || null;
}

// --- twilio REST helper (numbers management) ---
async function twilioApi(pathSuffix, method, form) {
  const need = ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET'];
  const missing = need.filter(k => !env[k]);
  if (missing.length) throw new Error('Twilio not configured — run Setup Calling first.');
  const auth = Buffer.from(`${env.TWILIO_API_KEY}:${env.TWILIO_API_SECRET}`).toString('base64');
  const opts = { method: method || 'GET', headers: { Authorization: 'Basic ' + auth } };
  if (form) opts.body = new URLSearchParams(form);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}${pathSuffix}`, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Twilio error ${r.status}`);
  return j;
}
// same as twilioApi but for any Twilio host (Serverless API lives on serverless.twilio.com,
// not api.twilio.com) — form values may be arrays to send a repeated key (e.g. FunctionVersions)
async function twHost(host, pathSuffix, method, form) {
  const need = ['TWILIO_API_KEY', 'TWILIO_API_SECRET'];
  const missing = need.filter(k => !env[k]);
  if (missing.length) throw new Error('Twilio not configured — run Setup Calling first.');
  const auth = Buffer.from(`${env.TWILIO_API_KEY}:${env.TWILIO_API_SECRET}`).toString('base64');
  const opts = { method: method || 'GET', headers: { Authorization: 'Basic ' + auth } };
  if (form) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (Array.isArray(v)) v.forEach(x => usp.append(k, x)); else usp.append(k, v);
    }
    opts.body = usp;
  }
  const r = await fetch(`https://${host}${pathSuffix}`, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `Twilio error ${r.status}`);
  return j;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// domain behind the existing TwiML App (e.g. lead-dialer-xxxx-prod.twil.io) — cached after first lookup
async function getVoiceDomain() {
  const cfg = readConfig();
  if (cfg.callSettings && cfg.callSettings.voiceDomain) return cfg.callSettings.voiceDomain;
  const need = ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_TWIML_APP_SID'];
  const missing = need.filter(k => !env[k]);
  if (missing.length) throw new Error('Twilio not configured — run Setup Calling first.');
  const app = await twilioApi(`/Applications/${env.TWILIO_TWIML_APP_SID}.json`);
  if (!app.voice_url) throw new Error('Existing TwiML App has no Voice URL — re-run Setup Calling.');
  const domain = new URL(app.voice_url).host;
  const newCfg = readConfig();
  newCfg.callSettings = Object.assign({}, newCfg.callSettings, { voiceDomain: domain });
  writeConfig(newCfg);
  return domain;
}

// --- parallel (raw multi-line) dialing infra ---
// One-time migration: adds a second Twilio Function ("parallel-leg") to the SAME
// Serverless Service + Environment that Setup Calling already deployed "outbound" to,
// and teaches "outbound" a second mode (join a conference instead of dialing direct).
// Both live at the same domain the TwiML App already points at, so .env never changes.
async function uploadFunctionVersion(serviceSid, functionSid, pathStr, code) {
  const auth = Buffer.from(`${env.TWILIO_API_KEY}:${env.TWILIO_API_SECRET}`).toString('base64');
  const fd = new FormData();
  fd.append('Path', pathStr);
  fd.append('Visibility', 'protected');
  fd.append('Content', new Blob([code], { type: 'application/javascript' }), pathStr.replace(/^\//, '') + '.js');
  const r = await fetch(`https://serverless-upload.twilio.com/v1/Services/${serviceSid}/Functions/${functionSid}/Versions`, {
    method: 'POST', headers: { Authorization: 'Basic ' + auth }, body: fd
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Twilio Function upload failed: ' + (j.message || r.status));
  return j;
}
async function pollBuild(serviceSid, buildSid) {
  for (let i = 0; i < 30; i++) {
    const st = await twHost('serverless.twilio.com', `/v1/Services/${serviceSid}/Builds/${buildSid}/Status`);
    if (st.status === 'completed') return;
    if (st.status === 'failed') throw new Error('Twilio Function build failed.');
    await sleep(2000);
  }
  throw new Error('Twilio Function build timed out.');
}
// --- Twilio Function source (deployed to the serverless service) ---
const CLIENT_IDENTITY = 'brayden'; // must match the identity in twilioToken()
const OUTBOUND_CODE = `exports.handler = function(context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  if (event.Mode === 'parallel' && event.Room) {
    // agent's own leg: join the conference and own its lifecycle (hang up = end the conference).
    // Two different callers land here and need different audio while waiting alone:
    // - raw parallel dial (browser/WebRTC): the browser tab plays its own local ringback, so we
    //   silence Twilio's hold music (waitUrl:'') to avoid a clash.
    // - "ring my phone" (event.Hold=1): the agent is on a real phone call, not the browser — there
    //   is no local tone reaching them, so real silence means real silence. Let Twilio's default
    //   hold music play instead by omitting waitUrl.
    const dial = twiml.dial();
    const confOpts = { startConferenceOnEnter: true, endConferenceOnExit: true, beep: false };
    if (event.Hold !== '1') confOpts.waitUrl = '';
    dial.conference(confOpts, event.Room);
  } else {
    const timeout = parseInt(event.Timeout, 10) || 20;
    const dial = twiml.dial({ callerId: event.CallerId, answerOnBridge: true, timeout });
    dial.number(event.To);
  }
  callback(null, twiml);
};`;
const PARALLEL_CODE = `exports.handler = function(context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  const answeredBy = event.AnsweredBy || '';
  if (answeredBy.indexOf('machine') === 0 || answeredBy === 'fax') {
    // voicemail/fax — hang up immediately, don't burn minutes sitting through a greeting
    twiml.hangup();
  } else {
    // human (or undetermined — never risk hanging up on a live person)
    const dial = twiml.dial();
    dial.conference({ startConferenceOnEnter: false, endConferenceOnExit: false, beep: false }, event.Room);
  }
  callback(null, twiml);
};`;
// PSTN caller dialed one of our numbers → ring the browser softphone. callerId = the real
// caller so the CRM can match them to a lead. If nobody answers in 25s, take a voicemail.
const INBOUND_CODE = `exports.handler = function(context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  const dial = twiml.dial({ callerId: event.From, timeout: 25, answerOnBridge: true });
  dial.client(${JSON.stringify(CLIENT_IDENTITY)});
  callback(null, twiml);
};`;
// hands-free single dialer: the server dials a lead with answering-machine detection, and
// Twilio hits this AFTER detection completes (AnsweredBy is set). Machine/fax → hang up so
// the loop marks it "Voicemail" and moves on. Live human → ring the agent's browser to talk.
// callerId = the lead's own number (event.To) so the agent's screen shows who answered.
const AUTO_SINGLE_CODE = `exports.handler = function(context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  const answeredBy = event.AnsweredBy || '';
  if (answeredBy.indexOf('machine') === 0 || answeredBy === 'fax') {
    twiml.hangup();
  } else {
    twiml.dial({ callerId: event.To, timeout: 25 }).client(${JSON.stringify(CLIENT_IDENTITY)});
  }
  callback(null, twiml);
};`;
// Fingerprint of the four Function source strings above. Compared against a saved copy in
// config.json on every boot (syncVoiceFunctionsIfNeeded) so an app update that changes what's
// dialed out to Twilio actually reaches Twilio, instead of silently sitting unused in this file
// forever behind ensureParallelInfra/ensureAutoSingleUrl's "already deployed once" caches.
const FUNCTIONS_CODE_HASH = crypto.createHash('sha256')
  .update(OUTBOUND_CODE + PARALLEL_CODE + INBOUND_CODE + AUTO_SINGLE_CODE).digest('hex').slice(0, 16);

// Force-deploys all voice functions (creating any that are missing) and returns the service
// domain. Unlike ensureParallelInfra's cache, this always re-uploads + rebuilds — used when
// enabling inbound so a fresh /inbound function (and any outbound code changes) actually ship.
async function deployVoiceFunctions() {
  const need = ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_TWIML_APP_SID'];
  const missing = need.filter(k => !env[k]);
  if (missing.length) throw new Error('Twilio not configured — run Setup Calling first.');
  const domain = await getVoiceDomain();
  const services = await twHost('serverless.twilio.com', '/v1/Services?PageSize=50');
  let svc = null, environment = null;
  for (const s of (services.services || [])) {
    const envs = await twHost('serverless.twilio.com', `/v1/Services/${s.sid}/Environments`);
    const match = (envs.environments || []).find(e => e.domain_name === domain);
    if (match) { svc = s; environment = match; break; }
  }
  if (!svc) throw new Error('Could not find the Twilio Functions service behind your setup — re-run Setup Calling.');
  const fns = await twHost('serverless.twilio.com', `/v1/Services/${svc.sid}/Functions?PageSize=50`);
  const findOrCreate = async name => {
    let fn = (fns.functions || []).find(f => f.friendly_name === name);
    if (!fn) fn = await twHost('serverless.twilio.com', `/v1/Services/${svc.sid}/Functions`, 'POST', { FriendlyName: name });
    return fn;
  };
  const outboundFn = await findOrCreate('outbound');
  const parallelFn = await findOrCreate('parallel-leg');
  const inboundFn = await findOrCreate('inbound');
  const autoSingleFn = await findOrCreate('auto-single');
  const vers = await Promise.all([
    uploadFunctionVersion(svc.sid, outboundFn.sid, '/outbound', OUTBOUND_CODE),
    uploadFunctionVersion(svc.sid, parallelFn.sid, '/parallel-leg', PARALLEL_CODE),
    uploadFunctionVersion(svc.sid, inboundFn.sid, '/inbound', INBOUND_CODE),
    uploadFunctionVersion(svc.sid, autoSingleFn.sid, '/auto-single', AUTO_SINGLE_CODE)
  ]);
  const build = await twHost('serverless.twilio.com', `/v1/Services/${svc.sid}/Builds`, 'POST', { FunctionVersions: vers.map(v => v.sid) });
  await pollBuild(svc.sid, build.sid);
  await twHost('serverless.twilio.com', `/v1/Services/${svc.sid}/Environments/${environment.sid}/Deployments`, 'POST', { BuildSid: build.sid });
  return domain;
}

// Runs once at every boot. If Twilio is configured and the voice Functions have already been
// deployed at least once (voiceDomain/parallelLegUrl/autoSingleUrl set), compares the currently
// saved FUNCTIONS_CODE_HASH against this build's — a mismatch means an app update changed what
// gets dialed out to Twilio (like the ring-my-phone hold-music fix), so it redeploys automatically
// instead of that fix silently never reaching Twilio. Never blocks startup; failures just retry
// next launch.
async function syncVoiceFunctionsIfNeeded() {
  try {
    const need = ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_TWIML_APP_SID'];
    if (need.some(k => !env[k])) return; // Twilio not set up yet
    const cs = readConfig().callSettings || {};
    if (!cs.voiceDomain && !cs.parallelLegUrl && !cs.autoSingleUrl) return; // never deployed yet — first deploy happens via normal setup flows
    if (cs.functionsHash === FUNCTIONS_CODE_HASH) return; // already current
    console.log('[twilio] Voice Function code changed since last deploy — redeploying to Twilio…');
    const domain = await deployVoiceFunctions();
    const c2 = readConfig();
    c2.callSettings = Object.assign({}, c2.callSettings, { functionsHash: FUNCTIONS_CODE_HASH, voiceDomain: domain });
    writeConfig(c2);
    console.log('[twilio] Voice Functions redeployed OK.');
  } catch (e) {
    console.log('[twilio] Voice Function auto-redeploy failed (will retry next launch):', e.message);
  }
}

// Deploys /inbound and points the given numbers (or all owned numbers) at it, so incoming
// PSTN calls ring the browser client. Returns which numbers were wired.
async function enableInbound(numbers) {
  const domain = await deployVoiceFunctions();
  const inboundUrl = `https://${domain}/inbound`;
  const owned = await twilioApi('/IncomingPhoneNumbers.json?PageSize=50');
  const want = Array.isArray(numbers) && numbers.length ? new Set(numbers) : null;
  const configured = [];
  for (const n of (owned.incoming_phone_numbers || [])) {
    if (want && !want.has(n.phone_number)) continue;
    if (!n.capabilities || !n.capabilities.voice) continue;
    // a number routes to EITHER a VoiceUrl or a VoiceApplicationSid — set the URL, clear the app
    await twilioApi(`/IncomingPhoneNumbers/${n.sid}.json`, 'POST', { VoiceUrl: inboundUrl, VoiceMethod: 'POST', VoiceApplicationSid: '' });
    configured.push(n.phone_number);
  }
  const cfg = readConfig();
  cfg.callSettings = Object.assign({}, cfg.callSettings, { inboundEnabled: true, inboundUrl, inboundNumbers: configured, functionsHash: FUNCTIONS_CODE_HASH });
  writeConfig(cfg);
  return { inboundUrl, configured };
}

// URL of the hands-free AMD dial function; deploys it once (force build) then caches the URL.
async function ensureAutoSingleUrl() {
  const cfg = readConfig();
  if (cfg.callSettings && cfg.callSettings.autoSingleUrl) return cfg.callSettings.autoSingleUrl;
  const domain = await deployVoiceFunctions();
  const autoSingleUrl = `https://${domain}/auto-single`;
  const c2 = readConfig();
  c2.callSettings = Object.assign({}, c2.callSettings, { autoSingleUrl, functionsHash: FUNCTIONS_CODE_HASH });
  writeConfig(c2);
  return autoSingleUrl;
}

let parallelInfraPromise = null;
async function ensureParallelInfra() {
  const cfg = readConfig();
  if (cfg.callSettings && cfg.callSettings.parallelLegUrl) return cfg.callSettings.parallelLegUrl;
  if (parallelInfraPromise) return parallelInfraPromise; // avoid two overlapping migrations
  parallelInfraPromise = (async () => {
    const need = ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_TWIML_APP_SID'];
    const missing = need.filter(k => !env[k]);
    if (missing.length) throw new Error('Twilio not configured — run Setup Calling first.');

    const domain = await getVoiceDomain();

    const services = await twHost('serverless.twilio.com', '/v1/Services?PageSize=50');
    let svc = null, environment = null;
    for (const s of (services.services || [])) {
      const envs = await twHost('serverless.twilio.com', `/v1/Services/${s.sid}/Environments`);
      const match = (envs.environments || []).find(e => e.domain_name === domain);
      if (match) { svc = s; environment = match; break; }
    }
    if (!svc) throw new Error('Could not find the Twilio Functions service behind your setup — re-run Setup Calling.');

    const fns = await twHost('serverless.twilio.com', `/v1/Services/${svc.sid}/Functions?PageSize=50`);
    const outboundFn = (fns.functions || []).find(f => f.friendly_name === 'outbound');
    let parallelFn = (fns.functions || []).find(f => f.friendly_name === 'parallel-leg');
    if (!outboundFn) throw new Error('Could not find the existing outbound calling function — re-run Setup Calling.');
    if (!parallelFn) parallelFn = await twHost('serverless.twilio.com', `/v1/Services/${svc.sid}/Functions`, 'POST', { FriendlyName: 'parallel-leg' });

    const outboundVer = await uploadFunctionVersion(svc.sid, outboundFn.sid, '/outbound', OUTBOUND_CODE);
    const parallelVer = await uploadFunctionVersion(svc.sid, parallelFn.sid, '/parallel-leg', PARALLEL_CODE);
    const build = await twHost('serverless.twilio.com', `/v1/Services/${svc.sid}/Builds`, 'POST', {
      FunctionVersions: [outboundVer.sid, parallelVer.sid]
    });
    await pollBuild(svc.sid, build.sid);
    await twHost('serverless.twilio.com', `/v1/Services/${svc.sid}/Environments/${environment.sid}/Deployments`, 'POST', { BuildSid: build.sid });

    const parallelLegUrl = `https://${domain}/parallel-leg`;
    const newCfg = readConfig();
    newCfg.callSettings = Object.assign({}, newCfg.callSettings, { parallelLegUrl });
    writeConfig(newCfg);
    return parallelLegUrl;
  })();
  try { return await parallelInfraPromise; } finally { parallelInfraPromise = null; }
}

// --- helpers ---
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true'
};
function json(res, code, obj) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, CORS));
  res.end(JSON.stringify(obj));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 50e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}
let nextId = leads.reduce((m, l) => Math.max(m, l.id || 0), 0) + 1;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    if (p === '/api/raw-backup' && req.method === 'POST') {
      // raw source-system dump, kept as-is for safety (e.g. full Ringy lead objects)
      const raw = await body(req);
      const file = path.join(__dirname, 'ringy-raw-' + new Date().toISOString().slice(0, 10) + '.json');
      fs.writeFileSync(file, JSON.stringify(raw, null, 1));
      return json(res, 200, { saved: file, count: Array.isArray(raw) ? raw.length : 1 });
    }

    if (p === '/api/config' && req.method === 'GET') {
      const cf = path.join(__dirname, 'config.json');
      return json(res, 200, fs.existsSync(cf) ? JSON.parse(fs.readFileSync(cf, 'utf8')) : {});
    }
    if (p === '/api/config' && req.method === 'POST') {
      writeConfig(await body(req));
      return json(res, 200, { ok: true });
    }

    if (p === '/api/call-log' && req.method === 'POST') {
      // manual/browser dials log themselves here (auto + parallel dials are logged server-side)
      const { leadId, state, number, mode, outcome } = await body(req);
      logCall({ leadId: leadId || null, state: state || null, number: number || activeCallerId(), mode: mode || 'manual', outcome: outcome || 'manual' });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/call-stats' && req.method === 'GET') {
      // raw call events; frontend aggregates (number health, best-time-to-call)
      return json(res, 200, calls.slice(-20000));
    }

    if (p === '/api/twilio/parallel-setup' && req.method === 'POST') {
      const parallelLegUrl = await ensureParallelInfra();
      return json(res, 200, { ok: true, parallelLegUrl });
    }
    if (p === '/api/twilio/enable-inbound' && req.method === 'POST') {
      const { numbers } = await body(req);
      const result = await enableInbound(numbers);
      return json(res, 200, { ok: true, ...result });
    }
    if (p === '/api/twilio/auto-single' && req.method === 'POST') {
      // hands-free single dial: create one AMD call, poll to a verdict, return the outcome.
      const { to, callerId, ringTimeoutSec, leadId, leadState } = await body(req);
      if (!to) return json(res, 400, { error: 'to required' });
      const url = await ensureAutoSingleUrl();
      const timeout = Math.max(5, Math.min(45, Number(ringTimeoutSec) || 25));
      let call;
      try {
        call = await twilioApi('/Calls.json', 'POST', {
          To: to, From: callerId || activeCallerId(),
          Url: url, MachineDetection: 'Enable', Timeout: String(timeout)
          // Stock AMD defaults — reliable voicemail filtering. We tried tuning it toward "human"
          // to shorten the answer gap, but that let voicemails through as "human" (worse), so it's
          // reverted. Filtering voicemails > shaving ~2s off the gap for this use case.
        });
      } catch (e) {
        logCall({ leadId, state: leadState || null, number: callerId || activeCallerId(), mode: 'auto', outcome: 'failed' });
        return json(res, 200, { outcome: 'failed', error: e.message });
      }
      const sid = call.sid;
      const deadline = Date.now() + (timeout + 12) * 1000;
      let outcome = null;
      while (Date.now() < deadline) {
        await sleep(1000);
        let st; try { st = await twilioApi(`/Calls/${sid}.json`); } catch (e) { continue; }
        const ab = st.answered_by || '';
        if (ab.indexOf('machine') === 0 || ab === 'fax') { outcome = 'voicemail'; break; }
        if (st.status === 'in-progress' && (ab === 'human' || ab === 'unknown')) { outcome = 'human'; break; }
        if (['completed', 'no-answer', 'busy', 'failed', 'canceled'].includes(st.status)) {
          outcome = st.status === 'busy' ? 'busy'
            : st.status === 'failed' ? 'failed'
            : st.status === 'canceled' ? 'canceled'
            : 'no-answer';
          break;
        }
      }
      if (!outcome) { try { await twilioApi(`/Calls/${sid}.json`, 'POST', { Status: 'canceled' }); } catch (e) {} outcome = 'no-answer'; }
      logCall({ leadId, state: leadState || null, number: callerId || activeCallerId(), mode: 'auto', outcome });
      return json(res, 200, { outcome, sid });
    }
    if (p === '/api/twilio/inbound-status' && req.method === 'GET') {
      const cfg = readConfig();
      const cs = cfg.callSettings || {};
      // list owned numbers so the UI can offer which to route
      let owned = [];
      try {
        const o = await twilioApi('/IncomingPhoneNumbers.json?PageSize=50');
        owned = (o.incoming_phone_numbers || []).filter(n => n.capabilities && n.capabilities.voice)
          .map(n => ({ number: n.phone_number, routedToInbound: (n.voice_url || '').endsWith('/inbound') }));
      } catch (e) {}
      return json(res, 200, { enabled: !!cs.inboundEnabled, inboundNumbers: cs.inboundNumbers || [], owned });
    }
    if (p === '/api/twilio/parallel-dial' && req.method === 'POST') {
      const { room, ringTimeoutSec, calls: callsReq } = await body(req); // renamed: don't shadow the call-log array
      if (!room || !Array.isArray(callsReq) || !callsReq.length) return json(res, 400, { error: 'room and calls[] required' });
      const parallelLegUrl = await ensureParallelInfra();
      const timeout = Math.max(5, Math.min(45, Number(ringTimeoutSec) || 20));
      const legs = [];
      for (const c of callsReq) {
        if (!c.to || !c.leadId) continue;
        const j = await twilioApi('/Calls.json', 'POST', {
          To: c.to,
          From: c.callerId || activeCallerId(),
          Url: `${parallelLegUrl}?Room=${encodeURIComponent(room)}`,
          MachineDetection: 'Enable', // fastest AMD mode — fewer billed seconds before we hang up on a machine
          Timeout: String(timeout)
        });
        legs.push({ leadId: c.leadId, sid: j.sid, done: false });
      }
      const deadline = Date.now() + (timeout + 8) * 1000;
      let winner = null;
      while (Date.now() < deadline) {
        await sleep(1000);
        for (const leg of legs) {
          if (leg.done) continue;
          let st;
          try { st = await twilioApi(`/Calls/${leg.sid}.json`); } catch (e) { continue; }
          const answeredBy = st.answered_by || '';
          if (st.status === 'in-progress' && (answeredBy === 'human' || answeredBy === 'unknown')) {
            leg.done = true; leg.outcome = 'human'; winner = leg;
          } else if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(st.status)) {
            leg.done = true;
            leg.outcome = answeredBy.indexOf('machine') === 0 ? 'voicemail'
              : answeredBy === 'fax' ? 'fax'
              : st.status === 'busy' ? 'busy'
              : st.status === 'failed' ? 'failed'
              : st.status === 'canceled' ? 'canceled'
              : 'no-answer';
          }
        }
        if (winner || legs.every(l => l.done)) break;
      }
      for (const leg of legs) {
        if (!leg.done) {
          try { await twilioApi(`/Calls/${leg.sid}.json`, 'POST', { Status: 'canceled' }); } catch (e) {}
          leg.outcome = 'canceled';
        }
      }
      for (const leg of legs) {
        const orig = callsReq.find(c => c.leadId === leg.leadId) || {};
        logCall({ leadId: leg.leadId, state: orig.leadState || null, number: orig.callerId || activeCallerId(), mode: 'parallel', outcome: leg.outcome || 'no-answer' });
      }
      return json(res, 200, { winner: winner ? winner.leadId : null, winnerSid: winner ? winner.sid : null, room, legs: legs.map(l => ({ leadId: l.leadId, outcome: l.outcome || 'no-answer' })) });
    }

    // --- "ring my phone" call delivery: Twilio calls the agent's own phone first;
    // once they answer, the SAME outbound.js Function bridges them to the lead (direct)
    // or joins them into the parallel conference — reused unchanged either way.
    if (p === '/api/twilio/call-agent' && req.method === 'POST') {
      const { mode, to, callerId, timeoutSec, room } = await body(req);
      const cfg = readConfig();
      const agentPhone = cfg.callSettings && cfg.callSettings.ringMyPhone && cfg.callSettings.ringMyPhone.number;
      if (!agentPhone) return json(res, 400, { error: 'No phone number set for "Ring My Phone" in Settings.' });
      const domain = await getVoiceDomain();
      let voiceUrl;
      if (mode === 'parallel') {
        if (!room) return json(res, 400, { error: 'room required for parallel mode' });
        // Hold=1 tells outbound.js this leg is a real phone call (not the browser), so it should
        // get Twilio's actual hold music instead of dead air while waiting between dial attempts.
        voiceUrl = `https://${domain}/outbound?Mode=parallel&Room=${encodeURIComponent(room)}&Hold=1`;
      } else {
        if (!to) return json(res, 400, { error: 'to required for direct mode' });
        const timeout = Math.max(5, Math.min(45, Number(timeoutSec) || 20));
        voiceUrl = `https://${domain}/outbound?To=${encodeURIComponent(to)}&CallerId=${encodeURIComponent(callerId || activeCallerId() || '')}&Timeout=${timeout}`;
      }
      const j = await twilioApi('/Calls.json', 'POST', { To: agentPhone, From: activeCallerId(), Url: voiceUrl });
      return json(res, 200, { sid: j.sid });
    }
    if (p === '/api/twilio/call-status' && req.method === 'GET') {
      const sid = url.searchParams.get('sid');
      if (!sid) return json(res, 400, { error: 'sid required' });
      const st = await twilioApi(`/Calls/${sid}.json`);
      return json(res, 200, { status: st.status, answeredBy: st.answered_by || null });
    }
    if (p === '/api/twilio/hangup-call' && req.method === 'POST') {
      const { sid } = await body(req);
      if (!sid) return json(res, 400, { error: 'sid required' });
      try { await twilioApi(`/Calls/${sid}.json`, 'POST', { Status: 'completed' }); } catch (e) {}
      return json(res, 200, { ok: true });
    }
    if (p === '/api/twilio/mute-agent' && req.method === 'POST') {
      const { room, callSid, muted } = await body(req);
      if (!room || !callSid) return json(res, 400, { error: 'room and callSid required' });
      const confs = await twilioApi(`/Conferences.json?FriendlyName=${encodeURIComponent(room)}&Status=in-progress`);
      const conf = (confs.conferences || [])[0];
      if (!conf) return json(res, 404, { error: 'conference not found or already ended' });
      const parts = await twilioApi(`/Conferences/${conf.sid}/Participants.json`);
      const me = (parts.participants || []).find(p => p.call_sid === callSid);
      if (!me) return json(res, 404, { error: 'participant not found' });
      await twilioApi(`/Conferences/${conf.sid}/Participants/${me.call_sid}.json`, 'POST', { Muted: muted ? 'true' : 'false' });
      return json(res, 200, { ok: true });
    }

    if (p === '/api/twilio/numbers' && req.method === 'GET') {
      const j = await twilioApi('/IncomingPhoneNumbers.json?PageSize=100');
      const active = activeCallerId();
      return json(res, 200, (j.incoming_phone_numbers || []).map(n => ({
        phoneNumber: n.phone_number, friendlyName: n.friendly_name, active: n.phone_number === active
      })));
    }
    if (p === '/api/twilio/available' && req.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return json(res, 400, { error: 'Enter an area code or a state' });
      let filter;
      if (/^\d{3}$/.test(q)) {
        filter = `AreaCode=${encodeURIComponent(q)}`;
      } else {
        const abbr = resolveState(q);
        if (!abbr) return json(res, 400, { error: `"${q}" isn't a recognized area code or US state` });
        filter = `InRegion=${encodeURIComponent(abbr)}`;
      }
      const j = await twilioApi(`/AvailablePhoneNumbers/US/Local.json?${filter}&VoiceEnabled=true&PageSize=10`);
      return json(res, 200, (j.available_phone_numbers || []).map(n => ({
        phoneNumber: n.phone_number, locality: n.locality, region: n.region
      })));
    }
    if (p === '/api/twilio/numbers' && req.method === 'POST') {
      const { phoneNumber } = await body(req);
      if (!phoneNumber) return json(res, 400, { error: 'phoneNumber required' });
      const j = await twilioApi('/IncomingPhoneNumbers.json', 'POST', { PhoneNumber: phoneNumber, FriendlyName: 'lead-dialer' });
      // newly bought number becomes active immediately
      const cfg = readConfig();
      cfg.callSettings = Object.assign({}, cfg.callSettings, { callerId: j.phone_number });
      writeConfig(cfg);
      return json(res, 200, { phoneNumber: j.phone_number, sid: j.sid });
    }
    if (p === '/api/twilio/active' && req.method === 'POST') {
      const { phoneNumber } = await body(req);
      if (!phoneNumber) return json(res, 400, { error: 'phoneNumber required' });
      const cfg = readConfig();
      cfg.callSettings = Object.assign({}, cfg.callSettings, { callerId: phoneNumber });
      writeConfig(cfg);
      return json(res, 200, { ok: true, callerId: phoneNumber });
    }

    if (p === '/api/clients' && req.method === 'GET') return json(res, 200, clients);
    if (p === '/api/clients' && req.method === 'POST') {
      const raw = await body(req);
      const client = Object.assign({ policies: [], notes: '', createdAt: new Date().toISOString() }, raw, { id: nextClientId++ });
      clients.push(client);
      saveClients(clients);
      return json(res, 200, client);
    }
    const clientMatch = p.match(/^\/api\/clients\/(\d+)$/);
    if (clientMatch && req.method === 'PATCH') {
      const c = clients.find(x => x.id === Number(clientMatch[1]));
      if (!c) return json(res, 404, { error: 'not found' });
      Object.assign(c, await body(req), { id: c.id });
      saveClients(clients);
      return json(res, 200, c);
    }
    if (clientMatch && req.method === 'DELETE') {
      clients = clients.filter(x => x.id !== Number(clientMatch[1]));
      saveClients(clients);
      return json(res, 200, { ok: true });
    }
    const policiesMatch = p.match(/^\/api\/clients\/(\d+)\/policies$/);
    if (policiesMatch && req.method === 'POST') {
      const c = clients.find(x => x.id === Number(policiesMatch[1]));
      if (!c) return json(res, 404, { error: 'not found' });
      const policy = Object.assign({}, await body(req), { id: nextPolicyId++ });
      c.policies = c.policies || [];
      c.policies.push(policy);
      saveClients(clients);
      return json(res, 200, policy);
    }
    const policyMatch = p.match(/^\/api\/clients\/(\d+)\/policies\/(\d+)$/);
    if (policyMatch && req.method === 'PATCH') {
      const c = clients.find(x => x.id === Number(policyMatch[1]));
      if (!c) return json(res, 404, { error: 'not found' });
      const pol = (c.policies || []).find(x => x.id === Number(policyMatch[2]));
      if (!pol) return json(res, 404, { error: 'not found' });
      Object.assign(pol, await body(req), { id: pol.id });
      saveClients(clients);
      return json(res, 200, pol);
    }
    if (policyMatch && req.method === 'DELETE') {
      const c = clients.find(x => x.id === Number(policyMatch[1]));
      if (!c) return json(res, 404, { error: 'not found' });
      c.policies = (c.policies || []).filter(x => x.id !== Number(policyMatch[2]));
      saveClients(clients);
      return json(res, 200, { ok: true });
    }

    if (p === '/api/leads' && req.method === 'GET') return json(res, 200, leads.map(decryptedLead));

    if (p === '/api/leads' && req.method === 'POST') {
      // bulk import: [{...}, ...] — merged by phone (digits only) to avoid dupes
      const incoming = await body(req);
      const byPhone = new Map(leads.map(l => [String(l.phone || '').replace(/\D/g, ''), l]));
      let added = 0, updated = 0;
      for (const raw of incoming) {
        const key = String(raw.phone || '').replace(/\D/g, '');
        const existing = key && byPhone.get(key);
        if (existing) { Object.assign(existing, raw, { id: existing.id }); updated++; }
        else {
          const lead = Object.assign({ notes: '', log: [], lastCalledAt: null }, raw, { id: nextId++ });
          leads.push(lead);
          if (key) byPhone.set(key, lead);
          added++;
        }
      }
      saveLeads(leads);
      return json(res, 200, { added, updated, total: leads.length });
    }

    const patchMatch = p.match(/^\/api\/leads\/(\d+)$/);
    if (patchMatch && req.method === 'PATCH') {
      const lead = leads.find(l => l.id === Number(patchMatch[1]));
      if (!lead) return json(res, 404, { error: 'not found' });
      Object.assign(lead, await body(req), { id: lead.id });
      encryptWorkupInPlace(lead); // SSN/DL/banking are ciphertext everywhere at rest
      saveLeads(leads);
      return json(res, 200, decryptedLead(lead));
    }
    if (patchMatch && req.method === 'DELETE') {
      leads = leads.filter(l => l.id !== Number(patchMatch[1]));
      saveLeads(leads);
      return json(res, 200, { ok: true });
    }

    if (p === '/api/token') return json(res, 200, twilioToken());

    // static
    const file = p === '/' ? '/index.html' : p;
    const full = path.join(__dirname, 'public', path.normalize(file));
    if (full.startsWith(path.join(__dirname, 'public')) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full);
      res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[ext] || 'application/octet-stream' });
      return res.end(fs.readFileSync(full));
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Lead Dialer running → http://localhost:${PORT}  (${leads.length} leads loaded)`);
  syncVoiceFunctionsIfNeeded(); // fire-and-forget — never delays startup, warns-and-continues on failure
});
