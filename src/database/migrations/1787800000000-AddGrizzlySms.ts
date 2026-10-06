import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGrizzlySms1787800000000 implements MigrationInterface {
  name = 'AddGrizzlySms1787800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('grizzly_orders')) return;
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';
    if (isPostgres) {
      await queryRunner.query(
        `CREATE TABLE "grizzly_orders" ("id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, "activationId" varchar(100) NOT NULL, "phone" varchar(40), "service" varchar(40) NOT NULL, "country" varchar(40) NOT NULL, "priceUsed" numeric(10,4), "status" varchar(40) NOT NULL DEFAULT 'pending', "rawResponse" text, "createdAt" timestamp NOT NULL DEFAULT NOW(), "updatedAt" timestamp NOT NULL DEFAULT NOW())`,
      );
      await queryRunner.query(
        `CREATE TABLE "grizzly_balance_snapshots" ("id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, "balance" numeric(12,4) NOT NULL, "currency" varchar(10), "rawResponse" text, "createdAt" timestamp NOT NULL DEFAULT NOW())`,
      );
    } else {
      await queryRunner.query(
        `CREATE TABLE "grizzly_orders" ("id" varchar PRIMARY KEY NOT NULL, "activationId" varchar(100) NOT NULL, "phone" varchar(40), "service" varchar(40) NOT NULL, "country" varchar(40) NOT NULL, "priceUsed" numeric(10,4), "status" varchar(40) NOT NULL DEFAULT ('pending'), "rawResponse" text, "createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')))`,
      );
      await queryRunner.query(
        `CREATE TABLE "grizzly_balance_snapshots" ("id" varchar PRIMARY KEY NOT NULL, "balance" numeric(12,4) NOT NULL, "currency" varchar(10), "rawResponse" text, "createdAt" datetime NOT NULL DEFAULT (datetime('now')))`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "grizzly_balance_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "grizzly_orders"`);
  }
}