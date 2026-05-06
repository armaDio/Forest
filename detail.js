// Store all cards for binder position calculation
let allCards = [];

// Cache for collection and bought data
let collectionCache = {};
let boughtCache = {};
let cardtraderOverrides = {}; // Store per-card expansion code overrides
let dataLoaded = false;
let isAuthenticated = false;
let currentGiftInfo = null;

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Get card ID from URL
function getCardIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
}

// Load collection and bought data from server
async function loadData() {
    try {
        const [collectionRes, boughtRes] = await Promise.all([
            fetch('/api/collection', { credentials: 'include' }),
            fetch('/api/bought', { credentials: 'include' })
        ]);

        if (collectionRes.ok) {
            collectionCache = await collectionRes.json();
        }

        if (boughtRes.ok) {
            boughtCache = await boughtRes.json();
        }

        dataLoaded = true;
    } catch (error) {
        console.error('Error loading data:', error);
        dataLoaded = true; // prevent infinite loading
    }
}

// Load Cardtrader overrides from server
async function loadCardtraderOverrides() {
    try {
        const res = await fetch('/api/cardtrader/overrides', { credentials: 'include' });
        if (res.ok) {
            cardtraderOverrides = await res.json();
        } else {
            console.warn('Failed to load Cardtrader overrides');
        }
    } catch (err) {
        console.error('Error loading Cardtrader overrides:', err);
    }
}

// Get collection from cache
function getCollection() {
    return collectionCache;
}

// Save collection to server
async function saveCollection(collection) {
    try {
        if (!isAuthenticated) {
            window.location.href = '/login.html';
            return;
        }

        collectionCache = collection;
        const response = await fetch('/api/collection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(collection),
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 401) {
                isAuthenticated = false;
                window.location.href = '/login.html';
                return;
            }
            throw new Error('Failed to save collection');
        }
    } catch (error) {
        console.error('Error saving collection:', error);
        alert('Unable to save collection status. Please check your connection.');
    }
}

// Toggle card collection status
async function toggleCollection(cardId) {
    const collection = getCollection();
    collection[cardId] = collection[cardId] === true ? false : true;
    await saveCollection(collection);
    return collection[cardId];
}

// Check if card is collected
function isCollected(cardId) {
    return getCollection()[cardId] === true;
}

// Get bought cards from cache
function getBought() {
    return boughtCache;
}

// Save bought cards to server
async function saveBought(bought) {
    try {
        if (!isAuthenticated) {
            window.location.href = '/login.html';
            return;
        }

        boughtCache = bought;
        const response = await fetch('/api/bought', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bought),
            credentials: 'include'
        });

        if (!response.ok) {
            if (response.status === 401) {
                isAuthenticated = false;
                window.location.href = '/login.html';
                return;
            }
            throw new Error('Failed to save bought cards');
        }
    } catch (error) {
        console.error('Error saving bought:', error);
        alert('Unable to save bought status. Please check your connection.');
    }
}

// Toggle card bought status
async function toggleBought(cardId) {
    const bought = getBought();
    bought[cardId] = bought[cardId] === true ? false : true;
    await saveBought(bought);
    return bought[cardId];
}

// Check if card is bought
function isBought(cardId) {
    return getBought()[cardId] === true;
}

// Fetch card details from Scryfall API
async function fetchCardDetails(cardId) {
    try {
        const response = await fetch(`https://api.scryfall.com/cards/${cardId}`);
        if (!response.ok) throw new Error('Card not found');
        return await response.json();
    } catch (error) {
        console.error('Error fetching card details:', error);
        throw error;
    }
}

// Format date
function formatDate(dateString) {
    if (!dateString) return 'Unknown';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Format price
function formatPrice(price) {
    if (!price) return 'N/A';
    return `$${parseFloat(price).toFixed(2)}`;
}

// --- Gifts ---
async function fetchGiftInfo(cardId) {
    try {
        const res = await fetch(`/api/gifts/card/${encodeURIComponent(cardId)}`);
        if (!res.ok) {
            console.error('Failed to fetch gift info for card:', cardId, res.status);
            return null;
        }
        const data = await res.json();
        return data.gift || null;
    } catch (err) {
        console.error('Error fetching gift info:', err);
        return null;
    }
}

// Fetch all Forest cards from Scryfall API (for binder position)
async function fetchAllForests() {
    const allCards = [];
    // Keep this query aligned with script.js so binder page numbers match everywhere.
    let url = 'https://api.scryfall.com/cards/search?q=!Forest+(game:paper)+include:extras+unique:prints&unique=cards';

    while (url) {
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (data.data) allCards.push(...data.data);
            url = data.has_more ? data.next_page : null;
        } catch (error) {
            console.error('Error fetching cards:', error);
            break;
        }
    }

    return allCards;
}

