// Genera un par de claves VAPID para las notificaciones push. Se corre UNA sola vez por instalación:
//   node scripts/generate-vapid.mjs        → JSON { publicKey, privateKey }
//   node scripts/generate-vapid.mjs --env  → líneas VAPID_PUBLIC_KEY=… y VAPID_PRIVATE_KEY=… para el .env
// Si se cambian, las suscripciones existentes dejan de funcionar: hay que volver a activar en cada dispositivo.
// La clave privada es un secreto: no la pegues en chats, issues ni commits.
import webpush from 'web-push';

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
if (process.argv.includes('--env')) {
  console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
} else {
  console.log(JSON.stringify({ publicKey, privateKey }, null, 2));
}
