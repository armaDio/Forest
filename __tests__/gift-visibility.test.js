const fs = require('fs');
const path = require('path');

describe('Gift button visibility rules', () => {
    test('card list view hides "Gift this card" when card is bought', () => {
        const scriptPath = path.join(__dirname, '..', 'script.js');
        const scriptContent = fs.readFileSync(scriptPath, 'utf8');

        expect(scriptContent).toContain('const giftButton = !isBoughtStatus && !isCollectedStatus');
        expect(scriptContent).toContain("${giftButton}");
    });

    test('detail view hides "Gift this card" when card is bought', () => {
        const detailPath = path.join(__dirname, '..', 'detail.js');
        const detailContent = fs.readFileSync(detailPath, 'utf8');

        expect(detailContent).toContain("${!isBoughtStatus && !isCollectedStatus ? `<button class=\"detail-gift-button\" onclick=\"showGiftModal('${card.id}')\">Gift this card</button>` : ''}");
    });
});
