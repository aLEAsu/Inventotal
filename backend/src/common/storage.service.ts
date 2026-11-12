import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const EXT_BY_MIME: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
};

/** Detección por "firma mágica": no se confía en el MIME enviado por el navegador. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
  return null;
}

/**
 * Almacenamiento privado de documentos, servido solo vía API con control de acceso.
 * - Supabase Storage (bucket privado) cuando existen SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY:
 *   necesario en Vercel, cuyo disco es de solo lectura y no persiste entre invocaciones.
 * - Disco local (STORAGE_DIR) en cualquier otro caso: desarrollo, Docker y servidores propios.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger('StorageService');
  private readonly root = resolve(process.env.STORAGE_DIR ?? './storage');
  private readonly supabaseUrl = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  private readonly supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  private readonly bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'documents';

  constructor() {
    if (!this.remote && process.env.VERCEL) {
      this.log.warn('Vercel sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: los documentos subidos no se conservarán');
    }
  }

  /** true si se usa Supabase Storage */
  get remote() {
    return Boolean(this.supabaseUrl && this.supabaseKey);
  }

  async save(buf: Buffer, originalName: string, declaredMime: string, allowed: string[], maxBytes: number) {
    if (!buf.length) throw new BadRequestException('El archivo está vacío');
    if (buf.length > maxBytes) throw new BadRequestException(`El archivo supera el tamaño máximo (${Math.round(maxBytes / 1048576)} MB)`);
    const ext = extname(originalName).toLowerCase();
    let real = sniffMime(buf);
    if (real === 'zip' && EXT_BY_MIME[declaredMime] && ['.xlsx', '.docx'].includes(ext)) real = declaredMime;
    if (!real || real !== declaredMime) {
      throw new BadRequestException('El contenido del archivo no corresponde al tipo declarado');
    }
    if (!allowed.includes(real)) throw new BadRequestException(`Tipo de archivo no autorizado (${real})`);
    if (!EXT_BY_MIME[real]?.includes(ext)) throw new BadRequestException(`Extensión ${ext || '(ninguna)'} no válida para ${real}`);

    const now = new Date();
    const rel = `documents/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const storedName = `${rel}/${randomUUID()}${ext}`;
    if (this.remote) {
      const r = await this.request('POST', storedName, { body: buf, headers: { 'Content-Type': real, 'x-upsert': 'false' } });
      if (!r.ok) throw new ServiceUnavailableException(`No fue posible guardar el archivo (${r.status})`);
    } else {
      await mkdir(join(this.root, ...rel.split('/')), { recursive: true });
      await writeFile(this.abs(storedName), buf, { flag: 'wx' });
    }
    return { storedName, mimeType: real, sizeBytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
  }

  abs(storedName: string) {
    const p = resolve(this.root, storedName);
    if (!p.startsWith(this.root + sep)) throw new BadRequestException('Ruta inválida');
    return p;
  }

  async read(storedName: string): Promise<Buffer> {
    if (!this.remote) return readFile(this.abs(storedName));
    const r = await this.request('GET', storedName);
    if (r.status === 404 || r.status === 400) throw new NotFoundException('El archivo no se encuentra en el almacenamiento');
    if (!r.ok) throw new ServiceUnavailableException(`No fue posible leer el archivo (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }

  async exists(storedName: string) {
    if (this.remote) {
      const r = await this.request('HEAD', storedName);
      return r.ok;
    }
    try {
      await stat(this.abs(storedName));
      return true;
    } catch {
      return false;
    }
  }

  private request(method: 'GET' | 'POST' | 'HEAD', storedName: string, init: { body?: Buffer; headers?: Record<string, string> } = {}) {
    if (!/^[\w\-./]+$/.test(storedName) || storedName.includes('..')) throw new BadRequestException('Ruta inválida');
    const path = storedName.split('/').map(encodeURIComponent).join('/');
    return fetch(`${this.supabaseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.supabaseKey}`, apikey: this.supabaseKey, ...init.headers },
      body: init.body ? new Uint8Array(init.body) : undefined,
    });
  }
}
