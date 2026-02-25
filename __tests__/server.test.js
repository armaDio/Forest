const path = require('path');
const fs = require('fs').promises;
const request = require('supertest');

// Use a temporary data directory for tests
const TEST_DATA_DIR = path.join(__dirname, '..', 'data-test');
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.AUTH_USERNAME = 'testuser';
process.env.AUTH_PASSWORD_HASH = 'testpass';

// Import app after env vars are set
// eslint-disable-next-line global-require
const { app } = require('../server');

async function resetTestDataDir() {
    await fs.rm(TEST_DATA_DIR, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(TEST_DATA_DIR, { recursive: true });
}

describe('API routes', () => {
    let agent;

    beforeAll(async () => {
        await resetTestDataDir();
        agent = request.agent(app);
    });

    beforeEach(async () => {
        await resetTestDataDir();
    });

    describe('Authentication', () => {
        test('rejects invalid login', async () => {
            const res = await agent
                .post('/api/login')
                .send({ username: 'wrong', password: 'nope' });
            expect(res.status).toBe(401);
        });

        test('accepts valid login and sets session', async () => {
            const res = await agent
                .post('/api/login')
                .send({ username: 'testuser', password: 'testpass' });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const statusRes = await agent.get('/api/auth/status');
            expect(statusRes.status).toBe(200);
            expect(statusRes.body.authenticated).toBe(true);
        });
    });

    describe('Collection and bought', () => {
        beforeEach(async () => {
            await agent.post('/api/login').send({ username: 'testuser', password: 'testpass' });
        });

        test('reads empty collection by default', async () => {
            const res = await agent.get('/api/collection');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({});
        });

        test('saves and reads collection', async () => {
            const payload = { 'card-1': true, 'card-2': false };
            const saveRes = await agent.post('/api/collection').send(payload);
            expect(saveRes.status).toBe(200);
            expect(saveRes.body.success).toBe(true);

            const readRes = await agent.get('/api/collection');
            expect(readRes.status).toBe(200);
            expect(readRes.body).toEqual(payload);
        });

        test('reads and writes bought cards', async () => {
            const saveRes = await agent.post('/api/bought').send({ 'card-1': true });
            expect(saveRes.status).toBe(200);
            expect(saveRes.body.success).toBe(true);

            const readRes = await agent.get('/api/bought');
            expect(readRes.status).toBe(200);
            expect(readRes.body).toEqual({ 'card-1': true });
        });
    });

    describe('Gifts', () => {
        const sampleCardId = 'sample-card-123';

        beforeEach(async () => {
            await agent.post('/api/login').send({ username: 'testuser', password: 'testpass' });
        });

        test('allows creating a gift without auth', async () => {
            const res = await request(app)
                .post('/api/gifts')
                .send({ cardId: sampleCardId, giverName: 'Alice' });
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.gift.cardId).toBe(sampleCardId);
            expect(res.body.gift.giverName).toBe('Alice');
            expect(res.body.gift.status).toBe('pending');
        });

        test('returns pending gifts for authenticated user', async () => {
            // Create a few gifts (public)
            await request(app).post('/api/gifts').send({ cardId: sampleCardId, giverName: 'Alice' });
            await request(app).post('/api/gifts').send({ cardId: 'other-card', giverName: 'Bob' });

            const res = await agent.get('/api/gifts/pending');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeGreaterThanOrEqual(2);
            expect(res.body[0]).toHaveProperty('cardId');
            expect(res.body[0]).toHaveProperty('giverName');
            expect(res.body[0]).toHaveProperty('status', 'pending');
        });

        test('accepting a gift marks card collected and updates gift', async () => {
            const createRes = await request(app)
                .post('/api/gifts')
                .send({ cardId: sampleCardId, giverName: 'Alice' });
            const giftId = createRes.body.gift.id;

            const acceptRes = await agent.post(`/api/gifts/${giftId}/accept`);
            expect(acceptRes.status).toBe(200);
            expect(acceptRes.body.success).toBe(true);
            expect(acceptRes.body.gift.status).toBe('accepted');
            expect(acceptRes.body.collection[sampleCardId]).toBe(true);

            const cardGiftRes = await request(app).get(`/api/gifts/card/${sampleCardId}`);
            expect(cardGiftRes.status).toBe(200);
            expect(cardGiftRes.body.gift).toBeTruthy();
            expect(cardGiftRes.body.gift.giverName).toBe('Alice');
        });

        test('rejecting a gift marks it rejected and does not touch collection', async () => {
            const createRes = await request(app)
                .post('/api/gifts')
                .send({ cardId: sampleCardId, giverName: 'Mallory' });
            const giftId = createRes.body.gift.id;

            const rejectRes = await agent.post(`/api/gifts/${giftId}/reject`);
            expect(rejectRes.status).toBe(200);
            expect(rejectRes.body.success).toBe(true);
            expect(rejectRes.body.gift.status).toBe('rejected');

            const collectionRes = await agent.get('/api/collection');
            expect(collectionRes.status).toBe(200);
            expect(collectionRes.body[sampleCardId]).toBeUndefined();
        });

        test('card gift endpoint returns null when no accepted gifts', async () => {
            const res = await request(app).get('/api/gifts/card/non-existent-card');
            expect(res.status).toBe(200);
            expect(res.body.gift).toBeNull();
        });
    });
});

