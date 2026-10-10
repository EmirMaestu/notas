#!/usr/bin/env bash
# Backup de la base de Notas: pg_dump comprimido en ~/notas/backups; se conservan 14 días.
# Cron (usuario emir):  45 4 * * * bash ~/notas/current/deploy/backup.sh >> ~/notas/backups/backup.log 2>&1
set -euo pipefail
umask 077

BASE="${NOTAS_BASE:-$HOME/notas}"
DEST="$BASE/backups"
KEEP_DAYS="${NOTAS_BACKUP_DAYS:-14}"
if ! [[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || [ "$KEEP_DAYS" -lt 1 ]; then
  echo "NOTAS_BACKUP_DAYS debe ser un entero >= 1 (valor: '$KEEP_DAYS')" >&2
  exit 1
fi
FILE="$DEST/notas-$(date +%Y%m%d-%H%M%S).sql.gz"
TMP="$FILE.part"

log() { echo "$(date '+%F %T') [backup] $*"; }
trap 'rm -f "$TMP"' EXIT

mkdir -p "$DEST"
log "inicio: $FILE"

# --clean --if-exists: el SQL borra y recrea cada objeto, así se restaura sobre la base existente con psql.
docker compose -p notas --env-file "$BASE/.env" -f "$BASE/current/deploy/docker-compose.yml" \
  exec -T db pg_dump -U notas -d notas --clean --if-exists --no-owner \
  | gzip -9 > "$TMP"

gzip -t "$TMP"
TABLES="$(gzip -dc "$TMP" | grep -c '^CREATE TABLE' || true)"
if [ "${TABLES:-0}" -eq 0 ]; then
  log "ERROR: el dump no contiene tablas; no se guarda"
  exit 1
fi
mv "$TMP" "$FILE"
log "ok: $TABLES tablas, $(du -h "$FILE" | cut -f1)"

# -mtime +13 = modificados hace 14 días o más.
DELETED="$(find "$DEST" -maxdepth 1 -name 'notas-*.sql.gz' -mtime +"$((KEEP_DAYS - 1))" -print -delete | wc -l)"
log "borrados por antigüedad (>= $KEEP_DAYS días): $DELETED"
