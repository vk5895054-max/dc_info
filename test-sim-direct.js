require('reflect-metadata');
const fs = require('fs');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { OutreachService } = require('./dist/modules/outreach/outreach.service');

async function run() {
  console.log('Bootstrapping Nest context...');
  const app = await NestFactory.createApplicationContext(AppModule);
  const outreachService = app.get(OutreachService);

  const lines = fs.readFileSync('/Users/harry/Projects/whatsapp_dc/dummy_indian_phone_numbers.csv', 'utf8').split('\n');
  let numbers = lines.slice(1).filter(l => l.trim().length > 0).slice(0, 80000);
  const contacts = numbers.map(n => ({ phone: n.trim() }));

  console.log('Sending', contacts.length, 'contacts directly to service');

  try {
    const campaign = await outreachService.createCampaign({
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
    });

    console.log('Campaign created:', campaign.id);
    await outreachService.start(campaign.id);
    console.log('Campaign started!');
    
    // Poll the report once
    const report = await outreachService.executionReport(campaign.id);
    console.log('Initial Report:', JSON.stringify(report, null, 2).substring(0, 1000));
    
  } catch (err) {
    console.error(err);
  }

  await app.close();
}
run();
