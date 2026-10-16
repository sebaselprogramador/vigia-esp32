# Vigía — monitor ESP32

Web adaptable a móvil, tablet y computadora, preparada para GitHub Pages.
HTML, CSS y JavaScript sin instalación de paquetes ni compilación.
Se creó en una carpeta independiente para no alterar el prototipo SmartCampus.

## Qué funciona ahora

- Solo lecturas reales de Firebase; sin datos inventados ni botones de simulación.
- Indicadores de temperatura y MQ-7.
- Gráfica por sensor con umbral, filtros de 1/6/24 horas y pico del período.
- Historial de episodios con máximos, inicio/fin .
- Conector de solo lectura a Firebase Realtime Database y sesión por correo/contraseña.
- Si no llega una lectura reciente en 15 segundos, muestra estado desconocido.
- Aviso sonoro opcional con sirena y botón para silenciar el episodio actual.

**El envío actual es directo: ESP32 -> Wi-Fi -> Firebase -> web.**
El firmware está en `firmware/`; en GitHub descarga `vigia-esp32-wifi.zip` y lee
su README. Arduino IDE carga el sketch; después el ESP32 funciona por su cuenta,
alimentado por USB u otra fuente adecuada. No necesita el puente Python ni una
computadora encendida. El monitor serie puede permanecer abierto para diagnóstico.
El puente `vigia-puente-usb.zip` queda como alternativa anterior, no se requiere.
El paquete Wi-Fi incorpora la calibración LM35 del usuario: promedio de 50
lecturas en milivoltios, separadas por 5 ms, y `(promedio_mV - 78.05) / 8.627`.
Lee el README del firmware para el intervalo de adquisición y sus límites.
La configuración pública de Firebase ya está incorporada; faltan Authentication,
los UID y reglas del proyecto para probar el circuito real.
Las alarmas aparecen en el panel; no hay SMS, correo ni notificaciones con el navegador cerrado.

## Ver la web localmente

Con Node.js, desde esta carpeta:

```powershell
npm start
```

Abre http://127.0.0.1:4173. No abras index.html mediante file:// porque usa módulos.
Para verificar datos y comportamiento de la app: `npm test` (15 pruebas sin dependencias).
Las pruebas usan módulos VM de Node con una bandera experimental; esa bandera no
se utiliza en la web publicada. Firebase se simula únicamente dentro de las pruebas.
La dirección local es solo para esta computadora. Para otros dispositivos usa GitHub Pages.

## Crear Firebase

1. En https://console.firebase.google.com crea un proyecto.
2. Añade una aplicación web y copia su objeto `firebaseConfig` a `config.js`.
3. Crea **Realtime Database**, no Firestore. Copia su URL exacta a `databaseURL`.
4. En Authentication > Sign-in method activa correo/contraseña.
5. En Authentication > Users crea dos usuarios separados: uno para el ESP32 y
   otro para el visor web. Usa contraseñas distintas. Anota sus UID.
6. En `database.rules.json`, sustituye `REEMPLAZAR_UID_ESP32` y
   `REEMPLAZAR_UID_VISOR`. Publica esas reglas en Realtime Database > Rules.
   No uses reglas de escritura pública. Si cambias el ID del dispositivo,
   cámbialo tanto en las reglas como en `config.js` y el firmware.
7. En Authentication > Settings > Authorized domains agrega el dominio de
   tu publicación, por ejemplo `tuusuario.github.io`.
8. En la web pulsa Conectar Firebase e inicia sesión con el usuario visor.
   La sesión se limita a la sesión del navegador; en un nuevo dispositivo
   también debes iniciar sesión.

La configuración web de Firebase es pública. Nunca subas las contraseñas del
ESP32, el Wi-Fi o claves de cuentas de servicio al repositorio. El usuario visor
puede leer solo este dispositivo y no puede escribir. Las reglas son la barrera
de acceso; ocultar botones no proporciona seguridad.

## Aviso sonoro en la web

Pulsa **Activar y probar sonido** en cada página abierta: reproduce un tono breve
para comprobar volumen y autoriza el audio del navegador. Luego, una alarma
`current.alarm === true` válida, conectada y reciente inicia una sirena continua
de tono variable mediante Web Audio API, sin archivos de audio ni dependencias.
La sirena se detiene con un reporte reciente sin alarma, al cerrar sesión, al
desactivar el sonido o al pulsar **Silenciar esta alerta**. Este último botón solo
silencia el episodio actual; tras un reporte sin alarma, la siguiente vuelve a sonar.
Si se pierde la conexión durante una alarma, el aviso queda activo hasta una de
esas acciones: perder lecturas no confirma que el peligro haya terminado. El título
de la pestaña también indica ALERTA. No se modifica el buzzer ni las bombas del ESP32.

El volumen del dispositivo debe estar audible. Recargar exige activar el sonido
de nuevo. Con la página cerrada, el navegador suspendido o la pantalla bloqueada
no se garantiza aviso; no se han implementado notificaciones push. Si se interrumpe
el audio, la interfaz lo avisa y pide desactivarlo/activarlo de nuevo. Las llamadas
o el ahorro de energía pueden afectar audio y conexión, según el dispositivo.

