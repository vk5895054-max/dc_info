import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTemplateCreator1787300000000 implements MigrationInterface {
  name = 'AddTemplateCreator1787300000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('templates');
    if (!hasTable) return;
    for (const col of ['createdByEmail', 'createdByRole', 'resellerId', 'userId']) {
      if (!(await queryRunner.hasColumn('templates', col))) {
        await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN "${col}" varchar`);
      }
    }
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const col of ['userId', 'resellerId', 'createdByRole', 'createdByEmail']) {
      if (await queryRunner.hasColumn('templates', col)) {
        await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN "${col}"`);
      }
    }
  }
}
