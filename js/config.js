// Configuración opcional (la completa solo quien publica la app, una vez).
//
// FIREBASE_CONFIG: sincronización en tiempo real entre los teléfonos del grupo
// (confirmaciones, equipo marcado, cordadas y autos al instante). Pega aquí el
// bloque `firebaseConfig` de tu proyecto. No es secreto: la seguridad la dan
// las reglas de firestore.rules. Sin esto, las invitaciones van como copia en
// el link y las confirmaciones llegan al encargado por WhatsApp.
export const FIREBASE_CONFIG = null;

// DRIVE_CLIENT_ID: para subir fotos a Drive directo desde la app (opcional).
// Sin esto, el encargado comparte el link de una carpeta de Drive o Google Fotos.
export const DRIVE_CLIENT_ID = null;
