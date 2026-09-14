import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTemplateMediaFields1787100000000 implements MigrationInterface {
  name = 'AddTemplateMediaFields1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('templates');
    if (!hasTable) return;
    const columns = [
      { name: 'mediaType', type: 'varchar', length: '20', default: "'text'" },
      { name: 'mediaUrl', type: 'text', isNullable: true },
      { name: 'mediaBase64', type: 'text', isNullable: true },
      { name: 'mimetype', type: 'varchar', length: '120', isNullable: true },
      { name: 'filename', type: 'varchar', length: '255', isNullable: true },
      { name: 'caption', type: 'text', isNullable: true },
      { name: 'supabasePath', type: 'varchar', length: '255', isNullable: true },
    ];
    for (const col of columns) {
      if (!(await queryRunner.hasColumn('templates', col.name))) {
        const type = col.type === 'text' ? 'text' : `varchar${col.length ? `(${col.length})` : ''}`;
        const nullable = col.isNullable ? '' : ' NOT NULL';
        const def = col.default !== undefined ? ` DEFAULT ${col.default}` : '';
        await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN "${col.name}" ${type}${nullable}${def}`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of ['supabasePath', 'caption', 'filename', 'mimetype', 'mediaBase64', 'mediaUrl', 'mediaType']) {
      if (await queryRunner.hasColumn('templates', name)) {
        await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN "${name}"`);
      }
    }
  }
}
