const gulp = require('gulp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootPath = __dirname

const sourceName = 'Datasilk';
const sourceNameLower = 'datasilk';
const excludedDirs = ['node_modules', 'bin', 'obj', 'dist', '.git', '.vs', '.windsurf'];
// Scaffolding files used only by the template itself; never copy these into a generated solution.
const rootExcludedFiles = ['gulpfile.js', 'package.json', 'package-lock.json', 'setup.bat'];
const textExtensions = [
  '.cs', '.csproj', '.sln', '.esproj', '.json', '.js', '.jsx', '.ts', '.tsx', '.html', '.css',
  '.md', '.sql', '.xml', '.config', '.pubxml', '.bat', '.user'
];

function toCamelCase(str) {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = toCamelCase(argv[i].substring(2));
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
      args[key] = value;
      if (value !== 'true') i++;
    }
  }
  return args;
}

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (textExtensions.includes(ext)) return true;
  const base = path.basename(filePath).toLowerCase();
  if (base === '.gitignore' || base === '.editorconfig' || base === 'nuget.config') return true;
  return false;
}

function patternToRegex(pattern, anchored) {
  let regexPattern = pattern
    .replace(/\*\*/g, '<<<DS>>>')
    .replace(/\*/g, '<<<STAR>>>')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/<<<DS>>>/g, '.*')
    .replace(/<<<STAR>>>/g, '[^/]*');
  if (anchored) {
    return new RegExp('^' + regexPattern + '(?:/.*)?$');
  }
  return new RegExp('(?:^|/)' + regexPattern + '(?:/.*)?$');
}

function parseGitignore(content) {
  const rules = [];
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negation = line.startsWith('!');
    const pattern = negation ? line.substring(1) : line;
    const directory = pattern.endsWith('/');
    const clean = directory ? pattern.slice(0, -1) : pattern;
    const anchored = clean.startsWith('/');
    const finalPattern = anchored ? clean.substring(1) : clean;
    rules.push({
      pattern: finalPattern,
      regex: patternToRegex(finalPattern, anchored),
      negation,
      directory
    });
  }
  return rules;
}

function matchesGitignore(relativePath, isDirectory, rules) {
  let ignored = false;
  for (const rule of rules) {
    if (rule.directory && !isDirectory) continue;
    if (rule.regex.test(relativePath)) {
      ignored = !rule.negation;
    }
  }
  return ignored;
}

function collectGitignoreRules() {
  const rulesByBase = [];
  function walk(dir, base) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (excludedDirs.includes(entry.name)) continue;
      const childBase = base ? base + '/' + entry.name : entry.name;
      const gitignorePath = path.join(dir, entry.name, '.gitignore');
      if (fs.existsSync(gitignorePath)) {
        const content = fs.readFileSync(gitignorePath, 'utf8');
        rulesByBase.push({ base: childBase, rules: parseGitignore(content) });
      }
      walk(path.join(dir, entry.name), childBase);
    }
  }
  const rootGitignore = path.join(rootPath, '.gitignore');
  if (fs.existsSync(rootGitignore)) {
    rulesByBase.push({ base: '', rules: parseGitignore(fs.readFileSync(rootGitignore, 'utf8')) });
  }
  walk(rootPath, '');
  return rulesByBase;
}

function shouldExclude(relativePath, isDirectory, ignoreRules) {
  const parts = relativePath.split('/').filter(p => p);
  if (parts.some(p => excludedDirs.includes(p))) return true;
  const fileName = path.basename(relativePath);
  if (parts.length === 1 && rootExcludedFiles.includes(fileName)) return true;
  for (const { base, rules } of ignoreRules) {
    if (!relativePath.startsWith(base) && base !== '') continue;
    const subPath = base === '' ? relativePath : relativePath.substring(base.length + 1);
    if (matchesGitignore(subPath, isDirectory, rules)) return true;
  }
  return false;
}

function replaceContent(content, prefix, prefixLower) {
  let result = content;
  result = result.split(sourceName).join(prefix);
  result = result.split(sourceNameLower).join(prefixLower);
  return result;
}

function replaceGuid(slug, index) {
  return crypto.randomUUID().toUpperCase();
}

function replaceSolutionGuids(content) {
  return content.replace(/\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}/g, replaceGuid);
}

function newProjectName(fileName, prefix) {
  return fileName.replace(sourceName, prefix);
}

