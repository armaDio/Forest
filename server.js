const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Base data directory (overridable for tests)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

// Authentication credentials
const AUTH_USERNAME = process.env.AUTH_USERNAME;
const AUTH_PASSWORD_HASH = process.env.AUTH_PASSWORD_HASH; // Plain text default (insecure!)

// File paths
const COLLECTION_FILE = path.join(DATA_DIR, 'collection.json');
const BOUGHT_FILE = path.join(DATA_DIR, 'bought.json');
const CARDTRADER_TOKEN_FILE = path.join(DATA_DIR, 'cardtrader_token.txt');
const CARDTRADER_BLUEPRINTS_CACHE_DIR = path.join(DATA_DIR, 'cardtrader_blueprints_cache');
const CARDTRADER_EXPANSIONS_CACHE = path.join(DATA_DIR, 'cardtrader_expansions_cache.json');
const CARDTRADER_OVERRIDES_FILE = path.join(DATA_DIR, 'cardtrader_overrides.json');
const GIFTS_FILE = path.join(DATA_DIR, 'gifts.json');

// --- Middleware ---
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
if (IS_PRODUCTION) {
    app.set('trust proxy', 1);
}
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: IS_PRODUCTION,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));
app.use(express.static(__dirname));

// --- Helper functions ---
async function readDataFile(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') return {};
        throw err;
    }
}

