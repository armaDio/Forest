// Store all cards globally for filtering
let allCards = [];
let filteredCards = [];

// Cache for collection and bought data
let collectionCache = {};
let boughtCache = {};
let dataLoaded = false;
let isAuthenticated = false;

// Fetch all Forest cards from Scryfall API
async function fetchAllForests() {
    const allCards = [];
    let url = 'https://api.scryfall.com/cards/search?q=Forest+(type:land+type:basic)+(game:paper)+unique:prints&order=released&unique=cards';
    
    while (url) {
        try {
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.data) {
                allCards.push(...data.data);
            }
            
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
        // First sort by release date
        const dateA = new Date(a.released_at || '1900-01-01');
        const dateB = new Date(b.released_at || '1900-01-01');
        
        if (dateA.getTime() !== dateB.getTime()) {
            return dateA.getTime() - dateB.getTime();
        }
        
        // If same date, sort by collector number (handle alphanumeric)
        const numA = a.collector_number || '';
        const numB = b.collector_number || '';
        
        // Extract numeric part and compare
        const numAInt = parseInt(numA) || 0;
        const numBInt = parseInt(numB) || 0;
        
        if (numAInt !== numBInt) {
            return numAInt - numBInt;
        }
        
        // If numeric parts are equal, compare as strings
        return numA.localeCompare(numB);
    });
}

// Check authentication status
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/status', {
            credentials: 'include'
        });
        if (response.ok) {
            const data = await response.json();
            isAuthenticated = data.authenticated;
            return isAuthenticated;
        }
        isAuthenticated = false;
        return false;
    } catch (error) {
        console.error('Error checking auth:', error);
        isAuthenticated = false;
        return false;
    }
}

async function checkCardtraderAvailability() {
    try {
        const response = await fetch('/api/cardtrader/available', {
            credentials: 'include'
        });

        // Handle auth race conditions gracefully
        if (response.status === 401) {
            console.warn('Cardtrader availability: not authenticated yet');
            cardtraderAvailable = false;
            return false;
        }

        if (!response.ok) {
            console.error('Cardtrader availability HTTP error:', response.status);
            cardtraderAvailable = false;
            return false;
        }

        const data = await response.json();
        cardtraderAvailable = !!data.available;
        return cardtraderAvailable;

    } catch (error) {
        console.error('Error checking Cardtrader availability:', error);
        cardtraderAvailable = false;
        return false;
    }
}

// Update auth UI
async function updateAuthUI() {
    const wasAuthenticated = isAuthenticated;
    await checkAuth(); // This updates the isAuthenticated global variable
    
    // Check Cardtrader availability if authenticated
    if (isAuthenticated) {
        await checkCardtraderAvailability();
    } else {
        cardtraderAvailable = false;
    }
    
    const authStatus = document.getElementById('auth-status');
    const loginPrompt = document.getElementById('login-prompt');
    const authUsername = document.getElementById('auth-username');
    
    if (isAuthenticated) {
        authStatus.style.display = 'flex';
        loginPrompt.style.display = 'none';
        
        // Get username from session (you might want to add this to the status endpoint)
        authUsername.textContent = 'Logged in';
        
        // Add logout handler (remove old one first)
        const logoutBtn = document.getElementById('logout-btn');
        const newLogoutBtn = logoutBtn.cloneNode(true);
        logoutBtn.parentNode.replaceChild(newLogoutBtn, logoutBtn);
        
        newLogoutBtn.addEventListener('click', async () => {
            try {
                await fetch('/api/logout', {
                    method: 'POST',
                    credentials: 'include'
                });
                window.location.reload();
            } catch (error) {
                console.error('Error logging out:', error);
            }
        });
    } else {
        authStatus.style.display = 'none';
        loginPrompt.style.display = 'block';
    }
    
    // Re-render cards if auth status changed (to show/hide edit buttons and Cardtrader links)
    if (wasAuthenticated !== isAuthenticated && dataLoaded) {
        rerenderCards();
    }
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
        dataLoaded = true; // Set to true even on error to prevent infinite loading
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
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(collection),
            credentials: 'include'
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                // Not authenticated, redirect to login
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
    // Explicitly handle undefined/false/true states
    collection[cardId] = collection[cardId] === true ? false : true;
    await saveCollection(collection);
    return collection[cardId];
}

// Check if card is collected
function isCollected(cardId) {
    const collection = getCollection();
    // Explicitly check for true value
    return collection[cardId] === true;
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
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bought),
            credentials: 'include'
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                // Not authenticated, redirect to login
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
    // Explicitly handle undefined/false/true states
    bought[cardId] = bought[cardId] === true ? false : true;
    await saveBought(bought);
    return bought[cardId];
}

