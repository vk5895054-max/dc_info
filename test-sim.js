const fs = require('fs');

async function run() {
  const lines = fs.readFileSync('/Users/harry/Projects/whatsapp_dc/dummy_indian_phone_numbers.csv', 'utf8').split('\n');
  let numbers = lines.slice(1).filter(l => l.trim().length > 0).slice(0, 80000);
  const contacts = numbers.map(n => ({ phone: n.trim() }));

  console.log('Sending', contacts.length, 'contacts');

  const res = await fetch('http://localhost:2785/api/outreach/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Simulated 80k',
      messageText: 'Hello this is a test message.',
      sessions: [{ sessionName: 'test' }],
      simulatedMode: true,
      simulatedSuccessRate: 64,
      contacts: contacts,
      strategy: {
        burstSize: 30,
        cooldownMinMs: 3000,
        cooldownMaxMs: 6000,
        pacing: { minDelayMs: 100, maxDelayMs: 200 }
      }
    })
  });
  const data = await res.json();
  console.log('Create Response:', Object.keys(data).includes('id') ? 'Success ID: ' + data.id : data);

  if (data.id) {
    const startRes = await fetch('http://localhost:2785/api/outreach/campaigns/' + data.id + '/action/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: data.id })
    });
    console.log('Start Response:', await startRes.json());
    console.log('Now run: curl http://localhost:2785/api/outreach/campaigns/' + data.id + '/report');
  }
}
run();
