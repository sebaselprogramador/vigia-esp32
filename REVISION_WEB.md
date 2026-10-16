# Revisión de la web Vigía — 15 de octubre de 2026

## Resultado y criterio

Se eliminó la demostración por decisión del usuario. La aplicación inicia sin
lecturas y solo presenta datos recibidos de Firebase después de autenticar al
visor. Se conservan indicadores, estados de buzzer/bombas, gráficas por sensor,
períodos de 1/6/24 horas, picos, historial y CSV. La web sigue siendo de solo lectura.

Simplificar no significa juntar todo en un archivo ni quitar validaciones: eso
reduce claridad y facilita errores. Se retiraron comportamientos innecesarios y
se compartió lógica repetida, conservando separación entre presentación y datos.

## Cambios concretos

- Eliminados generador de lecturas falsas, eventos ficticios, botón para simular
  alertas, cambio entre modos y temporizadores exclusivos de demostración.
- `app.js`: simplificados gráficos SVG, construcción de filas del historial e
  importación/suscripción a Firebase. No se incorporaron librerías de gráficas.
- `model.js`: una sola función transforma, valida y ordena las colecciones.
  Los eventos validan motivo, máximos y coherencia entre inicio y fin. Los motivos
  desconocidos no pueden resolverse mediante propiedades heredadas del objeto.
- El filtro de eventos incluye episodios activos o terminados dentro del período
  aunque empezaran antes. Una fecha futura fuera del margen admitido no aparece.
- Las celdas usan `textContent`; el SVG solo recibe números validados, horas
  formateadas y atributos constantes. No se inserta HTML recibido de Firebase.
- Sin sesión se muestran guiones y estados «Sin reporte». Una lectura antigua,
  ausencia de datos o fallo de conexión produce estado desconocido. Cerrar sesión
  cancela las cuatro suscripciones y limpia las lecturas e historial visibles.
- El servidor local solo sirve los cinco archivos de la web. Rechaza documentos,
  ZIP, pruebas y rutas ajenas. No es un servidor de producción ni una API propia.

## Tamaño del código de ejecución

Bytes de los archivos, sin comprimir; las pruebas y documentos no se descargan
como parte de la web. El SDK remoto de Firebase no se incluye en esta comparación.

| Archivo | Antes | Después |
| --- | ---: | ---: |
| app.js | 15 217 | 12 228 |
| model.js | 1 240 | 1 968 |
| index.html | 5 324 | 5 117 |
| styles.css | 6 906 | 6 794 |
| server.mjs (solo desarrollo) | 1 001 | 863 |

`app.js` disminuyó aproximadamente 19,6 %. La suma de los cuatro archivos que
ejecuta/presenta el navegador disminuyó 9,0 %. `model.js` aumentó al incorporar
validaciones explícitas. Menos bytes no equivale por sí solo a menos errores.

## Tecnologías y estructura

| Tecnología / archivo | Uso |
| --- | --- |
| HTML5 — index.html | Estructura, controles, tabla y formulario de acceso |
| CSS — styles.css | Diseño adaptable a móvil y computadora |
| JavaScript con módulos — app.js | Interfaz, escucha de Firebase, acceso y exportación |
| JavaScript — model.js | Validación, orden, filtros, umbrales y CSV |
| SVG nativo | Gráficas sin Chart.js u otra dependencia de gráficos |
| Firebase JS SDK modular 12.19.0 | App, Authentication y Realtime Database, importados desde gstatic |
| config.js | Configuración pública de Firebase, dispositivo y caducidad de lectura |
| database.rules.json | Plantilla de permisos e índices de Realtime Database |
| Node.js — server.mjs | Vista previa local HTTP |
| Node.js Test Runner / VM | Pruebas de funciones y de la app con Firebase simulado |
| Git / GitHub | Versionado y repositorio privado |

No hay React, Angular, Vue, npm de Firebase, compilador del frontend ni backend
propio. `package.json` contiene comandos de desarrollo y pruebas. El navegador
necesita Internet para descargar el SDK y conectarse a Firebase.

## Firebase, Realtime Database y Cloud Firestore

Firebase es la plataforma. Authentication y sus dos bases de datos son servicios
de esa plataforma, no nombres alternativos para la misma cosa.

