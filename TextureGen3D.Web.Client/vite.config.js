import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import fs from 'fs';
import path from 'path';
import child_process from 'child_process';
import { env } from 'process';
import react from '@vitejs/plugin-react';

const baseFolder =
    env.APPDATA !== undefined && env.APPDATA !== ''
        ? `${env.APPDATA}/ASP.NET/https`
        : `${env.HOME}/.aspnet/https`;

if (!fs.existsSync(baseFolder)) {
    fs.mkdirSync(baseFolder, { recursive: true });
}

const certificateName = "texturegen3d.web.client";
const certFilePath = path.join(baseFolder, `${certificateName}.pem`);
const keyFilePath = path.join(baseFolder, `${certificateName}.key`);

if (!fs.existsSync(certFilePath) || !fs.existsSync(keyFilePath)) {
    if (0 !== child_process.spawnSync('dotnet', [
        'dev-certs',
        'https',
        '--export-path',
        certFilePath,
        '--format',
        'Pem',
        '--no-password',
    ], { stdio: 'inherit', }).status) {
        throw new Error("Could not create certificate.");
    }
}

export default defineConfig(({ mode }) => {
    const viteEnv = loadEnv(mode, process.cwd(), '');
    const useHttp = viteEnv.VITE_USE_HTTP === 'true';
    const port = 7766;
    const api_url = env.ASPNETCORE_HTTPS_PORT ? `https://0.0.0.0:${env.ASPNETCORE_HTTPS_PORT}` :
        env.ASPNETCORE_URLS ? env.ASPNETCORE_URLS.split(';')[0] : 'https://0.0.0.0:7765';
    const target = useHttp ? 'http://0.0.0.0:7764' : api_url;

    return {
        plugins: [react()],
        resolve: {
            alias: {
                '@': fileURLToPath(new URL('./src', import.meta.url))
            }
        },
        server: {
            host: '0.0.0.0',
            allowedHosts: ['localhost'],
            proxy: {
                '^/api': {
                    target,
                    secure: false
                },
                '^/hubs': {
                    target,
                    secure: false,
                    ws: true
                }
            },
            port: port,
            ...(useHttp ? {} : {
                https: {
                    key: fs.readFileSync(keyFilePath),
                    cert: fs.readFileSync(certFilePath),
                }
            })
        },
        build: {
            sourcemap: true,
            assetsInlineLimit: 0
        }
    };
})
