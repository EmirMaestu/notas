# Notas — restaurar backups y volver a una versión anterior

Todo se corre en tu VPS (`ssh <usuario>@<ip-de-tu-vps>`). Atajo usado abajo:

```bash
C="docker compose -p notas --env-file $HOME/notas/.env -f $HOME/notas/current/deploy/docker-compose.yml"
```

## Ver los backups

```bash
ls -lh ~/notas/backups/
tail -n 20 ~/notas/backups/backup.log
```

Cada archivo `notas-AAAAMMDD-HHMMSS.sql.gz` es un `pg_dump` en SQL plano con `--clean --if-exists`
(borra y recrea cada tabla al restaurarlo). Se guardan 14 días.

## Probar un backup sin tocar producción

Restaura el último backup en un Postgres temporal y descartable:

```bash
ARCHIVO="$(ls -1t ~/notas/backups/notas-*.sql.gz | head -n 1)"
docker run -d --rm --name notas-restore-test -e POSTGRES_PASSWORD=prueba postgres:16-alpine
until docker exec notas-restore-test pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 2
gzip -dc "$ARCHIVO" | docker exec -i notas-restore-test psql -q -U postgres -d postgres -v ON_ERROR_STOP=1
docker exec notas-restore-test psql -U postgres -d postgres -c '\dt public.*' \
  -c 'select count(*) as usuarios from users' -c 'select count(*) as tareas from tasks'
docker rm -f notas-restore-test
```

Debe listar las 13 tablas de `public` y los conteos esperados.

## Restaurar en producción

1. Backup de lo que hay ahora (por si hay que deshacer la restauración):
   `bash ~/notas/current/deploy/backup.sh`
2. Elegir el archivo (para otro que no sea el más reciente, poné su ruta en `ARCHIVO`):
   `ARCHIVO="$(ls -1t ~/notas/backups/notas-*.sql.gz | sed -n 2p)"` (el 2.º más nuevo: el 1.º es el del paso 1)
3. Frenar la app, restaurar en una sola transacción y volver a levantarla:

```bash
$C stop app
gzip -dc "$ARCHIVO" | $C exec -T db psql -q -U notas -d notas -v ON_ERROR_STOP=1 --single-transaction
$C start app
until curl -fsS http://127.0.0.1:3200/api/health; do sleep 2; done; echo
```

Si `psql` falla, la transacción se deshace entera y la base queda como estaba: volver a levantar la app con
`$C start app` y revisar el error.

## Volver a la versión anterior del código

`deploy.sh` ya vuelve solo a la release anterior (con su imagen `notas-app:<release>`, sin recompilar) si la
nueva no responde. Para hacerlo a mano, `~/notas/deployed.log` lista las releases que llegaron a producción
(la última línea es la actual):

```bash
tail -n 4 ~/notas/deployed.log               # la última es la actual; la anterior, la penúltima
readlink -f ~/notas/current                  # la actual
ANTERIOR="$(tail -n 2 ~/notas/deployed.log | head -n 1)"
test -d ~/notas/releases/$ANTERIOR && docker image inspect notas-app:$ANTERIOR >/dev/null && echo ok
NOTAS_TAG=$ANTERIOR docker compose -p notas --env-file ~/notas/.env -f ~/notas/releases/$ANTERIOR/deploy/docker-compose.yml \
  up -d --remove-orphans
until curl -fsS http://127.0.0.1:3200/api/health; do sleep 2; done; echo
ln -sfn ~/notas/releases/$ANTERIOR ~/notas/current.new && mv -Tf ~/notas/current.new ~/notas/current
docker tag notas-app:$ANTERIOR notas-app:latest
```

Si la imagen `notas-app:$ANTERIOR` no existe (release anterior a las etiquetas por release), agregar `--build`
al `up -d`.

Las migraciones solo van hacia adelante: la versión anterior corre sobre el esquema nuevo (mientras los
cambios sean aditivos). Si no lo fueran, restaurar además el backup previo al despliegue.

## Copia fuera de la VPS

Los backups viven en el mismo disco que la base. Desde la máquina de desarrollo (Git Bash), de vez en cuando:

```bash
mkdir -p ~/notas-backups && scp '<usuario>@<ip-de-tu-vps>:notas/backups/notas-*.sql.gz' ~/notas-backups/
```
