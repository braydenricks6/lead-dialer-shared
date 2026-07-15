// Automated Twilio setup. Run once:  node setup-twilio.js
// Asks for your Twilio Account SID + Auth Token, then provisions everything
// (API key, calling backend) and sets up your caller ID — you choose to buy a
// new number, use a Twilio number you already own, or use your own phone number.
// Writes .env for you. Requires Node 18+.

const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = q => new Promise(res => rl.question(q, a => res(a.trim())));
const rand = () => Math.random().toString(16).slice(2, 6);
const e164 = p => { const d = String(p).replace(/\D/g, ''); return d.length === 10 ? '+1' + d : d.length === 11 && d[0] === '1' ? '+' + d : '+' + d; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Let the user pick where outbound calls appear to come from.
async function chooseCallerId(auth, sid) {
  console.log('\nHow should your calls show up (caller ID)?');
  console.log('  1) Buy a new local number  (~$1.15/mo, recommended for heavy dialing)');
  console.log('  2) Use a Twilio number I already own');
  console.log('  3) Use my own phone number (cell/landline) — Twilio will verify it');
  let choice;
  while (true) {
    choice = (await ask('Choose 1, 2, or 3: ')).trim();
    if (choice === '1' || choice === '2' || choice === '3') break;
    console.log(`"${choice}" isn't 1, 2, or 3 — try again.`);
  }

  if (choice === '2') {
    const owned = await tw(auth, 'api.twilio.com', `/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=50`);
    const list = owned.incoming_phone_numbers || [];
    if (!list.length) { console.log('You don\'t own any Twilio numbers yet — switching to buying one.'); return buyNumber(auth, sid); }
    list.forEach((n, i) => console.log(`  ${i + 1}) ${n.phone_number} ${n.friendly_name ? '(' + n.friendly_name + ')' : ''}`));
    const pick = list[Number(await ask('Which number? ')) - 1];
    if (!pick) throw new Error('Invalid choice.');
    return pick.phone_number;
  }

  if (choice === '3') {
    const phone = e164(await ask('Your phone number (e.g. 385 555 1234): '));
    // already verified or already owned? then no verification needed
    const existing = await tw(auth, 'api.twilio.com', `/2010-04-01/Accounts/${sid}/OutgoingCallerIds.json?PhoneNumber=${encodeURIComponent(phone)}`);
    if ((existing.outgoing_caller_ids || []).length) { console.log('  ✓ Already verified.'); return phone; }
    const owned = await tw(auth, 'api.twilio.com', `/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}`);
    if ((owned.incoming_phone_numbers || []).length) { console.log('  ✓ You already own this number.'); return phone; }
    // start verification: Twilio calls the number and you enter the code shown here
    const vr = await tw(auth, 'api.twilio.com', `/2010-04-01/Accounts/${sid}/OutgoingCallerIds.json`, 'POST', { PhoneNumber: phone, FriendlyName: 'lead-dialer' });
    console.log(`\n  Twilio is calling ${phone} now.`);
    console.log(`  When it asks, enter this code on your phone keypad:  ${vr.validation_code}\n`);
    process.stdout.write('  waiting for verification');
    for (let i = 0; i < 30; i++) {
      await sleep(3000); process.stdout.write('.');
      const chk = await tw(auth, 'api.twilio.com', `/2010-04-01/Accounts/${sid}/OutgoingCallerIds.json?PhoneNumber=${encodeURIComponent(phone)}`);
      if ((chk.outgoing_caller_ids || []).length) { console.log('\n  ✓ Verified!'); return phone; }
    }
    throw new Error('Verification timed out. Re-run and try again (make sure you answer the call and enter the code).');
  }

  return buyNumber(auth, sid); // choice === '1', already validated above
}

async function buyNumber(auth, sid) {
  const area = await ask('Area code for your new number (e.g. 228, 385, 801): ');
  console.log(`Searching for a (${area}) number…`);
  const avail = await tw(auth, 'api.twilio.com', `/2010-04-01/Accounts/${sid}/AvailablePhoneNumbers/US/Local.json?AreaCode=${area}&VoiceEnabled=true&PageSize=1`);
  if (!avail.available_phone_numbers || !avail.available_phone_numbers.length) throw new Error(`No numbers found in area code ${area}. Re-run and try another.`);
  const pick = avail.available_phone_numbers[0].phone_number;
  const confirm = await ask(`Buy ${pick} for ~$1.15/mo? (y/n): `);
  if (confirm.toLowerCase() !== 'y') throw new Error('Cancelled — no number purchased.');
  await tw(auth, 'api.twilio.com', `/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json`, 'POST', { PhoneNumber: pick, FriendlyName: 'lead-dialer' });
  return pick;
}

async function tw(auth, host, p, method = 'GET', form) {
  const opts = { method, headers: { Authorization: 'Basic ' + Buffer.from(auth).toString('base64') } };
  if (form) { opts.body = new URLSearchParams(form); }
  const r = await fetch(`https://${host}${p}`, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p} → ${r.status} ${j.message || ''}`);
  return j;
}

(async () => {
  console.log('\n=== Lead Dialer — Twilio setup ===\n');
  console.log('Find these at console.twilio.com (top of the dashboard).');
  const sid = await ask('Account SID (starts with AC): ');
  const token = await ask('Auth Token: ');
  const auth = `${sid}:${token}`;

  try {
    console.log('\nVerifying account…');
    const acct = await tw(auth, 'api.twilio.com', `/2010-04-01/Accounts/${sid}.json`);
    console.log('  ✓', acct.friendly_name, '(' + acct.status + ')');

    // decide caller ID first, so a cancel/timeout here leaves no leftover resources
    const pick = await chooseCallerId(auth, sid);

    console.log('Creating API key…');
    const key = await tw(auth, 'api.twilio.com', `/2010-04-01/Accounts/${sid}/Keys.json`, 'POST', { FriendlyName: 'lead-dialer' });

    console.log('Setting up the calling backend…');
    const svc = await tw(auth, 'serverless.twilio.com', '/v1/Services', 'POST', { UniqueName: 'lead-dialer-' + rand(), FriendlyName: 'lead-dialer', IncludeCredentials: 'false' });
    const fn = await tw(auth, 'serverless.twilio.com', `/v1/Services/${svc.sid}/Functions`, 'POST', { FriendlyName: 'outbound' });

    const code = `exports.handler = function(context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  const timeout = parseInt(event.Timeout, 10) || 20;
  const dial = twiml.dial({ callerId: event.CallerId, answerOnBridge: true, timeout });
  dial.number(event.To);
  callback(null, twiml);
};`;
    const fd = new FormData();
    fd.append('Path', '/outbound');
    fd.append('Visibility', 'protected');
    fd.append('Content', new Blob([code], { type: 'application/javascript' }), 'outbound.js');
    const verRes = await fetch(`https://serverless-upload.twilio.com/v1/Services/${svc.sid}/Functions/${fn.sid}/Versions`, {
      method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(auth).toString('base64') }, body: fd
    });
    const ver = await verRes.json();
    if (!verRes.ok) throw new Error('function upload failed: ' + (ver.message || verRes.status));

    const build = await tw(auth, 'serverless.twilio.com', `/v1/Services/${svc.sid}/Builds`, 'POST', { FunctionVersions: ver.sid });
    process.stdout.write('  building');
    for (let i = 0; i < 30; i++) {
      const st = await tw(auth, 'serverless.twilio.com', `/v1/Services/${svc.sid}/Builds/${build.sid}/Status`);
      if (st.status === 'completed') break;
      if (st.status === 'failed') throw new Error('build failed');
      process.stdout.write('.'); await new Promise(r => setTimeout(r, 2000));
    }
    console.log(' done');

    const envr = await tw(auth, 'serverless.twilio.com', `/v1/Services/${svc.sid}/Environments`, 'POST', { UniqueName: 'prod', DomainSuffix: 'p' + rand() });
    await tw(auth, 'serverless.twilio.com', `/v1/Services/${svc.sid}/Environments/${envr.sid}/Deployments`, 'POST', { BuildSid: build.sid });
    const voiceUrl = `https://${envr.domain_name}/outbound`;

    const app = await tw(auth, 'api.twilio.com', `/2010-04-01/Accounts/${sid}/Applications.json`, 'POST', { FriendlyName: 'lead-dialer', VoiceUrl: voiceUrl, VoiceMethod: 'POST' });

    const envFile = [
      `TWILIO_ACCOUNT_SID=${sid}`,
      `TWILIO_API_KEY=${key.sid}`,
      `TWILIO_API_SECRET=${key.secret}`,
      `TWILIO_TWIML_APP_SID=${app.sid}`,
      `TWILIO_CALLER_ID=${pick}`, ''
    ].join('\n');
    fs.writeFileSync(path.join(__dirname, '.env'), envFile, { mode: 0o600 });

    console.log(`\n✓ All set. Your calling number is ${pick}.`);
    console.log('  Now run:  npm start   then open http://localhost:3333\n');
  } catch (e) {
    console.error('\n✗ Setup failed:', friendlyTwilioError(e.message));
    console.error('Nothing was charged unless a number purchase was confirmed. Fix the issue and re-run.\n');
  }
  rl.close();
})();

// Translates the handful of raw Twilio error strings people actually hit into plain English
// with a next step, instead of a cryptic API message with no indication what to do about it.
function friendlyTwilioError(msg) {
  const m = String(msg || '');
  const low = m.toLowerCase();
  if (low.includes('compliance profile') || low.includes('trust hub')) {
    return 'Twilio needs identity verification before this account can buy numbers. Go to console.twilio.com → Trust Hub and complete the compliance profile — or pick option 3 (use my own phone number) instead to skip this for now. (Raw error: ' + m + ')';
  }
  if (low.includes('unverified') && (low.includes('trial') || low.includes('verify'))) {
    return 'This is a Twilio trial account — it can only call numbers you\'ve manually verified. Add ~$20 credit in the Twilio console to upgrade, or verify this specific number first. (Raw error: ' + m + ')';
  }
  if (low.includes('authenticate')) {
    return 'Twilio rejected those credentials — double-check the Account SID and Auth Token from console.twilio.com. (Raw error: ' + m + ')';
  }
  return m;
}