async function writeDataFile(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function getCardtraderToken() {
    try {
        const token = await fs.readFile(CARDTRADER_TOKEN_FILE, 'utf8');
        return token.trim();
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        console.error('Error reading Cardtrader token:', err);
        return null;
    }
}

// Ensure data directories exist
async function ensureDataDir() {
    try { await fs.access(DATA_DIR); } catch { await fs.mkdir(DATA_DIR, { recursive: true }); }
    try { await fs.access(CARDTRADER_BLUEPRINTS_CACHE_DIR); } catch { await fs.mkdir(CARDTRADER_BLUEPRINTS_CACHE_DIR, { recursive: true }); }
}
ensureDataDir().catch(console.error);

// Gifts helpers
async function readGifts() {
    try {
        const data = await fs.readFile(GIFTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
}

async function writeGifts(gifts) {
    await fs.writeFile(GIFTS_FILE, JSON.stringify(gifts, null, 2), 'utf8');
}

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) return next();
    res.status(401).json({ error: 'Authentication required' });
}

// --- Cardtrader Expansions / Blueprints ---
async function getCachedCardtraderExpansions() {
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const token = await getCardtraderToken();
    if (!token) throw new Error('Cardtrader token not available');

    try {
        const cacheRaw = await fs.readFile(CARDTRADER_EXPANSIONS_CACHE, 'utf8');
        const cache = JSON.parse(cacheRaw);
        if (Date.now() - cache.timestamp < ONE_DAY) return cache.expansions;
    } catch {}

    console.log('Fetching expansions from Cardtrader API...');
    const res = await fetch('https://api.cardtrader.com/api/v2/expansions', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Failed to fetch expansions: ${res.status}`);
    const json = await res.json();
    const expansions = json.filter(exp => exp.game_id === 1);
    await fs.writeFile(CARDTRADER_EXPANSIONS_CACHE, JSON.stringify({ timestamp: Date.now(), expansions }, null, 2), 'utf8');
    return expansions;
}

async function getCachedExpansionBlueprints(expansionId) {
    const token = await getCardtraderToken();
    if (!token) throw new Error('Cardtrader token not available');

    const cacheFile = path.join(CARDTRADER_BLUEPRINTS_CACHE_DIR, `expansion_${expansionId}.json`);
    try {
        const raw = await fs.readFile(cacheFile, 'utf8');
        const cache = JSON.parse(raw);
        return cache.cards;
    } catch {}

    console.log(`Fetching blueprints for expansion ${expansionId} from Cardtrader API...`);
    const url = `https://api.cardtrader.com/api/v2/blueprints/export?expansion_id=${expansionId}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Failed to fetch blueprints for expansion ${expansionId}: ${res.status}`);
    const cards = await res.json();
    await fs.writeFile(cacheFile, JSON.stringify({ timestamp: Date.now(), cards }, null, 2), 'utf8');
    return cards;
}

// --- Cardtrader Overrides ---
async function readCardtraderOverrides() {
    try {
        const data = await fs.readFile(CARDTRADER_OVERRIDES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') return {};
        throw err;
    }
}

async function writeCardtraderOverrides(overrides) {
    await fs.writeFile(CARDTRADER_OVERRIDES_FILE, JSON.stringify(overrides, null, 2), 'utf8');
}

// --- Routes ---

// Cardtrader availability
app.get('/api/cardtrader/available', requireAuth, async (req, res) => {
    try {
        const token = await getCardtraderToken();
        res.json({ available: !!token });
    } catch (err) {
        console.error('Error checking Cardtrader token:', err);
        res.json({ available: false });
    }
});

// Cardtrader redirect
app.post('/api/cardtrader/redirect', async (req, res) => {
    try {
        const { expansionCode, collectorNumber } = req.body;
        if (!expansionCode || !collectorNumber) return res.status(400).json({ error: 'Missing expansionCode or collectorNumber' });

        const expansions = await getCachedCardtraderExpansions();
        const expansion = expansions.find(exp => exp.code && exp.code.toUpperCase() === expansionCode.toUpperCase());
        if (!expansion) return res.status(404).json({ error: 'Expansion not found on Cardtrader' });

        const cards = await getCachedExpansionBlueprints(expansion.id);
        const card = cards.find(c => c.fixed_properties && String(c.fixed_properties.collector_number) === String(collectorNumber));
        if (!card) return res.status(404).json({ error: 'Card not found for collector number' });

        const redirectUrl = `https://www.cardtrader.com/cards/${card.id}`;
        res.json({ success: true, redirectUrl, expansionId: expansion.id, card });
    } catch (err) {
        console.error('Cardtrader redirect error:', err);
        res.status(500).json({ error: 'Cardtrader lookup failed' });
    }
});

// Get Cardtrader overrides
app.get('/api/cardtrader/overrides', async (req, res) => {
    try {
        const overrides = await readCardtraderOverrides();
        res.json(overrides);
    } catch (err) {
        console.error('Error reading Cardtrader overrides:', err);
        res.status(500).json({ error: 'Failed to read Cardtrader overrides' });
    }
});

// Set/update override
app.post('/api/cardtrader/overrides', requireAuth, async (req, res) => {
    try {
        const { cardId, expansionCode } = req.body;
        if (!cardId || !expansionCode) return res.status(400).json({ error: 'Missing cardId or expansionCode' });

        const overrides = await readCardtraderOverrides();
        overrides[cardId] = expansionCode.toUpperCase();
        await writeCardtraderOverrides(overrides);

        res.json({ success: true, cardId, expansionCode: overrides[cardId] });
    } catch (err) {
        console.error('Error saving Cardtrader override:', err);
        res.status(500).json({ error: 'Failed to save Cardtrader override' });
    }
});

// --- Authentication ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (username === AUTH_USERNAME) {
        let isValid = false;
        if (AUTH_PASSWORD_HASH.startsWith('$2b$') || AUTH_PASSWORD_HASH.startsWith('$2a$')) {
            try { isValid = await bcrypt.compare(password, AUTH_PASSWORD_HASH); } catch { isValid = false; }
        } else {
            isValid = password === AUTH_PASSWORD_HASH;
        }
        if (isValid) {
            req.session.authenticated = true;
            req.session.username = username;
            res.json({ success: true });
        } else {
            res.status(401).json({ error: 'Invalid username or password' });
        }
    } else res.status(401).json({ error: 'Invalid username or password' });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: 'Error logging out' });
        res.json({ success: true });
    });
});

