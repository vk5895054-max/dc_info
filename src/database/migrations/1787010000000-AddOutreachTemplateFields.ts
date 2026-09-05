import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutreachTemplateFields1787010000000 implements MigrationInterface {
  name = 'AddOutreachTemplateFields1787010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('outreach_campaigns');
    if (!hasTable) return;
    const columns = [
      { name: 'templateId', type: 'varchar', isNullable: true },
      { name: 'messageType', type: 'varchar', length: '20', default: "'text'" },
      { name: 'mediaData', type: 'text', isNullable: true },
      { name: 'creditCost', type: 'int', default: 1 },
      { name: 'totalCredits', type: 'int', default: 0 },
      { name: 'resellerId', type: 'varchar', isNullable: true },
      { name: 'userId', type: 'varchar', isNullable: true },
    ];
    for (const col of columns) {
      if (!(await queryRunner.hasColumn('outreach_campaigns', col.name))) {
        const type = col.type === 'text' ? 'text' : col.type === 'varchar' ? `varchar${col.length ? `(${col.length})` : ''}` : col.type;
        const nullable = col.isNullable ? '' : ' NOT NULL';
        const def = col.default !== undefined ? ` DEFAULT ${col.default}` : '';
        await queryRunner.query(`ALTER TABLE "outreach_campaigns" ADD COLUMN "${col.name}" ${type}${nullable}${def}`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of ['userId', 'resellerId', 'totalCredits', 'creditCost', 'mediaData', 'messageType', 'templateId']) {
      if (await queryRunner.hasColumn('outreach_campaigns', name)) {
        await queryRunner.query(`ALTER TABLE "outreach_campaigns" DROP COLUMN "${name}"`);
      }
    }
  }
}