// Check if card is bought
function isBought(cardId) {
    const bought = getBought();
    // Explicitly check for true value
    return bought[cardId] === true;
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

// Check if Cardtrader is available (only for authenticated users)
let cardtraderAvailable = true;

// Handle Cardtrader button click
async function handleCardtraderClick(event, cardId) {
    event.preventDefault();
    event.stopPropagation();

    const card = allCards.find(c => c.id === cardId);
    if (!card) {
        alert('Card not found');
        return;
    }

    // Scryfall fields
    const expansionCode = card.set?.toUpperCase();          // e.g. "ONE"
    const collectorNumber = card.collector_number;          // e.g. "127"

    if (!expansionCode || !collectorNumber) {
        alert('Missing expansion code or collector number');
        return;
    }

    try {
        const res = await fetch('/api/cardtrader/redirect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                expansionCode,
                collectorNumber
            })
        });

        const data = await res.json();

        if (!res.ok || !data.redirectUrl) {
            console.error('Cardtrader error:', data);
            alert(data.error || 'Cardtrader lookup failed');
            return;
        }

        // Redirect to Cardtrader
        window.open(data.redirectUrl, '_blank');

    } catch (error) {
        console.error('Cardtrader redirect failed:', error);
        alert('Failed to contact Cardtrader service');
    }
}

// Make globally available
window.handleCardtraderClick = handleCardtraderClick;

function getPurchaseLinks(card) {
    const cardmarketUrl = card.purchase_uris?.cardmarket || null;

    let linksHtml = '<div class="purchase-links">';

    if (cardmarketUrl) {
        linksHtml += `<a href="${cardmarketUrl}" target="_blank" rel="noopener noreferrer" class="purchase-link cardmarket-link">🛒 Cardmarket</a>`;
    }

        linksHtml += `
          <a href="#"
             class="purchase-link cardtrader-link"
             onclick="handleCardtraderClick(event, '${card.id}')">
             🛒 Cardtrader
          </a>
        `;

    linksHtml += '</div>';
    return linksHtml;
}

// Update stats display
function updateStats(cardsToCount) {
    const collection = getCollection();
    // Count collected and bought cards from the filtered set
    const collectedCount = cardsToCount.filter(card => isCollected(card.id)).length;
    const boughtCount = cardsToCount.filter(card => isBought(card.id) && !isCollected(card.id)).length;
    const totalCards = cardsToCount.length;
    const missingCount = totalCards - collectedCount - boughtCount;
    const progressPercent = totalCards > 0 ? Math.round((collectedCount / totalCards) * 100) : 0;
    
    document.getElementById('total-cards').textContent = totalCards;
    document.getElementById('collected-count').textContent = collectedCount;
    document.getElementById('bought-count').textContent = boughtCount;
    document.getElementById('missing-count').textContent = missingCount;
    document.getElementById('progress-percent').textContent = progressPercent + '%';
}

// Create card element
function createCardElement(card) {
    const cardDiv = document.createElement('div');
    cardDiv.className = 'card-item';
    
    const isCollectedStatus = isCollected(card.id);
    const isBoughtStatus = isBought(card.id);
    const binderPos = getBinderPosition(card.id);
    const binderInfo = binderPos ? `Page ${binderPos.page}, Slot ${binderPos.slot} (Row ${binderPos.row}, Col ${binderPos.column})` : 'N/A';
    
    // Show purchase links if not collected (bought cards can still see links)
    const purchaseLinks = !isCollectedStatus ? getPurchaseLinks(card) : '';
    
    // Show bought badge if bought but not collected
    const boughtBadge = isBoughtStatus && !isCollectedStatus ? '<div class="bought-badge">📦 Bought</div>' : '';
    
    // Determine which buttons to show based on state (only if authenticated)
    let boughtButton = '';
    let collectButton = '';
    
    if (isAuthenticated) {
        if (isCollectedStatus) {
            // Collected: show only uncollect button
            collectButton = `<button class="collect-button collected" onclick="handleCollect(event, '${card.id}')">✓ Collected</button>`;
        } else if (isBoughtStatus) {
            // Bought: show un-buy button and collect button
            boughtButton = `<button class="bought-button bought" onclick="handleBought(event, '${card.id}')">📦 Bought</button>`;
            collectButton = `<button class="collect-button not-collected" onclick="handleCollect(event, '${card.id}')">Not Collected</button>`;
        } else {
            // Not collected: show both buy and collect buttons
            boughtButton = `<button class="bought-button not-bought" onclick="handleBought(event, '${card.id}')">Mark as Bought</button>`;
            collectButton = `<button class="collect-button not-collected" onclick="handleCollect(event, '${card.id}')">Not Collected</button>`;
        }
    } else {
        // Not authenticated: show status only, no edit buttons
        if (isCollectedStatus) {
            collectButton = `<div class="status-display collected-status">✓ Collected</div>`;
        } else if (isBoughtStatus) {
            collectButton = `<div class="status-display bought-status">📦 Bought</div>`;
        } else {
            collectButton = `<div class="status-display not-collected-status">Not Collected</div>`;
        }
    }
    
    cardDiv.innerHTML = `
        <div class="card-image-container">
            <img src="${card.image_uris?.normal || card.image_uris?.small || ''}" 
                 alt="${card.name}" 
                 class="card-image"
                 onclick="window.location.href='detail.html?id=${card.id}'">
        </div>
        <div class="card-info">
            <div class="card-set">${card.set_name || 'Unknown Set'}</div>
            <div class="card-number">#${card.collector_number || 'N/A'}</div>
            <div class="binder-position">📖 ${binderInfo}</div>
            ${boughtBadge}
            ${purchaseLinks}
            <div class="action-buttons">
                ${boughtButton}
                ${collectButton}
            </div>
        </div>
    `;
    
    return cardDiv;
}

