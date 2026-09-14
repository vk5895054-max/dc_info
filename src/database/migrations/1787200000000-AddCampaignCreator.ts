import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCampaignCreator1787200000000 implements MigrationInterface {
  name = 'AddCampaignCreator1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('outreach_campaigns');
    if (!hasTable) return;
    if (!(await queryRunner.hasColumn('outreach_campaigns', 'createdByEmail'))) {
      await queryRunner.query(`ALTER TABLE "outreach_campaigns" ADD COLUMN "createdByEmail" varchar`);
    }
    if (!(await queryRunner.hasColumn('outreach_campaigns', 'createdByRole'))) {
      await queryRunner.query(`ALTER TABLE "outreach_campaigns" ADD COLUMN "createdByRole" varchar`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('outreach_campaigns', 'createdByEmail')) {
      await queryRunner.query(`ALTER TABLE "outreach_campaigns" DROP COLUMN "createdByEmail"`);
    }
    if (await queryRunner.hasColumn('outreach_campaigns', 'createdByRole')) {
      await queryRunner.query(`ALTER TABLE "outreach_campaigns" DROP COLUMN "createdByRole"`);
    }
  }
}
