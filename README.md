# Happy Healthy Hethersett

An Angular single-page application that showcases community news, events, and projects for Happy Healthy Hethersett.

## Getting started
1. Install dependencies:
   ```bash
   npm install
   ```
2. Make sure .NET 8 SDK and MariaDB/MySQL are available, then start the API:
   ```bash
   export ConnectionStrings__DefaultConnection='Server=localhost;Port=3306;Database=happy_healthy_hethersett;User=hhh_app;Password=change-me;'
   export HHH_INITIAL_ADMIN_EMAIL='admin@example.com'
   export HHH_INITIAL_ADMIN_PASSWORD='choose-a-long-temporary-password'
   npm run server
   ```
   The first admin account is only created when the users table is empty.
   The `server` script uses the Homebrew .NET 8 path. If your SDK is installed somewhere else, update the script in `package.json` or put your .NET 8 `dotnet` first on `PATH`.
3. Run the Angular development server with the API proxy:
   ```bash
   npm run start:proxy
   ```
   Then visit http://localhost:4200/.
   API documentation is available at http://localhost:5000/swagger once the API is running.

## Local database
The .NET API expects a local MySQL or MariaDB database. Example MariaDB setup:
```sql
CREATE DATABASE happy_healthy_hethersett CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'hhh_app'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON happy_healthy_hethersett.* TO 'hhh_app'@'localhost';
FLUSH PRIVILEGES;
```

The API creates its tables on startup using the configured connection string. For MariaDB version detection, update `Database:ServerVersion` in `api/appsettings.json` if your server is not compatible with the default `MariaDb:10.6.0`.

## Start the API automatically on macOS
macOS uses `launchd` for startup services. To install a per-user LaunchAgent that starts the API when your Mac user logs in:
```bash
./scripts/install-api-launch-agent.sh install
```

The installer creates this config file:
```bash
~/.config/happy-healthy-hethersett/api.env
```

Edit that file with the production database connection string and, before the first run only, optional initial admin values. Then restart the service:
```bash
./scripts/install-api-launch-agent.sh restart
```

Useful commands:
```bash
./scripts/install-api-launch-agent.sh status
./scripts/install-api-launch-agent.sh logs
./scripts/install-api-launch-agent.sh stop
./scripts/install-api-launch-agent.sh uninstall
```

This is a user login service. If you need the API to start before anyone logs in, use a system LaunchDaemon instead.

## Deploy to a Mac mini on the local network
If SSH is enabled on the Mac mini, one script can build the Angular client, publish the .NET API, copy the website into the nginx folder and restart the API LaunchAgent:
```bash
./scripts/deploy-to-mac-mini.sh your-user@gabors-mac-mini.local
```

By default it deploys the website to:
```bash
/opt/homebrew/var/www/hhh
```

The API is deployed separately to:
```bash
/opt/homebrew/var/www/hhh-api
```

If your Mac mini uses a different Bonjour/SSH name, pass that instead. You can also set the target once in your shell:
```bash
export HHH_DEPLOY_TARGET='your-user@gabors-mac-mini.local'
./scripts/deploy-to-mac-mini.sh
```

The deploy script reuses one SSH connection, so password-based SSH should only ask once per run. For no password prompts at all, set up an SSH key with the Mac mini instead of storing a password in this repo.

Optional overrides:
```bash
export HHH_REMOTE_WEB_ROOT='/opt/homebrew/var/www/hhh'
export HHH_REMOTE_API_ROOT='/opt/homebrew/var/www/hhh-api'
export HHH_DEPLOY_API_ENV_FILE="$HOME/.config/happy-healthy-hethersett/api.env"
export HHH_REMOTE_API_ENV_FILE='/Users/your-user/.config/happy-healthy-hethersett/api.env'
export HHH_REMOTE_CONNECTION_STRING='server=localhost;port=3306;userid=...;password=...;database=...;'
export HHH_INITIAL_ADMIN_EMAIL='admin@example.com'
export HHH_DOTNET_BIN='/opt/homebrew/opt/dotnet@8/libexec/dotnet'
```

To avoid putting passwords in your shell history, let the deploy script prompt for the remote connection string and the first admin account:
```bash
HHH_PROMPT_REMOTE_CONNECTION_STRING=1 HHH_PROMPT_INITIAL_ADMIN=1 ./scripts/deploy-to-mac-mini.sh your-user@gabors-mac-mini.local
```

nginx must proxy `/api` to the .NET API running on `localhost:5000`. A ready-to-copy example lives at:
```bash
scripts/nginx-hhh.conf.example
```
The example also sets `client_max_body_size 25m` so event photo uploads are not rejected by nginx with `413 Request Entity Too Large`.

## Building for production
Generate an optimized build in `dist/happy-healthy-hethersett`:
```bash
npm run build
```
