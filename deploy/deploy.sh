#!/usr/bin/env bash
# Despliega el HEAD de este repositorio en la VPS. Desde la raíz del repo, en Git Bash:
#   bash deploy/deploy.sh
# Obligatoria: NOTAS_DEPLOY_HOST (p. ej. usuario@mi-vps), por entorno o en el archivo deploy/.deploy.env (no versionado).
# Opcional: NOTAS_ALLOW_BRANCH=1 para desplegar otra rama.
#
# En la VPS: ~/notas/releases/<fecha UTC>-<sha> (código), ~/notas/current (symlink a la release activa),
# ~/notas/.env (secretos), ~/notas/backups (fuera de las releases), ~/notas/deployed.log (releases que
# llegaron a producción, una por línea) y ~/notas/.deploy.lock (un solo despliegue a la vez).
# Cada release construye la imagen notas-app:<release>; la vuelta atrás reutiliza esa imagen sin recompilar.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# Destino: NOTAS_DEPLOY_HOST del entorno o, si no est�, de deploy/.deploy.env (archivo local, ignorado por git).
if [ -z "${NOTAS_DEPLOY_HOST:-}" ] && [ -f deploy/.deploy.env ]; then
  set -a
  # shellcheck disable=SC1091
  . deploy/.deploy.env
  set +a
fi
if [ -z "${NOTAS_DEPLOY_HOST:-}" ]; then
  echo "Falta NOTAS_DEPLOY_HOST (p. ej. usuario@mi-vps): definila en el entorno o en deploy/.deploy.env." >&2
  exit 1
fi
VPS="$NOTAS_DEPLOY_HOST"

if [ -n "$(git status --porcelain)" ]; then
  echo "El árbol de trabajo no está limpio: commiteá o descartá los cambios antes de desplegar." >&2
  git status --short >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "master" ] && [ "${NOTAS_ALLOW_BRANCH:-}" != "1" ]; then
  echo "Estás en la rama '$BRANCH': se despliega master (o usá NOTAS_ALLOW_BRANCH=1)." >&2
  exit 1
fi

SHA="$(git rev-parse HEAD)"
REL="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short=7 HEAD)"
echo "==> Desplegando $REL ($BRANCH) en $VPS"

if ! ssh -o BatchMode=yes "$VPS" 'test -f ~/notas/.env'; then
  echo "No se pudo entrar a $VPS o falta ~/notas/.env (ver Task B1 del Plan 5)." >&2
  exit 1
fi

echo "==> Subiendo el código (git archive de HEAD a una release nueva)"
git archive --format=tar HEAD | gzip -c | ssh -o BatchMode=yes "$VPS" \
  "set -e; flock -n ~/notas/.deploy.lock true || { echo 'Hay otro despliegue en curso.' >&2; exit 1; }; mkdir -p ~/notas/releases/$REL; tar -xzf - -C ~/notas/releases/$REL; echo $SHA > ~/notas/releases/$REL/REVISION"

echo "==> Construyendo y levantando en la VPS"
ssh -o BatchMode=yes "$VPS" bash -s -- "$REL" <<'REMOTE'
set -euo pipefail
REL="$1"
BASE="$HOME/notas"
RELEASE="$BASE/releases/$REL"
ENV_FILE="$BASE/.env"
HEALTH_URL="http://127.0.0.1:3200/api/health"

# Un solo despliegue a la vez (el descriptor 9 mantiene el lock hasta que termina el script).
exec 9>"$BASE/.deploy.lock"
if ! flock -n 9; then
  echo "Hay otro despliegue en curso." >&2
  exit 1
fi

# Si algo falla antes del cambio de symlink, se borra la release a medio hacer (salvo que ya sea la actual).
SWAPPED=0
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$SWAPPED" -eq 0 ]; then
    if [ "$(readlink -f "$BASE/current" 2>/dev/null || true)" != "$RELEASE" ]; then
      echo "==> Despliegue fallido: se borra la release $REL" >&2
      rm -rf -- "${RELEASE:?}"
    fi
  fi
}
trap on_exit EXIT

# compose <release-dir> <tag-de-imagen> <args...>
compose() {
  local dir="$1" tag="$2"
  shift 2
  NOTAS_TAG="$tag" docker compose -p notas --env-file "$ENV_FILE" -f "$dir/deploy/docker-compose.yml" "$@"
}

