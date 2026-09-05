import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddResellerParent1787400000000 implements MigrationInterface {
  name = 'AddResellerParent1787400000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('reseller_users');
    if (!hasTable) return;
    for (const col of ['parentId', 'parentEmail', 'parentApiKeyId']) {
      if (!(await queryRunner.hasColumn('reseller_users', col))) {
        await queryRunner.query(`ALTER TABLE "reseller_users" ADD COLUMN "${col}" varchar`);
      }
    }
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const col of ['parentApiKeyId', 'parentEmail', 'parentId']) {
      if (await queryRunner.hasColumn('reseller_users', col)) {
        await queryRunner.query(`ALTER TABLE "reseller_users" DROP COLUMN "${col}"`);
      }
    }
  }
}
