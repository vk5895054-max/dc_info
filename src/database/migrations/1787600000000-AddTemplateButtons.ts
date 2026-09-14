import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTemplateButtons1787600000000 implements MigrationInterface {
  name = 'AddTemplateButtons1787600000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('templates');
    if (!hasTable) return;
    if (!(await queryRunner.hasColumn('templates', 'buttons'))) {
      await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN "buttons" text`);
    }
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('templates', 'buttons')) {
      await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN "buttons"`);
    }
  }
}
