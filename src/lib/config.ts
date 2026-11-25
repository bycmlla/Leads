import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Carrega as variáveis do .env existente (nomes originais: link, login, senha).
 * Nunca imprime os valores. O .env não é alterado.
 */
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

export interface PortalConfig {
  url: string;
  login: string;
  senha: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Variável obrigatória ausente no .env: "${name}" (veja .env.example)`);
  }
  return value.trim();
}

export function loadConfig(): PortalConfig {
  const url = required('link');
  try {
    new URL(url);
  } catch {
    throw new Error('A variável "link" do .env não contém uma URL válida.');
  }
  return { url, login: required('login'), senha: required('senha') };
}

export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
/** Perfil persistente do Chromium (cookies cifrados pelo próprio Chromium/DPAPI no Windows). */
export const PROFILE_DIR = path.join(PROJECT_ROOT, '.auth', 'chromium-profile');
export const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
export const ARTIFACTS_DIR = path.join(PROJECT_ROOT, 'artifacts');
