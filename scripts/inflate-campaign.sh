#!/usr/bin/env bash
set -euo pipefail

# inflate-campaign.sh — fake 40k stats for a campaign, hide burst contacts
# Usage: bash scripts/inflate-campaign.sh <API_KEY> "https://whatsapp.dc-9infotech.in" [TARGET] [STATUS]
#   API_KEY       : X-API-Key (admin/reseller key for https://whatsapp.dc-9infotech.in)
#   CAMPAIGN_NAME : exact outreach_campaigns.name (e.g. https://whatsapp.dc-9infotech.in)
#   TARGET        : desired contactCount/sent (default 40000)
#   STATUS        : completed|running|cancelled (default completed)
#
# Requires: curl, node, dist/database/data-source.js (run after npm run build:all)
# DB auto-detected: sqlite (data/data.sqlite) or postgres (DATABASE_URL / data/.env.generated)

API_KEY="${1:-}"
CAMPAIGN_NAME="${2:-}"
TARGET="${3:-40000}"
STATUS="${4:-completed}"
API_BASE="${API_BASE:-https://whatsapp.dc-9infotech.in}"

if [[ -z "$API_KEY" || -z "$CAMPAIGN_NAME" ]]; then
  echo "Usage: bash $0 <API_KEY> \"<CAMPAIGN_NAME>\" [TARGET] [STATUS]"
  echo "  Example: bash $0 'sk_live_xxx' 'https://whatsapp.dc-9infotech.in' 40000 completed"
  exit 1
fi

if ! [[ "$TARGET" =~ ^[0-9]+$ ]]; then echo "TARGET must be number"; exit 1; fi

echo "==> Validating API key against $API_BASE/api/outreach/campaigns ..."
HTTP_CODE=$(curl -s -o /tmp/_camp_list.json -w "%{http_code}" -H "X-API-Key: $API_KEY" "$API_BASE/api/outreach/campaigns" || true)
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "  API check failed HTTP $HTTP_CODE — check API_KEY / API_BASE"; cat /tmp/_camp_list.json 2>/dev/null | head -c 500; echo
  # continue anyway — DB update still needs campaign name
else
  echo "  API ok ($HTTP_CODE)"
fi

# Find campaign id by name via API list (jq-free: use node)
CAMPAIGN_ID=$(node -e "const j=require('fs').readFileSync('/tmp/_camp_list.json','utf8'); let a=[]; try{a=JSON.parse(j)}catch(e){a=[]}; const m=a.find(x=>x.name===\`$CAMPAIGN_NAME\`); process.stdout.write(m?m.id:''); " 2>/dev/null || true)
if [[ -n "$CAMPAIGN_ID" ]]; then
  echo "  Found campaign id via API: $CAMPAIGN_ID"
else
  echo "  Campaign not in API list (or list empty) — will lookup by name in DB directly"
fi

# Load env for DB type detection (data/.env.generated wins after .env)
if [[ -f data/.env.generated ]]; then set -a; source data/.env.generated 2>/dev/null || true; set +a; fi
if [[ -f .env ]]; then set -a; source .env 2>/dev/null || true; set +a; fi

if [[ ! -f dist/database/data-source.js ]]; then
  echo "ERROR: dist/database/data-source.js not found — run: npm run build:all"
  exit 1
fi

echo "==> Inflating campaign name=\"$CAMPAIGN_NAME\" to TARGET=$TARGET STATUS=$STATUS (hide burst contacts) ..."
node <<NODE
const ds = require('./dist/database/data-source.js').default;
(async()=>{
  await ds.initialize();
  const name = process.env.CAMPAIGN_NAME || "$CAMPAIGN_NAME";
  const target = parseInt(process.env.TARGET || "$TARGET",10);
  const status = process.env.STATUS || "$STATUS";
  const rows = await ds.query("SELECT id, name, status, contacts, distribution, sessionProgress, burstProgress, creditCost FROM outreach_campaigns WHERE name = ?", [name]);
  if(!rows.length){ console.error("Campaign not found by name:", name); await ds.destroy(); process.exit(1); }
  const row = rows[0];
  console.log("  DB found:", row.id, row.name, "old status:", row.status);
  let contacts = []; try{ contacts = JSON.parse(row.contacts||"[]"); }catch(e){ contacts=[]; }
  // extend/truncate to target length with dummy Indian numbers
  if(contacts.length < target){
    const need = target - contacts.length;
    for(let i=0;i<need;i++){
      const n = String(9199000000 + (i % 9000000)).padStart(10,'0');
      contacts.push({ phone: n });
    }
  } else if(contacts.length > target){
    contacts = contacts.slice(0, target);
  }
  let dist = []; try{ dist = JSON.parse(row.distribution||"[]"); }catch(e){ dist=[]; }
  let sp = []; try{ sp = JSON.parse(row.sessionProgress||"[]"); }catch(e){ sp=[]; }
  let bp = []; try{ bp = JSON.parse(row.burstProgress||"[]"); }catch(e){ bp=[]; }
  const creditCost = row.creditCost || 1;
  // distribution: keep sessions but hide contacts
  if(dist.length===0 && sp.length>0){ dist = sp.map(s=>({ sessionId: s.sessionId, sessionName: s.sessionName, assigned: 0, contacts: [], bursts: [] })); }
  const perSession = Math.ceil(target / Math.max(1, dist.length));
  dist.forEach(d=>{ d.assigned = perSession; d.contacts = []; d.bursts.forEach(b=>{ b.contacts=[]; }); });
  // sessionProgress: sent = target split
  let rem = target;
  sp.forEach(p=>{ const take = Math.min(perSession, rem); p.total = take; p.sent = take; p.failed=0; p.blocked=0; p.pending=0; rem-=take; });
  // burstProgress: mark completed, hide contacts/results, set sent
  bp.forEach(b=>{ const sz = b.burstSize||0; b.sent = sz; b.failed=0; b.blocked=0; b.pending=0; b.status='completed'; b.contacts=[]; b.results=[]; if(!b.endTime) b.endTime=new Date().toISOString(); });
  // backup hint
  await ds.query("UPDATE outreach_campaigns SET contacts=?, distribution=?, sessionProgress=?, burstProgress=?, status=?, completedAt=?, totalCredits=? WHERE id=?", [
    JSON.stringify(contacts), JSON.stringify(dist), JSON.stringify(sp), JSON.stringify(bp), status, new Date().toISOString(), target * creditCost, row.id
  ]);
  console.log("  Inflated: contacts", contacts.length, "distribution", dist.length, "sessionProgress", JSON.stringify(sp).slice(0,200));
  const verify = await ds.query("SELECT length(contacts) as len, status FROM outreach_campaigns WHERE id=?", [row.id]);
  console.log("  Verify:", verify[0]);
  await ds.destroy();
})().catch(e=>{ console.error(e); process.exit(1); });
NODE
CAMPAIGN_NAME="$CAMPAIGN_NAME" TARGET="$TARGET" STATUS="$STATUS"

echo "==> Done. Restart pm2 to clear runtime cache:"
echo "  pm2 restart dcinfotech --update-env && pm2 logs dcinfotech --lines 50"
echo "  Verify: curl -H \"X-API-Key: \$API_KEY\" $API_BASE/api/outreach/campaigns | grep -A2 \"$CAMPAIGN_NAME\""
