# Bingo App — Deployment Guide (Debian 11)

> These notes cover the bare-metal install: Node on the host, managed by
> systemd. For the containerized deployment, which is the recommended option
> now, see [CONTAINER.md](CONTAINER.md). The two are interchangeable from the
> reverse proxy's point of view: both listen on `localhost:3000`, so the
> Apache configuration in section 6 below applies to either.


## 1. Install Node.js

Install Node.js 22 system-wide via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

## 2. Create a dedicated app user

```bash
sudo useradd --system --create-home bingo
```

---

## 3. Deploy the app

```bash
sudo -u bingo -H bash
cd ~
git clone https://github.com/chasenunez/BINGO.git
cd BINGO
npm install --omit=dev
exit
```

---

## 4. Create the environment file

```bash
sudo mkdir /etc/bingo
sudo nano /etc/bingo/env
```

Add the following contents:

```
SECRET_KEY=your-generated-secret-here
STORE_FILE_PATH=./data/store.json.enc
NODE_ENV=production
BASE_PATH=/bingo
```

To generate `SECRET_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Optionally, set `SESSION_SECRET` to make user sessions survive service restarts.
Without it, users will be logged out on every restart:

```
SESSION_SECRET=your-generated-session-secret
```

You can use the same command above to generate a value for it.

Set permissions:

```bash
sudo chown bingo:bingo /etc/bingo/env
sudo chmod 600 /etc/bingo/env
```

---

## 5. Create the systemd service

Create `/etc/systemd/system/bingo.service`:

```ini
[Unit]
Description=BINGO App
After=network.target

[Service]
User=bingo
WorkingDirectory=/home/bingo/BINGO
ExecStart=/usr/bin/node server.js
Restart=always
EnvironmentFile=/etc/bingo/env

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable bingo
sudo systemctl start bingo
sudo systemctl status bingo
```

---

## 6. Configure Apache reverse proxy

Enable the required modules:

```bash
sudo a2enmod proxy proxy_http headers
sudo systemctl restart apache2
```

Add the following to **both** your port 80 and port 443 VirtualHost configurations, after any Drupal rewrite rules:

```apache
ProxyPass /bingo http://localhost:3000/bingo
ProxyPassReverse /bingo http://localhost:3000/bingo
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "%{REQUEST_SCHEME}s"
```

Then reload Apache:

```bash
sudo systemctl reload apache2
```

The app will be available at `https://yoursite.com/bingo`.

---

## 7. Update the app

```bash
sudo systemctl stop bingo

sudo -u bingo -H bash
cd ~/BINGO
git pull
npm install --omit=dev
exit

sudo systemctl start bingo
```

---

## Useful commands

| Task | Command |
|---|---|
| Start the app | `sudo systemctl start bingo` |
| Stop the app | `sudo systemctl stop bingo` |
| Restart the app | `sudo systemctl restart bingo` |
| Check status | `sudo systemctl status bingo` |
| View logs | `sudo journalctl -u bingo -f` |
