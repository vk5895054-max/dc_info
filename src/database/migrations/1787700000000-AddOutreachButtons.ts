import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutreachButtons1787700000000 implements MigrationInterface {
  name = 'AddOutreachButtons1787700000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('outreach_campaigns');
    if (!hasTable) return;
    if (!(await queryRunner.hasColumn('outreach_campaigns', 'buttons'))) {
      await queryRunner.query(`ALTER TABLE "outreach_campaigns" ADD COLUMN "buttons" text`);
    }
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('outreach_campaigns', 'buttons')) {
      await queryRunner.query(`ALTER TABLE "outreach_campaigns" DROP COLUMN "buttons"`);
    }
  }
}
