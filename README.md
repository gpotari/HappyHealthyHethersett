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

## Building for production
Generate an optimized build in `dist/happy-healthy-hethersett`:
```bash
npm run build
```