healthy() {
  local i
  for i in $(seq 1 60); do
    if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

# Vuelve a la release anterior con su imagen ya construida (sin recompilar). Devuelve 0 solo si responde.
rollback() {
  local tag
  tag="$(basename "$PREV")"
  local build=()
  if ! docker image inspect "notas-app:$tag" >/dev/null 2>&1; then
    echo "    (no hay imagen notas-app:$tag; se reconstruye)" >&2
    build=(--build)
  fi
  compose "$PREV" "$tag" up -d ${build[@]+"${build[@]}"} --remove-orphans || return 1
  healthy || return 1
  docker tag "notas-app:$tag" notas-app:latest >/dev/null 2>&1 || true
}

AVAIL_GB="$(df -BG --output=avail / | tail -n 1 | tr -dc '0-9')"
if [ "${AVAIL_GB:-0}" -lt 5 ]; then
  echo "Poco espacio libre en /: ${AVAIL_GB:-0} GB (mínimo 5 GB)." >&2
  exit 1
fi

chmod +x "$RELEASE"/deploy/*.sh
PREV=""
if [ -L "$BASE/current" ]; then PREV="$(readlink -f "$BASE/current")"; fi

compose "$RELEASE" "$REL" config --quiet
nice -n 10 env NOTAS_TAG="$REL" docker compose -p notas --env-file "$ENV_FILE" -f "$RELEASE/deploy/docker-compose.yml" build app
compose "$RELEASE" "$REL" up -d --remove-orphans

if ! healthy; then
  echo "!! La versión $REL no respondió en $HEALTH_URL" >&2
  compose "$RELEASE" "$REL" ps >&2 || true
  compose "$RELEASE" "$REL" logs --tail 80 app >&2 || true
  if [ -n "$PREV" ] && [ -d "$PREV" ] && [ "$PREV" != "$RELEASE" ]; then
    echo "==> Volviendo a $(basename "$PREV")" >&2
    if rollback; then
      echo "==> Versión anterior restaurada; se borra la release fallida" >&2
    else
      echo "!! ATENCIÓN: la versión anterior tampoco responde: revisar a mano (deploy/restore.md)" >&2
    fi
  else
    echo "!! No hay versión anterior a la que volver" >&2
  fi
  exit 1
fi

ln -sfn "$RELEASE" "$BASE/current.new"
mv -Tf "$BASE/current.new" "$BASE/current"
SWAPPED=1
echo "$REL" >> "$BASE/deployed.log"
docker tag "notas-app:$REL" notas-app:latest
echo "==> current -> releases/$REL"

# Se conservan la actual, la anterior y las 3 últimas de deployed.log; el resto de releases (incluidas las
# fallidas que hayan quedado) se borra. Solo se toca ~/notas/releases/.
CURRENT="$(readlink -f "$BASE/current")"
KEEP="$(tail -n 3 "$BASE/deployed.log"; basename "$CURRENT"; if [ -n "$PREV" ]; then basename "$PREV"; fi)"
for dir in "${BASE:?}"/releases/*/; do
  [ -d "$dir" ] || continue
  old="$(basename "$dir")"
  if printf '%s\n' "$KEEP" | grep -qxF -- "$old"; then continue; fi
  rm -rf -- "${BASE:?}/releases/${old:?}"
  echo "    release vieja borrada: $old"
done

# Imágenes notas-app:<release> cuya release ya no existe (la actual y la anterior siguen en disco: se conservan).
docker image ls notas-app --format '{{.Tag}}' | while read -r tag; do
  [ "$tag" = "latest" ] && continue
  [ "$tag" = "<none>" ] && continue
  [ -d "$BASE/releases/$tag" ] && continue
  docker rmi "notas-app:$tag" >/dev/null 2>&1 || true
  echo "    imagen vieja borrada: notas-app:$tag"
done
# Capas sin etiqueta que dejó el build (solo las de Notas, por la etiqueta del compose).
docker image prune -f --filter label=notas.component=app >/dev/null

compose "$BASE/current" "$REL" ps
echo "==> Listo: $(cat "$BASE/current/REVISION")"
REMOTE
