# TextureGen3D.SQL

PostgreSQL database schema for the TextureGen3D template.

## Structure

- `Tables/` - Table definitions for authentication and user management.
- `SeedData/` - Initial seed data (e.g., AppRoles).
- `Indexes/` - Database indexes.
- `Functions/` - PostgreSQL functions (e.g., sequence reset).
- `Sequences/` - Custom sequences.
- `deploy.sql` - Master deployment script that runs all schema files.
- `gulpfile.js` - Auto-generates `deploy.sql` from the files in the subfolders.
- `package.json` - Node dependencies for the gulpfile.

## Generating deploy.sql

After adding or renaming schema files, regenerate `deploy.sql` so it includes all files in the correct order:

```bash
npm install
gulp update-deploy
```

You can also watch for changes:

```bash
gulp watch
```

## Deployment

### One-command deployment

```bash
deploy.bat [database-name]
```

This generates `deploy.sql` (via gulp) and runs it against `template1`, which creates the database if it does not exist and then deploys all schema objects. Defaults to `texturegen3d` if no database name is provided.

### Manual deployment

1. Generate `deploy.sql`:

```bash
npm install
gulp update-deploy
```

2. Run `deploy.sql` against a default database (e.g., `template1`); it creates the application database if it does not exist:

```bash
psql -h localhost -U postgres -d template1 -f deploy.sql
```

## Important Notes

- This project intentionally does **not** include SQL Server artifacts or migration scripts.
- All PostgreSQL objects are created in the `public` schema.
- The `ResetAllSequences()` function resets serial sequences to `MAX(id) + 1` on startup.