function replaceInPlaceRecursive(dir, prefix, prefixLower, ignoreRules) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(dir, entry.name);
    const relativePath = path.relative(rootPath, srcPath).replace(/\\/g, '/');
    if (shouldExclude(relativePath, entry.isDirectory(), ignoreRules)) continue;

    if (entry.isDirectory()) {
      replaceInPlaceRecursive(srcPath, prefix, prefixLower, ignoreRules);
    } else if (isTextFile(srcPath)) {
      let content = fs.readFileSync(srcPath, 'utf8');
      const newContent = replaceContent(content, prefix, prefixLower);
      if (newContent !== content || path.extname(srcPath).toLowerCase() === '.sln') {
        let finalContent = newContent;
        if (path.extname(srcPath).toLowerCase() === '.sln') {
          finalContent = replaceSolutionGuids(finalContent);
        }
        fs.writeFileSync(srcPath, finalContent, 'utf8');
      }
    }
  }
}

function replaceInPlace(prefix, prefixLower, ignoreRules) {
  replaceInPlaceRecursive(rootPath, prefix, prefixLower, ignoreRules);
}

function renameRootFolders(prefix) {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.includes(sourceName)) {
      const oldPath = path.join(rootPath, entry.name);
      const newName = entry.name.replace(sourceName, prefix);
      const newPath = path.join(rootPath, newName);
      fs.renameSync(oldPath, newPath);
    }
  }
}

function renameProjectFiles(prefix) {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(rootPath, entry.name);
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile()) continue;
      if (!file.name.endsWith('.csproj') && !file.name.endsWith('.esproj')) continue;
      if (!file.name.includes(sourceName)) continue;
      const oldPath = path.join(dirPath, file.name);
      const newName = file.name.replace(sourceName, prefix);
      const newPath = path.join(dirPath, newName);
      fs.renameSync(oldPath, newPath);
    }
  }
}

function findSolutionFilePath() {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.sln')) {
      return path.join(rootPath, entry.name);
    }
  }
  return null;
}

function addOrUpdateProjectGuid(filePath, guid) {
  let content = fs.readFileSync(filePath, 'utf8');
  const projectGuidRegex = /<ProjectGuid>\s*{[A-F0-9-]+}\s*<\/ProjectGuid>/i;

  if (projectGuidRegex.test(content)) {
    content = content.replace(projectGuidRegex, `<ProjectGuid>${guid}</ProjectGuid>`);
  } else {
    content = content.replace(/<\/PropertyGroup>/i, `    <ProjectGuid>${guid}</ProjectGuid>\n  </PropertyGroup>`);
  }

  fs.writeFileSync(filePath, content, 'utf8');
}

function regenerateProjectGuids(prefix) {
  const slnPath = findSolutionFilePath();
  if (!slnPath) return;

  let content = fs.readFileSync(slnPath, 'utf8');
  const projectRegex = /Project\("({[A-F0-9-]+})"\)\s*=\s*"([^"]+)",\s*"([^"]+)",\s*"({[A-F0-9-]+})"/g;
  const projects = [];
  let match;

  while ((match = projectRegex.exec(content)) !== null) {
    projects.push({
      typeGuid: match[1],
      name: match[2],
      path: match[3],
      oldGuid: match[4],
      newGuid: `{${crypto.randomUUID()}}`
    });
  }

  for (const project of projects) {
    content = content.split(project.oldGuid).join(project.newGuid);
  }

  fs.writeFileSync(slnPath, content, 'utf8');

  for (const project of projects) {
    const projectFilePath = path.join(rootPath, project.path);
    if (fs.existsSync(projectFilePath)) {
      addOrUpdateProjectGuid(projectFilePath, project.newGuid);
    }
  }
}

function renameSolutionFile(prefix) {
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.includes(sourceName) && entry.name.endsWith('.sln')) {
      const oldPath = path.join(rootPath, entry.name);
      const newName = entry.name.replace(sourceName, prefix);
      const newPath = path.join(rootPath, newName);
      fs.renameSync(oldPath, newPath);
    }
  }
}

function projectFolder(prefix, project) {
  return path.join(rootPath, newProjectName(`Datasilk.${project}`, prefix));
}

