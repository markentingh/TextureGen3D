# TextureGen3D Framework

This is a template web application solution for the TextureGen3D stack. It contains a .NET API, authentication library, Dapper data access layer, PostgreSQL schema, and a React + Vite + TailwindCSS web client.

## Quick Start

You can go from `git clone` to a running local dashboard in **less than 60 seconds**:

```bash
git clone https://github.com/TextureGen3D/Framework
cd Framework
setup.bat
```

`setup.bat` prompts for a project prefix, PostgreSQL credentials, ports, and SendGrid defaults, then handles renaming, dependency installs, database creation, and schema deployment automatically. After it finishes, run the API server and Vite dev proxy, create the first admin account, and log into the dashboard.

## Projects

- **TextureGen3D.API** - ASP.NET Core API controllers. Contains user management APIs.
- **TextureGen3D.Auth** - Authentication services, JWT setup, and account controller.
- **TextureGen3D.Data** - Dapper-based data access layer with auth repositories and entities.
- **TextureGen3D.SQL** - PostgreSQL schema scripts (tables, indexes, functions, sequences).
- **TextureGen3D.Web.Server** - ASP.NET Core web host that serves the API and SPA fallback.
- **TextureGen3D.Web.Client** - React + Vite + TailwindCSS front-end application.

## Prerequisites

- **.NET 9 SDK** or later - [https://dotnet.microsoft.com/download](https://dotnet.microsoft.com/download)
- **PostgreSQL** - a running server and a database login that can create/read/write the application database.
- **Node.js LTS** - required for the web client build tooling and the setup gulp tasks.
- **npm** - installed with Node.js.
- **Git** - for cloning the repository.
- **Visual Studio 2022** or `dotnet` CLI - for building and running the .NET projects.

## Install Instructions

1. Clone the repository.

   ```bash
   git clone https://github.com/TextureGen3D/Framework
   cd Framework
   ```

2. Run `setup.bat` from the root of the cloned folder. The script customizes the solution and all associated projects. It will prompt for:

   1. The project prefix to use (e.g. `MyCompany`).
   2. The PostgreSQL database name (defaults to the prefix).
   3. PostgreSQL username and password.
   4. API HTTP and HTTPS ports (defaults: 7790 and 7791).
   5. React app (Vite) port (default: 7792).
   6. Whether Vite should use HTTP by default (Y/N).
   7. Default SendGrid from email address and name.

   The script performs the following steps:

   - Replaces `TextureGen3D`/`texturegen3d` identifiers in project files, namespaces, and content with the chosen prefix.
   - Renames solution folders and the `.sln` file to match the prefix.
   - Updates connection strings/ports in `appsettings.json`, `appsettings.Development.json`, `launchSettings.json`, and `vite.config.js`.
   - Generates a 32-character JWT secret.
   - Creates the web client `.env` file.
   - Runs `npm install` from the renamed web client folder (`<Prefix>.Web.Client`) to install React/Vite dependencies.
   - Generates `<Prefix>.SQL/deploy.sql` from the schema files.
   - Creates the PostgreSQL database if it does not exist and runs `deploy.sql` to deploy the schema.

3. Build and run the solution (this takes a few seconds):

   - Open `<Prefix>.sln` in Visual Studio and start the **Web.Server** project.
   - Or run from the command line:

     ```bash
     cd <Prefix>.Web.Server
     dotnet run
     ```

   The first account you create is automatically promoted to admin, so you can sign up at the landing page and log straight into the dashboard.

4. The web client is served by the .NET SPA proxy. If you need to run Vite directly for development, run from the web client folder:

   ```bash
     cd <Prefix>.Web.Client
     npm run dev
   ```

## Manual Setup

1. Run `npm install` from `TextureGen3D.Web.Client` (or `<Prefix>.Web.Client` after setup).
2. Run `TextureGen3D.SQL/deploy.sql` (or `<Prefix>.SQL/deploy.sql` after setup) while connected to a default database such as `template1`. The script creates the application database if it does not exist.

   ```bash
   psql -U <username> -d template1 -f <Prefix>.SQL/deploy.sql
   ```
3. Open `TextureGen3D.sln` (or `<Prefix>.sln` after setup) in Visual Studio or run `dotnet run` from `TextureGen3D.Web.Server` (or `<Prefix>.Web.Server` after setup).
