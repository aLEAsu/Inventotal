import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
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

/** Almacenamiento privado en disco (fuera del directorio público, servido solo vía API con control de acceso). */
@Injectable()
export class StorageService {
  private readonly root = resolve(process.env.STORAGE_DIR ?? './storage');

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
    const rel = join('documents', String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'));
    const storedName = `${rel.split(sep).join('/')}/${randomUUID()}${ext}`;
    await mkdir(join(this.root, rel), { recursive: true });
    await writeFile(this.abs(storedName), buf, { flag: 'wx' });
    return { storedName, mimeType: real, sizeBytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
  }

  abs(storedName: string) {
    const p = resolve(this.root, storedName);
    if (!p.startsWith(this.root + sep)) throw new BadRequestException('Ruta inválida');
    return p;
  }

  stream(storedName: string) {
    return createReadStream(this.abs(storedName));
  }

  read(storedName: string) {
    return readFile(this.abs(storedName));
  }

  async exists(storedName: string) {
    try {
      await stat(this.abs(storedName));
      return true;
    } catch {
      return false;
    }
  }
}
