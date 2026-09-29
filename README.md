# Cordada ⛰️

App web (PWA) para organizar salidas a la montaña con tu cordada. Funciona en el
teléfono, se puede "instalar" en la pantalla de inicio y sigue funcionando sin señal.

## Qué hace

| Pestaña | Funciones |
|---|---|
| **Resumen** | Objetivo, fechas, cuenta regresiva, alertas de clima, avance del equipo por persona, links a Andeshandbook / Wikiloc / Google Maps, compartir la salida |
| **Grupo** | Integrantes con teléfono, RUT, edad, contacto de emergencia, certificación de primeros auxilios (WFR/WAFA) y si conocen la ruta; "Soy yo" para filtrar tu equipo. **Cordadas** dentro del grupo y **autos** (conductor, cupos, punto de salida, pasajeros) con avisos de sobrecupo o gente sin auto |
| **Equipo** | Checklist por actividad (trekking, campamento, alta montaña, glaciar, roca, hielo, esquí de travesía, invernal, fotografía). Tres niveles: **personal** (cada integrante marca el suyo), **por cordada** (carpa, cocinilla, cena: una por cordada) y **grupal** (se asigna quién lo lleva). Ítems propios, imprimir |
| **Clima** | Pronóstico a 14 días **corregido a la altura de la cumbre**, comparando ECMWF, GFS e ICON: temperatura, sensación térmica, ráfagas, precipitación, nieve, isoterma 0°, viento en 500 hPa (≈5.500 m). Alertas automáticas y links a Windy, Meteoblue, Ventusky, Meteochile |
| **Mapa** | Mapa topográfico / satelital, fijar objetivo, mi ubicación, cargar track GPX con distancia, desnivel, tiempo estimado y perfil de elevación |
| **Fotos** | Crea una carpeta de Google Drive por salida, sube fotos y videos en calidad original, comparte la carpeta con la cordada y muestra la galería |
| **Plan y seguridad** | Datos del club y jefe/a de salida, plan (ruta, hora límite de cumbre, regreso, hora de alarma), **itinerario** con horarios → genera el **aviso de salida** (con integrantes, RUT, contactos de emergencia, cordadas y autos) para enviar por WhatsApp. Números de emergencia (133, 136, GOPE, Socorro Andino, SAMU, 911) e InReach del club |

El **Resumen** incluye una *revisión de seguridad*: avisa si falta jefe/a de salida, si nadie
conoce la ruta o tiene WFR/WAFA, quién no tiene contacto de emergencia o auto, etc.

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
5. Pegarlo en `js/config.js` y publicar la app (o, para probar, en Ajustes de la app).
6. Authentication → Configuración → Dominios autorizados → agregar el dominio donde está publicada.

Sin Firebase, la app sigue funcionando sola en cada teléfono y se comparte una **copia**
con *Compartir copia* (link o JSON).

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
4. Pega el Client ID en **Ajustes** de la app.

La app solo pide el permiso `drive.file` (ve únicamente lo que ella crea). Sin Client ID
igual puedes guardar el link de una carpeta compartida y enviar las fotos con el menú
"Compartir" del teléfono.

## Fuentes de datos

- Pronóstico y búsqueda de cerros: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0, sin API key)
- Mapas: OpenStreetMap, OpenTopoMap, Esri World Imagery · [Leaflet](https://leafletjs.com/) incluido en `vendor/`
- Rutas: enlaces a [Andeshandbook](https://www.andeshandbook.org/) (no tiene API pública, así que se enlaza la ficha o se busca)

## Ideas para seguir

- Descarga de zonas del mapa para uso offline
- Boletín de avalanchas y estado de pasos fronterizos integrados
- Bitácora de la salida (horas reales, cumbre) y estadísticas
