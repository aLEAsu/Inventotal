/** Genera docs/08-procedimientos-operativos.md desde las plantillas base (prisma/base-data.ts) */
import { writeFileSync } from 'node:fs';
import { PROCEDURES } from '../prisma/base-data';
let md = '# 8. Procedimientos operativos\n\n> Plantillas iniciales cargadas en el sistema (Configuración › Procedimientos), donde se consultan y versionan. **Deben ser revisadas y aprobadas por la institución**; al validarlas, desmarque "Pendiente de validación".\n\n';
for (const p of PROCEDURES) md += `## ${p.code} — ${p.title}\n\n**Objetivo:** ${p.objective}  \n**Responsable:** ${p.responsible}\n\n${p.content.split('\n\n').slice(1).join('\n\n')}\n\n`;
writeFileSync('../docs/08-procedimientos-operativos.md', md);
console.log(PROCEDURES.length);