Las tres pruebas añadidas el 16 de octubre cubren activación, silenciamiento por
episodio, nueva alerta, desconexión, datos antiguos/inválidos, cierre de sesión,
desactivación y bloqueo de audio. En navegador se verificó el control de activación
y el estado de audio sin errores de consola; no se mide acústicamente el volumen.
Referencia: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices

## Contrato de datos usado por el firmware Wi-Fi

Ruta base: `devices/esp32-01`. Números JSON, no cadenas. Horas Unix en
**milisegundos**. Sincroniza el reloj o usa timestamp de servidor de Firebase.

`current`, sobrescrito aproximadamente cada segundo:

```json
{
  "temperatureC": 28.4,
  "gasRaw": 930,
  "timestamp": 1792000000000,
  "alarm": false,
  "buzzer": false,
  "pump1": false,
  "pump2": false
}
```

`samples/<id-unico>`, una muestra nueva aproximadamente cada 30 segundos:

```json
{ "temperatureC": 28.4, "gasRaw": 930, "timestamp": 1792000000000 }
```

`events/<id-del-episodio>`, creado al empezar una alarma y actualizado mientras
dure para conservar ambos máximos. `reason` es `gas`, `temperature` o `both`.
Si aparece el segundo motivo durante el episodio, cambia a `both`.
Al finalizar, añade `endedAt`; mientras está activo, omítelo o usa `null`.

```json
{
  "startedAt": 1792000000000,
  "endedAt": 1792000060000,
  "reason": "both",
  "peakTemperatureC": 51.2,
  "peakGasRaw": 2850
}
```

El ESP32 envía también una muestra en cada cambio de alarma para registrar transiciones.
Los máximos de los episodios se calculan con las lecturas locales de 1 segundo,
no solo con las muestras históricas de 30 segundos. La gráfica puede perder
picos entre muestras; la tabla conserva el máximo que reportó el dispositivo.
Las muestras tienen solo tres campos; las reglas rechazan otros campos.

Tu lógica actual activa alarma, buzzer y ambas bombas con:

```cpp
gasRaw >= 2200 || temperatureC >= 47.5
```

La web conserva los umbrales del código recibido. Si cambias umbrales en Arduino,
cambia también `model.js` y las etiquetas de `index.html`. Los estados de bombas
son reportes de salida del ESP32; no hay sensor de confirmación de flujo.
El envío de red ocurre en otra tarea del ESP32, fuera del ciclo de control local.
Hay una cola RAM limitada de 64 muestras y 16 episodios terminados; se pierde al
reiniciar. Al llenarse, omite nuevas entradas y avisa por serie. Lee los límites
del firmware antes de asumir conservación completa durante cortes de red o energía.

## Historial y límites

La web escucha `current`, las últimas 1000 muestras ordenadas por `timestamp`
y los últimos 200 eventos ordenados por `startedAt`. Filtra esos resultados
por el período seleccionado; no descarga todo el historial. Si cada muestra
se guarda cada 30 segundos, 1000 cubren unas 8 horas: el filtro de 24 horas
mostrará solo lo disponible. Para 24 horas completas usa al menos 2880 muestras
y ajusta la consulta, o implementa consultas por fecha/paginación.
El filtro incluye episodios que se solapan con el período, aunque empezaran antes.
Los episodios muestran los datos cargados del período.
No hay borrado automático: la retención debe planificarse en Firebase.

## Publicar en GitHub Pages

1. Crea un repositorio nuevo para este proyecto.
2. Sube **el contenido** de esta carpeta a la raíz del repositorio. No subas
   todo SmartCampus. No añadas contraseñas ni archivos locales del firmware.
3. En Settings > Pages elige Deploy from a branch, `main` y `/(root)`; guarda.
4. Cuando GitHub termine la publicación, abre:
   `https://TU_USUARIO.github.io/TU_REPOSITORIO/`.
5. Esa misma dirección funciona en móviles, tablets y computadoras con
   Internet y un navegador moderno. No requiere instalar una aplicación.

Repositorio privado: https://github.com/sebaselprogramador/vigia-esp32.
GitHub Pages desde un repositorio privado requiere un plan compatible (por
ejemplo GitHub Pro). El sitio publicado suele ser público aunque el repositorio
sea privado. No se ha publicado la web todavía.
Si la conexión falla, la web muestra una advertencia y conserva el último reporte
como dato antiguo; nunca inventa lecturas. Al cerrar sesión borra los datos visibles.

## Revisión de simplificación

Consulta `REVISION_WEB.md` para los cambios, tecnologías, pruebas y límites de la
revisión del 15 de octubre de 2026. El informe técnico anterior corresponde a su
versión del 14 de octubre; sus números de línea no describen esta revisión.

## Referencias

- Firebase web: https://firebase.google.com/docs/web/setup
- Lecturas en tiempo real: https://firebase.google.com/docs/database/web/read-and-write
- Historial: https://firebase.google.com/docs/database/web/lists-of-data
- Autenticación: https://firebase.google.com/docs/auth/web/password-auth
- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site

Actualización del 16 de octubre: retirados la tarjeta de buzzer/bombas y el CSV
a petición del usuario. El control de salidas continúa en el firmware; el historial
y la sirena web se conservan. REVISION_WEB.md describe una versión anterior.