app.get('/api/auth/status', (req, res) => {
    res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// --- Collection and Bought ---
app.get('/api/collection', async (req, res) => {
    try { res.json(await readDataFile(COLLECTION_FILE)); } catch { res.status(500).json({ error: 'Failed to read collection' }); }
});
app.post('/api/collection', requireAuth, async (req, res) => {
    try { await writeDataFile(COLLECTION_FILE, req.body); res.json({ success: true }); } catch { res.status(500).json({ error: 'Failed to save collection' }); }
});
app.get('/api/bought', async (req, res) => {
    try { res.json(await readDataFile(BOUGHT_FILE)); } catch { res.status(500).json({ error: 'Failed to read bought cards' }); }
});
app.post('/api/bought', requireAuth, async (req, res) => {
    try { await writeDataFile(BOUGHT_FILE, req.body); res.json({ success: true }); } catch { res.status(500).json({ error: 'Failed to save bought cards' }); }
});

// --- Gifts ---
// Create a new gift (public, no auth required)
app.post('/api/gifts', async (req, res) => {
    try {
        const { cardId, giverName } = req.body || {};
        if (!cardId || !giverName || typeof giverName !== 'string' || !giverName.trim()) {
            return res.status(400).json({ error: 'Missing or invalid cardId or giverName' });
        }

        const gifts = await readGifts();
        const newGift = {
            id: Date.now().toString(),
            cardId,
            giverName: giverName.trim(),
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        gifts.push(newGift);
        await writeGifts(gifts);
        res.json({ success: true, gift: newGift });
    } catch (err) {
        console.error('Error creating gift:', err);
        res.status(500).json({ error: 'Failed to create gift' });
    }
});

// Get all pending gifts (for the logged-in collector)
app.get('/api/gifts/pending', requireAuth, async (req, res) => {
    try {
        const gifts = await readGifts();
        const pending = gifts.filter(g => g.status === 'pending');
        res.json(pending);
    } catch (err) {
        console.error('Error reading pending gifts:', err);
        res.status(500).json({ error: 'Failed to read pending gifts' });
    }
});

// Accept a gift: mark as collected and save gifter name
app.post('/api/gifts/:id/accept', requireAuth, async (req, res) => {
    try {
        const giftId = req.params.id;
        const gifts = await readGifts();
        const gift = gifts.find(g => g.id === giftId);
        if (!gift) {
            return res.status(404).json({ error: 'Gift not found' });
        }
        if (gift.status !== 'pending') {
            return res.status(400).json({ error: 'Gift is not pending' });
        }

        gift.status = 'accepted';
        gift.processedAt = new Date().toISOString();

        const collection = await readDataFile(COLLECTION_FILE);
        collection[gift.cardId] = true;

        await Promise.all([
            writeGifts(gifts),
            writeDataFile(COLLECTION_FILE, collection)
        ]);

        res.json({ success: true, gift, collection });
    } catch (err) {
        console.error('Error accepting gift:', err);
        res.status(500).json({ error: 'Failed to accept gift' });
    }
});

// Reject a gift: mark as rejected, do not change collection
app.post('/api/gifts/:id/reject', requireAuth, async (req, res) => {
    try {
        const giftId = req.params.id;
        const gifts = await readGifts();
        const gift = gifts.find(g => g.id === giftId);
        if (!gift) {
            return res.status(404).json({ error: 'Gift not found' });
        }
        if (gift.status !== 'pending') {
            return res.status(400).json({ error: 'Gift is not pending' });
        }

        gift.status = 'rejected';
        gift.processedAt = new Date().toISOString();

        await writeGifts(gifts);
        res.json({ success: true, gift });
    } catch (err) {
        console.error('Error rejecting gift:', err);
        res.status(500).json({ error: 'Failed to reject gift' });
    }
});

// Public endpoint: get accepted gift info for a specific card
app.get('/api/gifts/card/:cardId', async (req, res) => {
    try {
        const cardId = req.params.cardId;
        const gifts = await readGifts();
        const accepted = gifts.filter(g => g.cardId === cardId && g.status === 'accepted');
        if (accepted.length === 0) {
            return res.json({ gift: null });
        }
        accepted.sort((a, b) => {
            const da = new Date(a.processedAt || a.createdAt || 0).getTime();
            const db = new Date(b.processedAt || b.createdAt || 0).getTime();
            return db - da;
        });
        const latest = accepted[0];
        res.json({
            gift: {
                giverName: latest.giverName,
                processedAt: latest.processedAt || latest.createdAt
            }
        });
    } catch (err) {
        console.error('Error reading gift for card:', err);
        res.status(500).json({ error: 'Failed to read gift for card' });
    }
});

// --- Start server (only when run directly) ---
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

// Export app for testing
module.exports = { app };