// Sort cards by release date (oldest first), then by collector number
function sortCards(cards) {
    return cards.sort((a, b) => {
        const dateA = new Date(a.released_at || '1900-01-01');
        const dateB = new Date(b.released_at || '1900-01-01');
        if (dateA.getTime() !== dateB.getTime()) return dateA.getTime() - dateB.getTime();
        const numAInt = parseInt(a.collector_number) || 0;
        const numBInt = parseInt(b.collector_number) || 0;
        if (numAInt !== numBInt) return numAInt - numBInt;
        return (a.collector_number || '').localeCompare(b.collector_number || '');
    });
}

// Calculate binder position (3x3 = 9 cards per page)
function getBinderPosition(cardId) {
    const index = allCards.findIndex(card => card.id === cardId);
    if (index === -1) return null;
    const page = Math.floor(index / 9) + 1;
    const slot = (index % 9) + 1;
    const row = Math.floor((index % 9) / 3) + 1;
    const column = (index % 9) % 3 + 1;
    return { page, slot, row, column };
}

// Check if Cardtrader is available
let cardtraderAvailable = false;
async function checkCardtraderAvailability() {
    try {
        const response = await fetch('/api/cardtrader/available', { credentials: 'include' });
        if (response.status === 401) { cardtraderAvailable = false; return false; }
        if (!response.ok) { cardtraderAvailable = false; return false; }
        const data = await response.json();
        cardtraderAvailable = !!data.available;
        return cardtraderAvailable;
    } catch (error) {
        console.error('Error checking Cardtrader availability:', error);
        cardtraderAvailable = false;
        return false;
    }
}

