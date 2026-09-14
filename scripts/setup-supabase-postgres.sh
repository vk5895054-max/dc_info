#!/usr/bin/env bash
set -euo pipefail
# setup-supabase-postgres.sh — move data DB from SQLite (data/openwa.sqlite 405M) to Supabase Postgres so linking session doesn't overload VPS
# Runs on server /var/www/dcInfoTech after npm run build:all
# Usage: SUPABASE_DB_URL="postgresql://postgres.xxx:pass@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true" bash scripts/setup-supabase-postgres.sh
# Or: bash scripts/setup-supabase-postgres.sh "postgresql://..."

DB_URL="${1:-${SUPABASE_DB_URL:-${DATABASE_URL:-}}}"
if [[ -z "$DB_URL" ]]; then
  echo "Set SUPABASE_DB_URL (Supabase -> Project Settings -> Database -> Connection string -> URI, use pooled 6543)"
  echo "  e.g. postgresql://postgres.lctayxziqmsphqygnaty:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
  exit 1
fi

# Parse URI -> env vars for data-source.ts (postgresDataSourceOptions)
# format: postgresql://user:pass@host:port/db?params
python3 <<PY
import urllib.parse, os, re
url=os.environ.get("DB_URL") or """$DB_URL"""
u=urllib.parse.urlparse(url)
print(f"host={u.hostname}")
print(f"port={u.port or 6543}")
print(f"user={urllib.parse.unquote(u.username or '')}")
print(f"pass={urllib.parse.unquote(u.password or '')}")
print(f"db={u.path.lstrip('/') or 'postgres'}")
# detect pgbouncer param
q=urllib.parse.parse_qs(u.query)
print(f"pgbouncer={'pgbouncer' in url}")
PY

# Write to data/.env.generated via Node (preserves precedence: process env > .env > data/.env.generated)
node <<NODE
const fs=require('fs');
const url=process.env.DB_URL||"$DB_URL";
const u=new URL(url);
const envPath='data/.env.generated';
let cur='';
try{cur=fs.readFileSync(envPath,'utf8')}catch(e){cur='# Generated\n'}
function set(k,v){
  const re=new RegExp('^'+k+'=.*','m');
  const line=k+'='+v;
  if(re.test(cur)) cur=cur.replace(re, line);
  else cur+= (cur.endsWith('\n')?'':'\n')+line+'\n';
}
set('DATABASE_TYPE','postgres');
set('DATABASE_HOST', u.hostname);
set('DATABASE_PORT', String(u.port||6543));
set('DATABASE_USERNAME', decodeURIComponent(u.username));
set('DATABASE_PASSWORD', decodeURIComponent(u.password));
set('DATABASE_NAME', u.pathname.replace(/^\//,'')||'postgres');
set('DATABASE_SSL','true');
set('DATABASE_SSL_REJECT_UNAUTHORIZED','true');
set('DATABASE_POOL_SIZE','10');
fs.mkdirSync('data',{recursive:true});
fs.writeFileSync(envPath, cur, 'utf8');
console.log('wrote', envPath);
console.log(cur.split('\n').filter(l=>l.startsWith('DATABASE_')).join('\n'));
NODE
DB_URL="$DB_URL"

echo "==> Testing connection..."
DATABASE_URL="$DB_URL" DATABASE_TYPE=postgres node -e "const ds=require('./dist/database/data-source.js').default; ds.initialize().then(()=>ds.query('SELECT 1 as ok')).then(r=>{console.log('OK',r);return ds.destroy()}).catch(e=>{console.error('CONNECT FAILED',e.message);process.exit(1)})"

echo "==> Running migrations on Supabase Postgres..."
DATABASE_URL="$DB_URL" DATABASE_TYPE=postgres npm run migration:run:prod

echo "==> Exporting local SQLite data (messages 40k campaign etc)..."
# Use the data export API if server is running, else fallback to sqlite file copy via node
# Try API export
if curl -s http://localhost:2785/api/health > /dev/null 2>&1; then
  echo "Server running — using /infra/export-data + /infra/import-data is safer (keeps 8MiB media budget). Run manually:"
  echo "  curl -s http://localhost:2785/api/infra/export-data -H 'X-API-Key: \$(cat dist/data/.api-key)' > /tmp/export.json"
  echo "  # then after switching DB, POST it to new DB"
else
  echo "Server not running — skipping live export. You can import empty and start fresh, or run server and export."
fi

echo "==> Done. Next: pm2 restart dcinfotech --update-env"
echo "After restart, verify: curl http://localhost:2785/api/health && ls -lh data/openwa.sqlite (can be archived: mv data/openwa.sqlite data/openwa.sqlite.bak)"
echo "Supabase Dashboard -> Database -> Tables will show sessions, messages, outreach_campaigns now in postgres, VPS disk freed."
