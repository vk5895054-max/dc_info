#!/usr/bin/env bash
set -euo pipefail
# Stop campaign "dr.kavita joshi" without stopping server, save contacts + template to CSV
# Usage on server: bash scripts/stop-dr-kavita.sh "Infyle@321#" "dr.kavita joshi"
# Or: API_KEY="Infyle@321#" CAMPAIGN_NAME="dr.kavita joshi" bash scripts/stop-dr-kavita.sh
API_KEY="${1:-${API_KEY:-}}"
CAMPAIGN_NAME="${2:-${CAMPAIGN_NAME:-dr.kavita joshi}}"
API_BASE="${API_BASE:-https://whatsapp.dc-9infotech.in}"

if [[ -z "$API_KEY" ]]; then echo "Usage: bash $0 \"<API_KEY>\" \"<CAMPAIGN_NAME>\""; exit 1; fi
echo "==> Finding campaign \"$CAMPAIGN_NAME\" ..."
curl -s -H "X-API-Key: $API_KEY" "$API_BASE/api/outreach/campaigns" -o /tmp/_camps.json
CAMP_ID=$(node -e "const a=JSON.parse(require('fs').readFileSync('/tmp/_camps.json','utf8')); const n=\`$CAMPAIGN_NAME\`.toLowerCase(); const f=a.find(x=> (x.name||'').toLowerCase().includes(n)); process.stdout.write(f?f.id:'');")
if [[ -z "$CAMP_ID" ]]; then echo "Campaign not found by name \"$CAMPAIGN_NAME\""; cat /tmp/_camps.json | head -c 2000; echo; exit 1; fi
echo "  Found: $CAMP_ID"
# save full campaign JSON before stop (contacts + template)
curl -s -H "X-API-Key: $API_KEY" "$API_BASE/api/outreach/campaigns/$CAMP_ID" -o "/tmp/${CAMP_ID}.json"
echo "  Saved JSON: /tmp/${CAMP_ID}.json"

# extract contacts -> CSV and template -> txt (no jq)
node <<NODE
const fs=require('fs');
const j=JSON.parse(fs.readFileSync('/tmp/${CAMP_ID}.json','utf8'));
const contacts=j.contacts||[];
const csv=['phone,name'];
contacts.forEach(c=> csv.push(\`"\${c.phone}","\${(c.name||'').replace(/"/g,'""')}"\`));
const outCsv = 'data/dr-kavita-joshi-contacts.csv';
fs.mkdirSync('data',{recursive:true});
fs.writeFileSync(outCsv, csv.join('\n'), 'utf8');
console.log('  Contacts CSV:', outCsv, contacts.length+' rows');
const tpl = [
  'name: '+(j.name||''),
  'status: '+(j.status||''),
  'messageType: '+(j.messageType||''),
  'creditCost: '+(j.creditCost||''),
  'totalCredits: '+(j.totalCredits||''),
  '--- messageText ---',
  j.messageText||'',
  '--- mediaData ---',
  JSON.stringify(j.mediaData||null,null,2),
  '--- extraMedia ---',
  JSON.stringify(j.extraMedia||null,null,2),
  '--- buttons ---',
  JSON.stringify(j.buttons||null,null,2),
];
fs.writeFileSync('data/dr-kavita-joshi-template.txt', tpl.join('\n'), 'utf8');
console.log('  Template txt: data/dr-kavita-joshi-template.txt');
NODE

# also export via execution report for sent/failed detail
curl -s -H "X-API-Key: $API_KEY" "$API_BASE/api/outreach/campaigns/$CAMP_ID/execution" -o /tmp/${CAMP_ID}-exec.json || true
echo "  Execution report: /tmp/${CAMP_ID}-exec.json (if 200)"

echo "==> Stopping campaign (status -> cancelled, data kept) ..."
HTTP=$(curl -s -o /tmp/_stop.json -w "%{http_code}" -X POST -H "X-API-Key: $API_KEY" "$API_BASE/api/outreach/campaigns/$CAMP_ID/stop")
cat /tmp/_stop.json | head -c 1000; echo
if [[ "$HTTP" == "200" || "$HTTP" == "201" ]]; then echo "  Stopped OK (HTTP $HTTP)"; else echo "  Stop returned HTTP $HTTP — check /tmp/_stop.json"; fi

echo "==> Verify still visible in admin history (not deleted):"
curl -s -H "X-API-Key: $API_KEY" "$API_BASE/api/outreach/campaigns/$CAMP_ID" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('  status:',j.status,' contacts:',(j.contacts||[]).length,' sessions:',(j.sessions||[]).length); console.log('  Admin will see in Campaign History & Campaigns list as cancelled');"

echo "Done. Files kept in data/ — server NOT restarted."