// Show modal to override Cardtrader expansion code
function showCardtraderOverrideModal(cardId, currentSet) {
    let modal = document.getElementById('cardtrader-override-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'cardtrader-override-modal';
        modal.className = 'gift-modal-overlay';
        modal.innerHTML = `
            <div class="gift-modal">
                <h3>Override Cardtrader Set</h3>
                <p>Enter the Cardtrader expansion code to use for this card.</p>
                <p class="override-card-id">Card ID: <code id="override-card-id"></code></p>
                <input type="text" id="override-input" class="gift-input" placeholder="Enter Cardtrader set code" />
                <div class="gift-modal-actions">
                    <button id="override-cancel" class="gift-cancel-button">Cancel</button>
                    <button id="override-save" class="gift-confirm-button">Save</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        document.getElementById('override-cancel').onclick = () => { modal.style.display = 'none'; };
        document.getElementById('override-save').onclick = async () => {
            const code = document.getElementById('override-input').value.trim().toUpperCase();
            if (!code) return alert('Set code cannot be empty');
            await saveCardtraderOverride(cardId, code);
            modal.style.display = 'none';
            const card = allCards.find(c => c.id === cardId);
            if (card) createDetailView(card);
        };
    }
    const cardIdEl = document.getElementById('override-card-id');
    if (cardIdEl) {
        cardIdEl.textContent = cardId;
    }
    document.getElementById('override-input').value = cardtraderOverrides[cardId] || currentSet || '';
    modal.style.display = 'flex';
}

// Save override to server
async function saveCardtraderOverride(cardId, code) {
    try {
        const res = await fetch('/api/cardtrader/overrides', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ cardId, expansionCode: code })
        });
        if (res.ok) cardtraderOverrides[cardId] = code;
        else { console.error('Failed to save override', await res.text()); alert('Failed to save override'); }
    } catch (err) {
        console.error('Error saving Cardtrader override', err);
        alert('Error saving override');
    }
}

// Handle Cardtrader button click
async function handleCardtraderClick(event, cardId) {
    event.preventDefault();
    event.stopPropagation();
    const card = allCards.find(c => c.id === cardId);
    if (!card) return alert('Card not found');

    const expansionCode = cardtraderOverrides[cardId] || card.set?.toUpperCase();
    const collectorNumber = card.collector_number;
    if (!expansionCode || !collectorNumber) return alert('Missing expansion code or collector number');

    try {
        const res = await fetch('/api/cardtrader/redirect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ expansionCode, collectorNumber })
        });
        const data = await res.json();
        if (!res.ok || !data.redirectUrl) return alert(data.error || 'Cardtrader lookup failed');
        window.open(data.redirectUrl, '_blank');
    } catch (error) {
        console.error('Cardtrader redirect failed:', error);
        alert('Failed to contact Cardtrader service');
    }
}

// Generate purchase links HTML
function getPurchaseLinks(card) {
    const cardmarketUrl = card.purchase_uris?.cardmarket || null;
    let linksHtml = '<div class="purchase-links">';
    if (cardmarketUrl) linksHtml += `<a href="${cardmarketUrl}" target="_blank" rel="noopener noreferrer" class="purchase-link cardmarket-link">🛒 Cardmarket</a>`;
    linksHtml += `
        <a href="#" class="purchase-link cardtrader-link" onclick="handleCardtraderClick(event, '${card.id}')">🛒 Cardtrader</a>`;
    if (isAuthenticated) {
        linksHtml += `<a href="#" class="purchase-link cardtrader-override" onclick="showCardtraderOverrideModal('${card.id}', '${card.set?.toUpperCase() || ''}')">⚙️ Override</a>`;
    }
    linksHtml += '</div>';
    return linksHtml;
}

// Create detail view
function createDetailView(card) {
    const isCollectedStatus = isCollected(card.id);
    const isBoughtStatus = isBought(card.id);
    const binderPos = getBinderPosition(card.id);
    const binderInfo = binderPos ? `Page ${binderPos.page}, Slot ${binderPos.slot} (Row ${binderPos.row}, Column ${binderPos.column})` : 'N/A';
    const container = document.getElementById('detail-container');

    const giftSection = currentGiftInfo
        ? `<div class="detail-section">
                <h3>Gift</h3>
                <p><strong>Gifted by:</strong> ${escapeHtml(currentGiftInfo.giverName || '')}</p>
           </div>`
        : '';

    container.innerHTML = `
        <div class="detail-card">
            <div class="detail-image-container">
                <img src="${card.image_uris?.large || card.image_uris?.normal || ''}" alt="${card.name}" class="detail-image">
            </div>
            <div class="detail-info">
                <h2 class="detail-title">${card.name}</h2>
                <div class="detail-section">
                    <h3>Binder Position</h3>
                    <p><strong>📖 Location:</strong> ${binderInfo}</p>
                    <p class="binder-note">3x3 binder layout (9 cards per page)</p>
                </div>
                <div class="detail-section">
                    <h3>Set Information</h3>
                    <p><strong>Set:</strong> ${card.set_name || 'Unknown'}</p>
                    <p><strong>Set Code:</strong> ${card.set?.toUpperCase() || 'N/A'} ${cardtraderOverrides[card.id]?'{ overridden to '+cardtraderOverrides[card.id]+'}': ''}</p>
                    <p><strong>Collector Number:</strong> ${card.collector_number || 'N/A'}</p>
                    <p><strong>Release Date:</strong> ${formatDate(card.released_at)}</p>
                    <p><strong>Rarity:</strong> ${card.rarity ? card.rarity.charAt(0).toUpperCase() + card.rarity.slice(1) : 'N/A'}</p>
                </div>
                <div class="detail-section">
                    <h3>Card Details</h3>
                    <p><strong>Type:</strong> ${card.type_line || 'N/A'}</p>
                    <p><strong>Oracle Text:</strong> ${card.oracle_text || 'N/A'}</p>
                    ${card.artist ? `<p><strong>Artist:</strong> ${card.artist}</p>` : ''}
                </div>
                ${card.prices ? `<div class="detail-section"><h3>Pricing</h3>${card.prices.usd ? `<p><strong>USD:</strong> ${formatPrice(card.prices.usd)}</p>` : ''}${card.prices.usd_foil ? `<p><strong>USD Foil:</strong> ${formatPrice(card.prices.usd_foil)}</p>` : ''}${card.prices.eur ? `<p><strong>EUR:</strong> €${parseFloat(card.prices.eur).toFixed(2)}</p>` : ''}${card.prices.eur_foil ? `<p><strong>EUR Foil:</strong> €${parseFloat(card.prices.eur_foil).toFixed(2)}</p>` : ''}</div>` : ''}
                ${card.legalities ? `<div class="detail-section"><h3>Legalities</h3><p><strong>Standard:</strong> ${card.legalities.standard || 'N/A'}</p><p><strong>Modern:</strong> ${card.legalities.modern || 'N/A'}</p><p><strong>Legacy:</strong> ${card.legalities.legacy || 'N/A'}</p><p><strong>Commander:</strong> ${card.legalities.commander || 'N/A'}</p></div>` : ''}
                ${giftSection}
                ${!isCollectedStatus ? `<div class="detail-section"><h3>Purchase</h3>${getPurchaseLinks(card)}</div>` : ''}
                ${isBoughtStatus && !isCollectedStatus ? `<div class="detail-section bought-status-section"><h3>📦 Status</h3><p><strong>This card has been purchased and is awaiting delivery.</strong></p></div>` : ''}
                <div class="detail-action-buttons">
                    ${isAuthenticated ? (
                        isCollectedStatus ? `<button class="detail-collect-button collected" onclick="handleCollect('${card.id}')">✓ Collected</button>` :
                        isBoughtStatus ? `<button class="detail-bought-button bought" onclick="handleBought('${card.id}')">📦 Bought</button><button class="detail-collect-button not-collected" onclick="handleCollect('${card.id}')">Not Collected</button>` :
                        `<button class="detail-bought-button not-bought" onclick="handleBought('${card.id}')">Mark as Bought</button><button class="detail-collect-button not-collected" onclick="handleCollect('${card.id}')">Not Collected</button>`
                    ) : (
                        isCollectedStatus ? `<div class="status-display collected-status">✓ Collected</div>` :
                        isBoughtStatus ? `<div class="status-display bought-status">📦 Bought</div>` :
                        `<div class="status-display not-collected-status">Not Collected</div>`
                    )}
                    ${!isBoughtStatus ? `<button class="detail-gift-button" onclick="showGiftModal('${card.id}')">Gift this card</button>` : ''}
                </div>
            </div>
        </div>
    `;
}

// Show gift modal on the detail page
function showGiftModal(cardId) {
    let modal = document.getElementById('gift-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'gift-modal';
        modal.className = 'gift-modal-overlay';
        modal.innerHTML = `
            <div class="gift-modal">
                <h3>Gift this card</h3>
                <p>Enter the name of the person who is gifting this card.</p>
                <input type="text" id="gift-giver-name" class="gift-input" placeholder="Your name">
                <div class="gift-modal-actions">
                    <button id="gift-cancel-button" class="gift-cancel-button">Cancel</button>
                    <button id="gift-confirm-button" class="gift-confirm-button">Send Gift</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    modal.style.display = 'flex';

    const nameInput = document.getElementById('gift-giver-name');
    const cancelBtn = document.getElementById('gift-cancel-button');
    const confirmBtn = document.getElementById('gift-confirm-button');

    if (nameInput) {
        nameInput.value = '';
        nameInput.focus();
    }

    const closeModal = () => {
        modal.style.display = 'none';
    };

    cancelBtn.onclick = () => {
        closeModal();
    };

    confirmBtn.onclick = async () => {
        const giverName = nameInput ? nameInput.value.trim() : '';
        if (!giverName) {
            alert('Please enter a name.');
            return;
        }
        try {
            const response = await fetch('/api/gifts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cardId, giverName })
            });
            if (!response.ok) {
                console.error('Failed to create gift from detail page:', response.status);
                alert('Unable to send gift. Please try again later.');
                return;
            }
            alert('Thank you! Your gift has been recorded and will appear for confirmation.');
            closeModal();
        } catch (err) {
            console.error('Error creating gift from detail page:', err);
            alert('Unable to send gift. Please try again later.');
        }
    };
}