| Servicio | Organización | Lecturas en tiempo real | En este proyecto |
| --- | --- | --- | --- |
| Realtime Database | Árbol JSON de rutas | Sí, mediante suscripciones | Base de datos elegida |
| Cloud Firestore | Colecciones y documentos | Sí, mediante listeners | No se utiliza |
| Authentication | Cuentas y sesiones | Gestiona identidad | Acceso del visor y del dispositivo |

Firestore permite consultas más expresivas y combina filtros/ordenaciones de
manera diferente. Realtime Database encaja con este árbol sencillo de un ESP32.
Migrar ahora exigiría cambiar firmware, consultas y reglas sin resolver una
necesidad actual. Ninguna de las dos bases sustituye la configuración de permisos.

## Recorrido y API usados por la web

ESP32 → Wi-Fi → Firebase Realtime Database → suscripciones del navegador → interfaz.
Arduino IDE carga el firmware; no transporta las lecturas durante el funcionamiento.

1. `initializeApp(firebaseConfig)` configura el SDK. `getAuth` y
   `setPersistence(browserSessionPersistence)` preparan la sesión.
2. `signInWithEmailAndPassword` inicia sesión. `onAuthStateChanged` limpia el
   estado anterior e inicia las suscripciones del usuario autorizado.
3. `getDatabase`, `ref`, `query`, `orderByChild`, `limitToLast` y `onValue`
   escuchan `.info/connected`, `devices/esp32-01/current`, `samples` y `events`.
4. `current` actualiza indicadores al llegar un reporte. `samples` descarga como
   máximo 1000 registros ordenados por `timestamp`; `events`, 200 por `startedAt`.
5. Los filtros operan sobre lo descargado. Un temporizador de cinco segundos
   reevalúa antigüedad y período; no es un sondeo HTTP de Firebase.
6. `signOut` provoca la limpieza. El CSV se crea localmente con `Blob` y no se
   envía a otro servicio. La web no ejecuta escrituras en la base de datos.

El contrato de campos y las instrucciones de permisos están en README.md.

## Verificación realizada

`npm test`: 13 pruebas aprobadas, cero fallidas. Nueve comprueban el modelo y
cuatro ejecutan el código de la app con DOM y SDK simulados. Cubren:

- Inicio sin datos ficticios; lectura válida, alarma y actuadores reportados.
- Gráfica de un punto, cambio de sensor y exportación CSV.
- Validación numérica, límites ADC, fechas, orden y motivos de episodios.
- Episodios que se solapan con el período, incluidos los activos.
- Desconexión, denegación de permisos, datos inválidos y cierre de sesión.
- Escape de comillas y comas en CSV y representación de episodios en curso.

También se verificó sintaxis de los módulos; las cinco rutas públicas locales
respondieron HTTP 200 y cuatro rutas no permitidas respondieron 403. En el
navegador se comprobó el inicio vacío, el diálogo de acceso y el diseño a 390 px
sin desbordamiento horizontal de la página. La consola no mostró errores durante
esa revisión. Estas comprobaciones no introducen datos falsos en Firebase.

## Límites y pendiente real

No se ha probado en esta revisión un inicio de sesión real ni una lectura enviada
por el circuito. Faltan confirmar usuarios, UID y publicación de reglas en el
proyecto Firebase. Las pruebas simuladas no certifican esa integración ni permiten
prometer ausencia absoluta de errores.

Las 1000 muestras a 30 segundos cubren unas 8 h 20 min; elegir 24 horas no descarga
mágicamente el día completo. Los 200 eventos tampoco son todo el historial.
La gráfica conserva máximos entre muestras solo si quedaron registrados; la tabla
presenta los máximos de cada episodio que envía el ESP32. No hay SMS, correo,
notificaciones con el navegador cerrado ni control remoto de bombas.

El repositorio permanece privado. Guardar estos cambios en GitHub no publica
automáticamente un sitio. GitHub Pages para un repositorio privado necesita un
plan compatible; aquí no se ha desplegado la web. El informe técnico anterior
es una fotografía del 14 de octubre y sus números de línea cambiaron.

Referencia oficial: https://firebase.google.com/docs/database/rtdb-vs-firestore
