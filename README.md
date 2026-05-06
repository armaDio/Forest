# Forest Collection Tracker

Magic: The Gathering Forest card collection tracker with file-based storage.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up authentication (optional but recommended):
   - Default username: `admin`
   - Default password: `password` (change this!)
   
   To generate a secure password hash:
   ```bash
   node generate-password.js your-secure-password
   ```
   
   Then set environment variables:
   ```bash
   export AUTH_USERNAME=your-username
   export AUTH_PASSWORD_HASH=your-generated-hash
   export SESSION_SECRET=your-random-secret-key
   ```
   
   Or create a `.env` file (requires `dotenv` package):
   ```
   AUTH_USERNAME=admin
   AUTH_PASSWORD_HASH=$2b$10$...
   SESSION_SECRET=your-random-secret-key
   ```

3. Start the server:
```bash
npm start
```

The server will run on `http://localhost:3000`

## Authentication

- **Viewing**: Anyone can view the collection
- **Editing**: Requires login (username/password)
- Login page: `http://localhost:3000/login.html`
- Default credentials: `armaDio` / `REDACTED` (change immediately!)

## Cardtrader Integration

To enable Cardtrader purchase links (only visible when logged in):

1. Get your Cardtrader API token from your Cardtrader profile settings
2. Create a file `data/cardtrader_token.txt` and paste your token in it
3. The Cardtrader link will only appear for authenticated users when the token is configured

The token file is automatically ignored by git (see `.gitignore`).

## File Structure

- `index.html` - Main page
- `detail.html` - Card detail page
- `script.js` - Main page JavaScript
- `detail.js` - Detail page JavaScript
- `styles.css` - Stylesheet
- `server.js` - Express backend server
- `data/` - Directory where collection data is stored (created automatically)
  - `collection.json` - Collected cards data
  - `bought.json` - Bought cards data

## Production Deployment

For production with nginx, you can:

1. Use the Node.js server directly (port 3000)
2. Or configure nginx as a reverse proxy to the Node.js server

### Option 1: Direct Node.js (with PM2)

```bash
npm install -g pm2
pm2 start server.js --name forest-tracker
pm2 save
pm2 startup
```

### Option 2: Nginx Reverse Proxy

Add to your nginx configuration:

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Then run the Node.js server on port 3000.

## TrueNAS Manual App (Auto-update from GitHub)

This repo includes Docker automation so your TrueNAS app can always run the newest version:

- A GitHub Actions workflow builds and publishes `ghcr.io/<owner>/forest-collection-tracker:latest` on each push to `main`.
- `watchtower` is included in `docker-compose.yml` and checks every 5 minutes for a newer `latest` image.
- When a new image is found, Watchtower pulls it and restarts `forest-tracker` automatically.

### One-time setup

1. Push this repo to GitHub.
2. Ensure the default branch is `main` (or adjust `.github/workflows/docker-publish.yml`).
3. Make the package visible to your TrueNAS host:
   - Public package: no extra auth needed.
   - Private package: configure Docker login to GHCR on the TrueNAS host.
4. In your TrueNAS app compose path, use this file and set:
   - `GITHUB_OWNER=<your-github-username-or-org>`

### Notes

- Your persistent app data remains in `./data` and is not replaced during updates.
- You can force an immediate image check by restarting `watchtower`.
