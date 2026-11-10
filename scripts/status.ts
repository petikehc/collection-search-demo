/**
 * What is deployed, and what is costing money by the hour right now.
 *
 *   pnpm status           # stacks, hourly-billed resources, account settings
 *   pnpm status --cost    # also month-to-date spend by service (Cost Explorer: $0.01 per call)
 */
import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { accountSettings, hourlyBillable, projectStacks } from './lib/inventory.js';

export async function printStatus(): Promise<void> {
  const [stacks, billable, settings] = await Promise.all([
    projectStacks(),
    hourlyBillable(),
    accountSettings(),
  ]);

  console.log('Stacks');
  if (stacks.length === 0) console.log('  (none)');
  for (const s of stacks) console.log(`  ${s.name.padEnd(28)} ${s.status}`);

  console.log('\nBilled by the hour (whole region, not only this project)');
  if (billable.length === 0) console.log('  nothing');
  let perHour = 0;
  for (const b of billable) {
    perHour += b.perHour ?? 0;
    const price = b.perHour === undefined ? 'price unknown' : `~$${b.perHour.toFixed(3)}/h`;
    const note = b.expected ? '  (expected: kept running)' : '  <-- check this';
    console.log(`  ${b.service}: ${b.name}  ${b.detail}  ${price}${note}`);
  }
  if (perHour > 0) {
    console.log(`  Estimated: ~$${perHour.toFixed(3)}/h, ~$${(perHour * 24).toFixed(2)}/day`);
  }

  console.log('\nAccount settings this project changes');
  for (const s of settings) console.log(`  ${s.name.padEnd(28)} ${s.value}`);
}

async function printMonthToDateCost(): Promise<void> {
  const ce = new CostExplorerClient({ region: 'us-east-1' });
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const res = await ce.send(
    new GetCostAndUsageCommand({
      TimePeriod: { Start: day(start), End: day(end) },
      Granularity: 'MONTHLY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    }),
  );
  const rows = (res.ResultsByTime?.[0]?.Groups ?? [])
    .map((g) => ({ service: g.Keys?.[0] ?? '?', usd: Number(g.Metrics?.UnblendedCost?.Amount) }))
    .filter((r) => r.usd >= 0.005)
    .sort((a, b) => b.usd - a.usd);
  const total = rows.reduce((sum, r) => sum + r.usd, 0);
  console.log('\nMonth-to-date spend (Cost Explorer lags by up to a day)');
  for (const r of rows) console.log(`  ${r.service.padEnd(44)} $${r.usd.toFixed(2)}`);
  console.log(`  ${'Total'.padEnd(44)} $${total.toFixed(2)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await printStatus();
  if (process.argv.includes('--cost')) await printMonthToDateCost();
}