// Handle collect button click
async function handleCollect(cardId) {
    if (!isAuthenticated) { window.location.href = '/login.html'; return; }
    const isNowCollected = await toggleCollection(cardId);
    if (isNowCollected) { const bought = getBought(); if (bought[cardId]) { bought[cardId] = false; await saveBought(bought); } }
    const card = allCards.find(c => c.id === cardId);
    if (card) {
        currentGiftInfo = await fetchGiftInfo(cardId);
        createDetailView(card);
    }
}

// Handle bought button click
async function handleBought(cardId) {
    if (!isAuthenticated) { window.location.href = '/login.html'; return; }
    await toggleBought(cardId);
    await checkCardtraderAvailability();
    const card = allCards.find(c => c.id === cardId);
    if (card) {
        currentGiftInfo = await fetchGiftInfo(cardId);
        createDetailView(card);
    }
}

// Check authentication status
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/status', { credentials: 'include' });
        if (response.ok) { const data = await response.json(); isAuthenticated = data.authenticated; return isAuthenticated; }
        isAuthenticated = false;
        return false;
    } catch (error) {
        console.error('Error checking auth:', error);
        isAuthenticated = false;
        return false;
    }
}

// Initialize detail page
async function init() {
    const loadingDiv = document.getElementById('loading');
    const cardId = getCardIdFromUrl();
    if (!cardId) { loadingDiv.innerHTML = '<p style="color: white;">No card ID provided.</p>'; return; }

    try {
        await checkAuth();
        if (isAuthenticated) await checkCardtraderAvailability();
        await loadData();
        await loadCardtraderOverrides();
        const [card, cards, giftInfo] = await Promise.all([
            fetchCardDetails(cardId),
            fetchAllForests(),
            fetchGiftInfo(cardId)
        ]);
        allCards = sortCards(cards);
        currentGiftInfo = giftInfo;
        loadingDiv.style.display = 'none';
        createDetailView(card);
    } catch (error) {
        console.error('Error initializing detail page:', error);
        loadingDiv.innerHTML = '<p style="color: white;">Error loading card details. Please try again.</p>';
    }
}

// Make handlers available globally
window.handleCollect = handleCollect;
window.handleBought = handleBought;
window.handleCardtraderClick = handleCardtraderClick;
window.showCardtraderOverrideModal = showCardtraderOverrideModal;
window.showGiftModal = showGiftModal;

// Initialize when page loads
document.addEventListener('DOMContentLoaded', init);
