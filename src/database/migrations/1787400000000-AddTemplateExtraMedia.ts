import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTemplateExtraMedia1787400000000 implements MigrationInterface {
  name = 'AddTemplateExtraMedia1787400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('templates');
    if (!hasTable) return;
    if (!(await queryRunner.hasColumn('templates', 'extraMedia'))) {
      await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN "extraMedia" text`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('templates', 'extraMedia')) {
      await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN "extraMedia"`);
    }
  }
}
