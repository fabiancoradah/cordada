# Cordada ⛰️

App web (PWA) para organizar salidas a la montaña con tu cordada. Funciona en el
teléfono, se puede "instalar" en la pantalla de inicio y sigue funcionando sin señal.

## Cómo funciona

1. **El encargado elige el cerro y la fecha.** Nada más. La app completa sola:
   - altura, coordenadas, foto y descripción (OpenStreetMap, Wikidata, Wikipedia);
   - punto de partida más cercano (estacionamiento o fin del camino), refugios y glaciares cercanos (OpenStreetMap);
   - ruta a pie por senderos con distancia, desnivel y tiempo estimado (BRouter);
   - pronóstico en la cota de cumbre comparando ECMWF, GFS e ICON, con alertas (Open-Meteo);
   - **tipo de salida**: varios días, invernal (temporada o nieve pronosticada), alta montaña (altura o isoterma 0° bajo la cumbre) y glaciar. El encargado puede agregar ruta técnica, esquí o fotografía con un toque.
2. **Invita por WhatsApp.** Los invitados abren el link y ven toda la información de la salida.
3. **Cada invitado toca "Voy".** Sus datos salen de *Mi ficha* (se llena una sola vez) y recibe **su lista de equipo** armada según el tipo de salida y el pronóstico (ej. "antiparras: rachas de 65 km/h").
4. **El grupo se organiza solo.** Cada vez que alguien confirma, el teléfono del encargado arma las cordadas, reparte el equipo común equilibrando el peso y asigna los autos según los cupos de cada ficha. Se puede ajustar a mano.
5. **Aviso de salida** listo para enviar al club y al contacto de emergencia, con integrantes, RUT, contactos, cordadas, autos, ruta y acceso.

Pestañas de una salida: **Salida** (toda la información), **Mi equipo**, **Grupo**, **Clima**, **Mapa** y **Aviso** (solo encargado).

## Sincronización en tiempo real (Firebase)

Con Firebase configurado, cada salida se puede **sincronizar**: el botón *Invitar al grupo*
comparte un link corto; quien lo abre se une y todos ven los mismos checks, cordadas,
autos y plan al instante.

- Los cambios se envían campo por campo (ej. "Fabián marcó su saco"), así dos personas
  pueden marcar su equipo al mismo tiempo sin pisarse.
- Funciona **sin señal**: los cambios quedan guardados en el teléfono y se envían al volver la conexión.
- No pide cuentas: usa sesión anónima de Firebase. El id de la salida es largo y aleatorio y
  funciona como llave; las reglas (`firestore.rules`) no permiten listar ni borrar salidas.
- Plan gratuito (Spark): de sobra para un club (50.000 lecturas y 20.000 escrituras diarias).

Configuración (una vez):

1. [Firebase Console](https://console.firebase.google.com/) → crear proyecto.
2. Authentication → habilitar el proveedor **Anónimo**.
3. Firestore Database → crear (región `southamerica-west1`, Santiago) → pestaña Reglas → pegar `firestore.rules`.
4. Configuración del proyecto → Tus apps → Web → copiar el bloque `firebaseConfig`.
5. Pegarlo en `js/config.js` (quien publica la app, una sola vez).
6. Authentication → Configuración → Dominios autorizados → agregar el dominio donde está publicada.

Sin Firebase, la invitación lleva una copia de la salida en el link y cada invitado
le confirma al encargado por WhatsApp con un link que lo suma automáticamente a la lista.

## Probarla en tu computador

No necesita compilación. Desde la raíz del repositorio:

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

## Publicarla

Cada push a `main` la publica en **GitHub Pages** (workflow `.github/workflows/pages.yml`):
`https://fabiancoradah.github.io/cordada/`. La primera vez hay que activar
*Settings → Pages → Source: GitHub Actions*.

También funciona en cualquier hosting estático (Netlify, Cloudflare Pages): no necesita compilación.

## Conectar Google Drive (opcional)

1. En [Google Cloud Console](https://console.cloud.google.com/) crea un proyecto y habilita **Google Drive API**.
2. Configura la pantalla de consentimiento OAuth (Externo) y agrega a tu cordada como usuarios de prueba.
3. Crea un **ID de cliente OAuth → Aplicación web** y agrega la URL donde publicaste la app en *Orígenes autorizados de JavaScript*.
4. Pega el Client ID en `DRIVE_CLIENT_ID` de `js/config.js`.

La app solo pide el permiso `drive.file` (ve únicamente lo que ella crea). Sin Client ID, el
encargado pega el link de una carpeta compartida de Drive o un álbum de Google Fotos.

## Fuentes de datos

- Pronóstico: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0, sin API key)
- Cerros, caminos, refugios y glaciares: OpenStreetMap (Nominatim, Overpass), Wikidata, Wikipedia, GeoNames
- Rutas a pie: [BRouter](https://brouter.de/) sobre datos de OpenStreetMap
- Mapas: OpenStreetMap, OpenTopoMap, Esri World Imagery · [Leaflet](https://leafletjs.com/) incluido en `vendor/`
- Rutas: enlaces a [Andeshandbook](https://www.andeshandbook.org/) (no tiene API pública, así que se enlaza la ficha o se busca)

## Ideas para seguir

- Descarga de zonas del mapa para uso offline
- Boletín de avalanchas y estado de pasos fronterizos integrados
- Bitácora de la salida (horas reales, cumbre) y estadísticas