// Handle collect button click
async function handleCollect(event, cardId) {
    event.stopPropagation();
    
    // Check authentication before allowing edit
    if (!isAuthenticated) {
        window.location.href = '/login.html';
        return;
    }
    
    const cardItem = event.target.closest('.card-item');
    
    // Toggle collection status
    const isNowCollected = await toggleCollection(cardId);
    
    // Re-render the card with updated buttons
    const card = allCards.find(c => c.id === cardId);
    if (card) {
        const newCardElement = createCardElement(card);
        cardItem.parentNode.replaceChild(newCardElement, cardItem);
    }
    
    // Update stats with current filtered cards
    updateStats(filteredCards);
}

// Handle bought button click
async function handleBought(event, cardId) {
    event.stopPropagation();
    
    // Check authentication before allowing edit
    if (!isAuthenticated) {
        window.location.href = '/login.html';
        return;
    }
    
    const cardItem = event.target.closest('.card-item');
    
    // Toggle bought status
    const isNowBought = await toggleBought(cardId);
    
    // Re-render the card with updated buttons
    const card = allCards.find(c => c.id === cardId);
    if (card) {
        const newCardElement = createCardElement(card);
        cardItem.parentNode.replaceChild(newCardElement, cardItem);
    }
    
    // Update stats with current filtered cards
    updateStats(filteredCards);
}

// Get unique sets from cards
function getUniqueSets(cards) {
    const sets = new Set();
    cards.forEach(card => {
        if (card.set_name) {
            sets.add(card.set_name);
        }
    });
    return Array.from(sets).sort();
}

// Populate set filter dropdown
function populateSetFilter(cards) {
    const setFilter = document.getElementById('set-filter');
    const sets = getUniqueSets(cards);
    
    // Clear existing options except "All Expansions"
    setFilter.innerHTML = '<option value="">All Expansions</option>';
    
    // Add each set as an option
    sets.forEach(setName => {
        const option = document.createElement('option');
        option.value = setName;
        option.textContent = setName;
        setFilter.appendChild(option);
    });
}

// Filter cards by set and status
function filterCards(setName, statusFilter) {
    let filtered = [...allCards];
    
    // Filter by set
    if (setName) {
        filtered = filtered.filter(card => card.set_name === setName);
    }
    
    // Filter by status
    if (statusFilter) {
        if (statusFilter === 'collected') {
            filtered = filtered.filter(card => isCollected(card.id));
        } else if (statusFilter === 'bought') {
            filtered = filtered.filter(card => isBought(card.id) && !isCollected(card.id));
        } else if (statusFilter === 'uncollected') {
            filtered = filtered.filter(card => !isCollected(card.id) && !isBought(card.id));
        }
    }
    
    filteredCards = filtered;
    return filteredCards;
}

// Render cards to the grid
function renderCards(cards) {
    const cardsGrid = document.getElementById('cards-grid');
    cardsGrid.innerHTML = ''; // Clear existing cards
    
    cards.forEach(card => {
        const cardElement = createCardElement(card);
        cardsGrid.appendChild(cardElement);
    });
    
    // Update stats
    updateStats(cards);
}

// Re-render all cards (useful after auth status changes)
function rerenderCards() {
    renderCards(filteredCards);
}

// Handle filter changes
function handleFilterChange() {
    const setFilter = document.getElementById('set-filter');
    const statusFilter = document.getElementById('status-filter');
    const selectedSet = setFilter.value;
    const selectedStatus = statusFilter.value;
    
    const filtered = filterCards(selectedSet, selectedStatus);
    renderCards(filtered);
}

// Initialize page
async function init() {
    const loadingDiv = document.getElementById('loading');
    const cardsGrid = document.getElementById('cards-grid');
    
    try {
        // Check authentication and update UI
        await updateAuthUI();
        
        // Load collection and bought data first
        await loadData();
        
        // Fetch all cards
        const cards = await fetchAllForests();
        
        // Sort cards
        const sortedCards = sortCards(cards);
        
        // Store globally
        allCards = sortedCards;
        filteredCards = [...allCards];
        
        // Populate set filter
        populateSetFilter(sortedCards);
        
        // Add event listeners to filters
        document.getElementById('set-filter').addEventListener('change', handleFilterChange);
        document.getElementById('status-filter').addEventListener('change', handleFilterChange);
        
        // Hide loading
        loadingDiv.style.display = 'none';
        
        // Render initial cards
        renderCards(filteredCards);
        
    } catch (error) {
        console.error('Error initializing:', error);
        loadingDiv.innerHTML = '<p style="color: white;">Error loading cards. Please refresh the page.</p>';
    }
}

// Make handlers available globally
window.handleCollect = handleCollect;
window.handleBought = handleBought;

// Initialize when page loads
document.addEventListener('DOMContentLoaded', init);