function generateJwtSecret(length = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

function sanitizeDatabaseName(prefix) {
  return prefix.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function updateAppsettings(args, prefixLower) {
  const serverFolder = projectFolder(args.prefix, 'Web.Server');
  const templatePath = path.join(serverFolder, 'appsettings.template.json');
  const filePath = path.join(serverFolder, 'appsettings.json');
  if (!fs.existsSync(templatePath)) return;
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  fs.copyFileSync(templatePath, filePath);
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace all template placeholders in the raw JSON first
  const dbName = sanitizeDatabaseName(args.database || args.prefix);
  content = content.replace(/Datasilk/g, args.prefix).replace(/datasilk/g, dbName);

  const config = JSON.parse(content);

  if (args.pguser || args.pgpassword) {
    let cs = config.ConnectionStrings.Database;
    if (args.pguser) cs = cs.replace(/Username=[^;]+/, `Username=${args.pguser}`);
    if (args.pgpassword) cs = cs.replace(/Password=[^;]+/, `Password=${args.pgpassword}`);
    config.ConnectionStrings.Database = cs;
  }

  if (args.apiHttpsPort) {
    config.Auth.Domain = `https://0.0.0.0:${args.apiHttpsPort}`;
  }

  if (config.Auth && config.Auth.JWT) {
    config.Auth.JWT.Secret = generateJwtSecret(32);
  }

  if (config.SendGrid) {
    if (args.defaultFromEmail) config.SendGrid.DefaultFromEmail = args.defaultFromEmail;
    if (args.defaultFromName) config.SendGrid.DefaultFromName = args.defaultFromName;
  }

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
}

function updateAppsettingsDevelopment(args) {
  const filePath = path.join(projectFolder(args.prefix, 'Web.Server'), 'appsettings.Development.json');
  if (!fs.existsSync(filePath)) return;
  const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (args.apiHttpPort && args.apiHttpsPort) {
    config.Urls = `http://0.0.0.0:${args.apiHttpPort};https://0.0.0.0:${args.apiHttpsPort}`;
  }

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
}

function updateLaunchSettings(args) {
  const filePath = path.join(projectFolder(args.prefix, 'Web.Server'), 'Properties', 'launchSettings.json');
  if (!fs.existsSync(filePath)) return;
  const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const httpUrl = args.apiHttpPort ? `http://0.0.0.0:${args.apiHttpPort}` : 'http://0.0.0.0:7780';
  const httpsUrl = args.apiHttpsPort ? `https://0.0.0.0:${args.apiHttpsPort}` : 'https://0.0.0.0:7781';

  if (config.profiles) {
    if (config.profiles.http) {
      config.profiles.http.applicationUrl = httpUrl;
    }
    if (config.profiles.https) {
      config.profiles.https.applicationUrl = `${httpsUrl};${httpUrl}`;
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
}

function updateViteConfig(args) {
  const clientFolder = projectFolder(args.prefix, 'Web.Client');
  const filePath = path.join(clientFolder, 'vite.config.js');
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');

  if (args.reactPort) {
    content = content.replace(/const port = useHttp \? \d+ : \d+;/, `const port = ${args.reactPort};`);
  }
  if (args.apiHttpPort) {
    content = content.replace(/'http:\/\/0\.0\.0\.0:7780'/, `'http://0.0.0.0:${args.apiHttpPort}'`);
  }
  if (args.apiHttpsPort) {
    content = content.replace(/'https:\/\/0\.0\.0\.0:7781'/, `'https://0.0.0.0:${args.apiHttpsPort}'`);
  }

  fs.writeFileSync(filePath, content, 'utf8');
}

function createEnvFile(args) {
  const clientFolder = projectFolder(args.prefix, 'Web.Client');
  const filePath = path.join(clientFolder, '.env');
  const useHttp = args.useHttp ? args.useHttp.toLowerCase() : 'false';
  const value = useHttp === 'true' || useHttp === 'y' || useHttp === 'yes' ? 'true' : 'false';
  fs.writeFileSync(filePath, `VITE_USE_HTTP=${value}\n`, 'utf8');
}

function updateConfigFiles(args, prefix) {
  updateAppsettings(args, prefix.toLowerCase());
  updateAppsettingsDevelopment(args);
  updateLaunchSettings(args);
  updateViteConfig(args);
  createEnvFile(args);
}

function validatePrefix(prefix) {
  if (!prefix) return false;
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(prefix)) return false;
  return true;
}

function setupTask() {
  const args = parseArgs();
  const prefix = args.prefix || args.name;

  if (!prefix) {
    console.error('Usage: npx gulp setup --prefix <Prefix>');
    process.exit(1);
  }

  if (!validatePrefix(prefix)) {
    console.error('Prefix must start with a letter and contain only letters and numbers.');
    process.exit(1);
  }

  const prefixLower = prefix.toLowerCase();

  console.log(`Customizing current directory with prefix ${prefix}...`);
  const ignoreRules = collectGitignoreRules();
  replaceInPlace(prefix, prefixLower, ignoreRules);
  renameRootFolders(prefix);
  renameProjectFiles(prefix);
  regenerateProjectGuids(prefix);
  renameSolutionFile(prefix);
  updateConfigFiles(args, prefix);
  console.log('Solution customized successfully.');
  return Promise.resolve();
}

exports.default = setupTask;
exports['setup'] = setupTask;
