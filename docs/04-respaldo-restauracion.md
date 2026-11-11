# 4. Manual de respaldo y restauración

## 4.1 Estrategia

| Elemento | Detalle |
|---|---|
| Frecuencia | Diaria, 02:00 hora de Bogotá (`BACKUP_CRON`) |
| Base de datos | `pg_dump` formato personalizado (`-Fc`), comprimido |
| Documentos y evidencias | `tar.gz` del almacenamiento privado (volumen `storage`, montado en solo lectura) |
| Ubicación | `${BACKUP_PATH}`: debe estar en un disco o recurso **separado** del volumen de datos |
| Retención | 30 días por defecto (`BACKUP_RETENTION_DAYS`) |
| Verificación | El archivo existe, supera un tamaño mínimo coherente (`MIN_DB_BYTES`) y `pg_restore --list` lee su catálogo; se genera SHA-256 (`.sha256`). En documentos, el conteo de archivos del respaldo coincide con el origen. |
| Prueba de restauración | Semanal, los domingos (`BACKUP_RESTORE_TEST=weekly`; `always` o `never`): restaura en la base aislada `sigm_restore_test`, compara conteos y la elimina |
| Registro | Cada ejecución queda en la tabla `backup_runs`, visible en Auditoría › Respaldos |

> Un respaldo **no** se considera exitoso solo porque el comando terminó sin error. Si cualquier verificación falla, el resultado se registra como `ERROR`.

## 4.2 Respaldo manual (antes de actualizaciones o cambios importantes)

```bash
docker compose exec backup sh -c '. /etc/backup.env; backup.sh'
```
Con prueba de restauración inmediata:
```bash
docker compose exec backup sh -c '. /etc/backup.env; RESTORE_TEST=always backup.sh'
```

## 4.3 Restauración

1. Identifique el respaldo en `${BACKUP_PATH}/db/` (y su `.sha256`) y, si aplica, el de documentos en `${BACKUP_PATH}/files/`.
2. **Recomendado:** restaure en una base nueva y verifique antes de cambiar la aplicación:
   ```bash
   docker compose exec backup sh -c '. /etc/backup.env; restore.sh /backups/db/<archivo>.dump sigm_restaurada'
   ```
   El script verifica el SHA-256, lee el catálogo, restaura y muestra conteos de control (activos, actividades, órdenes, auditoría).
3. Para reemplazar la base en uso:
   1. Detenga la API:
      ```bash
      docker compose stop api
      ```
   2. Restaure con `FORCE=1`. **Esto reemplaza la base actual: haga antes un respaldo de ella.**
      ```bash
      docker compose exec backup sh -c '. /etc/backup.env; FORCE=1 restore.sh /backups/db/<archivo>.dump sigm'
      ```
   3. Inicie la API:
      ```bash
      docker compose start api
      ```
4. Restauración de documentos: pase el archivo `tar.gz` como tercer argumento y defina `STORAGE_DIR`. El volumen `storage` debe montarse con escritura en un contenedor temporal, porque el servicio `backup` lo monta en solo lectura.

## 4.4 Verificación periódica (procedimiento)

- **Semanal**: revisar en Auditoría › Respaldos que los respaldos tengan *Verificado = Sí* y, los domingos, *Restaurado OK*.
- **Mensual**: copiar un respaldo al medio externo institucional y documentar el resultado.
- **Semestral**: simulacro completo de restauración en un servidor alterno (base y documentos), midiendo el tiempo de recuperación.

## 4.5 Resultado de la prueba realizada en el desarrollo (11/11/2026)

- **Respaldo con `RESTORE_TEST=always`**: base OK, catálogo legible (37 tablas con datos), restauración de prueba OK y documentos íntegros.
- **`restore.sh` en una base nueva**: restauración exitosa con conteos de control.
- **Respaldo alterado a propósito** (1 byte modificado): rechazado con "SHA-256 no coincide: respaldo corrupto".
- **Restauración sobre la base en uso sin `FORCE=1`**: rechazada (protección contra sobrescritura accidental).
