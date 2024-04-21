import { loadSchema } from '@zenstackhq/testtools';
import path from 'path';

describe('With Policy: multiple id fields', () => {
    let origDir: string;

    beforeAll(async () => {
        origDir = path.resolve('.');
    });

    afterEach(() => {
        process.chdir(origDir);
    });

    it('multi-id fields crud', async () => {
        const { prisma, enhance } = await loadSchema(
            `
        model A {
            x String
            y Int
            value Int
            b B?
            @@id([x, y])

            @@allow('read', true)
            @@allow('create', value > 0)
        }

        model B {
            b1 String
            b2 String
            value Int
            a A @relation(fields: [ax, ay], references: [x, y])
            ax String
            ay Int

            @@allow('read', value > 2)
            @@allow('create', value > 1)

            @@unique([ax, ay])
            @@id([b1, b2])
        }
        `
        );

        const db = enhance();

        await expect(db.a.create({ data: { x: '1', y: 1, value: 0 } })).toBeRejectedByPolicy();
        await expect(db.a.create({ data: { x: '1', y: 2, value: 1 } })).toResolveTruthy();

        await expect(
            db.a.create({ data: { x: '2', y: 1, value: 1, b: { create: { b1: '1', b2: '2', value: 1 } } } })
        ).toBeRejectedByPolicy();

        const r = await db.a.create({
            include: { b: true },
            data: { x: '2', y: 1, value: 1, b: { create: { b1: '1', b2: '2', value: 2 } } },
        });
        expect(r.b).toBeNull();

        const r1 = await prisma.b.findUnique({ where: { b1_b2: { b1: '1', b2: '2' } } });
        expect(r1.value).toBe(2);

        await expect(
            db.a.create({
                include: { b: true },
                data: { x: '3', y: 1, value: 1, b: { create: { b1: '2', b2: '2', value: 3 } } },
            })
        ).toResolveTruthy();
    });

    it('multi-id fields id update', async () => {
        const { prisma, enhance } = await loadSchema(
            `
        model A {
            x String
            y Int
            value Int
            b B?
            @@id([x, y])

            @@allow('read', true)
            @@allow('create', value > 0)
            @@allow('update', value > 0 && future().value > 1)
        }

        model B {
            b1 String
            b2 String
            value Int
            a A @relation(fields: [ax, ay], references: [x, y])
            ax String
            ay Int

            @@allow('read', value > 2)
            @@allow('create', value > 1)

            @@unique([ax, ay])
            @@id([b1, b2])
        }
        `
        );

        const db = enhance();

        await db.a.create({ data: { x: '1', y: 2, value: 1 } });

        await expect(
            db.a.update({ where: { x_y: { x: '1', y: 2 } }, data: { x: '2', y: 3, value: 0 } })
        ).toBeRejectedByPolicy();

        await expect(
            db.a.update({ where: { x_y: { x: '1', y: 2 } }, data: { x: '2', y: 3, value: 2 } })
        ).resolves.toMatchObject({
            x: '2',
            y: 3,
            value: 2,
        });

        await expect(
            db.a.upsert({
                where: { x_y: { x: '2', y: 3 } },
                update: { x: '3', y: 4, value: 0 },
                create: { x: '4', y: 5, value: 5 },
            })
        ).toBeRejectedByPolicy();

        await expect(
            db.a.upsert({
                where: { x_y: { x: '2', y: 3 } },
                update: { x: '3', y: 4, value: 3 },
                create: { x: '4', y: 5, value: 5 },
            })
        ).resolves.toMatchObject({
            x: '3',
            y: 4,
            value: 3,
        });
    });

    it('multi-id auth', async () => {
        const { prisma, enhance } = await loadSchema(
            `
            model User {
                x String
                y String
                m M?
                n N?
                p P?
                q Q?
                @@id([x, y])
                @@allow('all', true)
            }

            model M {
                id String @id @default(cuid())
                owner User @relation(fields: [ownerX, ownerY], references: [x, y])
                ownerX String
                ownerY String
                @@unique([ownerX, ownerY])
                @@allow('all', auth() == owner)
            }

            model N {
                id String @id @default(cuid())
                owner User @relation(fields: [ownerX, ownerY], references: [x, y])
                ownerX String
                ownerY String
                @@unique([ownerX, ownerY])
                @@allow('all', auth().x == owner.x && auth().y == owner.y)
            }

            model P {
                id String @id @default(cuid())
                owner User @relation(fields: [ownerX, ownerY], references: [x, y])
                ownerX String
                ownerY String
                @@unique([ownerX, ownerY])
                @@allow('all', auth() != owner)
            }

            model Q {
                id String @id @default(cuid())
                owner User @relation(fields: [ownerX, ownerY], references: [x, y])
                ownerX String
                ownerY String
                @@unique([ownerX, ownerY])
                @@allow('all', auth() != null)
            }
            `
        );

        await prisma.user.create({ data: { x: '1', y: '1' } });
        await prisma.user.create({ data: { x: '1', y: '2' } });

        const anonDb = enhance();

        await expect(
            anonDb.m.create({ data: { owner: { connect: { x_y: { x: '1', y: '2' } } } } })
        ).toBeRejectedByPolicy();
        await expect(
            anonDb.m.create({ data: { owner: { connect: { x_y: { x: '1', y: '1' } } } } })
        ).toBeRejectedByPolicy();
        await expect(
            anonDb.n.create({ data: { owner: { connect: { x_y: { x: '1', y: '2' } } } } })
        ).toBeRejectedByPolicy();
        await expect(
            anonDb.n.create({ data: { owner: { connect: { x_y: { x: '1', y: '1' } } } } })
        ).toBeRejectedByPolicy();

        const db = enhance({ x: '1', y: '1' });

        await expect(db.m.create({ data: { owner: { connect: { x_y: { x: '1', y: '2' } } } } })).toBeRejectedByPolicy();
        await expect(db.m.create({ data: { owner: { connect: { x_y: { x: '1', y: '1' } } } } })).toResolveTruthy();
        await expect(db.n.create({ data: { owner: { connect: { x_y: { x: '1', y: '2' } } } } })).toBeRejectedByPolicy();
        await expect(db.n.create({ data: { owner: { connect: { x_y: { x: '1', y: '1' } } } } })).toResolveTruthy();
        await expect(db.p.create({ data: { owner: { connect: { x_y: { x: '1', y: '1' } } } } })).toBeRejectedByPolicy();
        await expect(db.p.create({ data: { owner: { connect: { x_y: { x: '1', y: '2' } } } } })).toResolveTruthy();

        await expect(
            enhance(undefined).q.create({ data: { owner: { connect: { x_y: { x: '1', y: '1' } } } } })
        ).toBeRejectedByPolicy();
        await expect(db.q.create({ data: { owner: { connect: { x_y: { x: '1', y: '2' } } } } })).toResolveTruthy();
    });

    it('multi-id to-one nested write', async () => {
        const { enhance } = await loadSchema(
            `
            model A {
                x Int
                y Int
                v Int
                b B @relation(fields: [bId], references: [id])
                bId Int @unique

                @@id([x, y])
                @@allow('all', v > 0)
            }

            model B {
                id Int @id
                v Int
                a A?
                
                @@allow('all', v > 0)
            }
            `
        );
        const db = enhance();
        await expect(
            db.b.create({
                data: {
                    id: 1,
                    v: 1,
                    a: {
                        create: {
                            x: 1,
                            y: 2,
                            v: 3,
                        },
                    },
                },
            })
        ).toResolveTruthy();

        await expect(
            db.a.update({
                where: { x_y: { x: 1, y: 2 } },
                data: { b: { update: { v: 5 } } },
            })
        ).toResolveTruthy();

        expect(await db.b.findUnique({ where: { id: 1 } })).toEqual(expect.objectContaining({ v: 5 }));
    });

    it('multi-id to-many nested write', async () => {
        const { enhance } = await loadSchema(
            `
            model A {
                x Int
                y Int
                v Int
                b B @relation(fields: [bId], references: [id])
                bId Int @unique

                @@id([x, y])
                @@allow('all', v > 0)
            }

            model B {
                id Int @id
                v Int
                a A[]
                c C?
                
                @@allow('all', v > 0)
            }

            model C {
                id Int @id
                v Int
                b B @relation(fields: [bId], references: [id])
                bId Int @unique

                @@allow('all', v > 0)
            }
            `
        );
        const db = enhance();
        await expect(
            db.b.create({
                data: {
                    id: 1,
                    v: 1,
                    a: {
                        create: {
                            x: 1,
                            y: 2,
                            v: 2,
                        },
                    },
                    c: {
                        create: {
                            id: 1,
                            v: 3,
                        },
                    },
                },
            })
        ).toResolveTruthy();

        await expect(
            db.a.update({
                where: { x_y: { x: 1, y: 2 } },
                data: { b: { update: { v: 5, c: { update: { v: 6 } } } } },
            })
        ).toResolveTruthy();

        expect(await db.b.findUnique({ where: { id: 1 } })).toEqual(expect.objectContaining({ v: 5 }));
        expect(await db.c.findUnique({ where: { id: 1 } })).toEqual(expect.objectContaining({ v: 6 }));
    });

    it('multi-id fields nested id update', async () => {
        const { enhance } = await loadSchema(
            `
        model A {
            x String
            y Int
            value Int
            b B @relation(fields: [bId], references: [id])
            bId Int
            @@id([x, y])

            @@allow('read', true)
            @@allow('create', value > 0)
            @@allow('update', value > 0 && future().value > 1)
        }

        model B {
            id Int @id @default(autoincrement())
            a A[]
            @@allow('all', true)
        }
        `
        );

        const db = enhance();

        await db.b.create({ data: { id: 1, a: { create: { x: '1', y: 1, value: 1 } } } });

        await expect(
            db.b.update({
                where: { id: 1 },
                data: { a: { update: { where: { x_y: { x: '1', y: 1 } }, data: { x: '2', y: 2, value: 0 } } } },
            })
        ).toBeRejectedByPolicy();

        await expect(
            db.b.update({
                where: { id: 1 },
                data: { a: { update: { where: { x_y: { x: '1', y: 1 } }, data: { x: '2', y: 2, value: 2 } } } },
                include: { a: true },
            })
        ).resolves.toMatchObject({ a: expect.arrayContaining([expect.objectContaining({ x: '2', y: 2, value: 2 })]) });

        await expect(
            db.b.update({
                where: { id: 1 },
                data: {
                    a: {
                        upsert: {
                            where: { x_y: { x: '2', y: 2 } },
                            update: { x: '3', y: 3, value: 0 },
                            create: { x: '4', y: '4', value: 4 },
                        },
                    },
                },
            })
        ).toBeRejectedByPolicy();

        await expect(
            db.b.update({
                where: { id: 1 },
                data: {
                    a: {
                        upsert: {
                            where: { x_y: { x: '2', y: 2 } },
                            update: { x: '3', y: 3, value: 3 },
                            create: { x: '4', y: '4', value: 4 },
                        },
                    },
                },
                include: { a: true },
            })
        ).resolves.toMatchObject({ a: expect.arrayContaining([expect.objectContaining({ x: '3', y: 3, value: 3 })]) });
    });
});
