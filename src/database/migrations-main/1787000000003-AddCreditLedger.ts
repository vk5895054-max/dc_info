import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCreditLedger1787000000003 implements MigrationInterface {
  name = 'AddCreditLedger1787000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const postgres = queryRunner.connection.options.type === 'postgres';
    const id = postgres ? ' DEFAULT gen_random_uuid()::varchar' : '';
    const timestamp = postgres ? 'timestamp' : 'datetime';
    const now = postgres ? 'CURRENT_TIMESTAMP' : "(datetime('now'))";
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "credit_ledger" ("id" varchar PRIMARY KEY NOT NULL${id}, "apiKeyId" varchar(64) NOT NULL, "messageType" varchar(32) NOT NULL, "units" integer NOT NULL, "balanceAfter" integer NOT NULL, "reference" varchar(120), "createdAt" ${timestamp} NOT NULL DEFAULT ${now})`,
    );
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_credit_ledger_apiKeyId_createdAt" ON "credit_ledger" ("apiKeyId", "createdAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_credit_ledger_apiKeyId_createdAt"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "credit_ledger"`);
  }
}