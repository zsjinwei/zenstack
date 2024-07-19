import { loadSchemaNew } from '@zenstackhq/testtools';

describe('test new runner', () => {
    it('should work', async () => {
        await loadSchemaNew(`
            model User {
                id String @id @default(cuid())
                email String
            }
        `);
    });
});
