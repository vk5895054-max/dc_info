import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutreachMultiMessage1787500000000 implements MigrationInterface {
  name = 'AddOutreachMultiMessage1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('outreach_campaigns');
    if (!hasTable) return;
    if (!(await queryRunner.hasColumn('outreach_campaigns', 'extraMedia'))) {
      await queryRunner.query(`ALTER TABLE "outreach_campaigns" ADD COLUMN "extraMedia" text`);
    }
    if (!(await queryRunner.hasColumn('outreach_campaigns', 'isMulti'))) {
      await queryRunner.query(`ALTER TABLE "outreach_campaigns" ADD COLUMN "isMulti" boolean DEFAULT false`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('outreach_campaigns', 'extraMedia')) {
      await queryRunner.query(`ALTER TABLE "outreach_campaigns" DROP COLUMN "extraMedia"`);
    }
    if (await queryRunner.hasColumn('outreach_campaigns', 'isMulti')) {
      await queryRunner.query(`ALTER TABLE "outreach_campaigns" DROP COLUMN "isMulti"`);
    }
  }
}
