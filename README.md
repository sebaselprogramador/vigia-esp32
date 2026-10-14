# Vigía — monitor ESP32

Web adaptable a móvil, tablet y computadora, preparada para GitHub Pages.
HTML, CSS y JavaScript sin instalación de paquetes ni compilación.
Se creó en una carpeta independiente para no alterar el prototipo SmartCampus.

## Qué funciona ahora

- Demostración con lecturas simuladas, dos episodios históricos y simulación de alerta.
- Indicadores de temperatura, MQ-7, buzzer y ambas bombas.
- Gráfica por sensor con umbral, filtros de 1/6/24 horas y pico del período.
- Historial de episodios con máximos, inicio/fin y descarga CSV.
- Conector de solo lectura a Firebase Realtime Database y sesión por correo/contraseña.
- Si no llega una lectura reciente en 15 segundos, muestra estado desconocido.

**El envío se realiza por USB a través de la computadora, sin Wi-Fi en el ESP32.**
El puente en `bridge/` entiende la salida del sketch compartido, envía lecturas
y guarda muestras/episodios en Firebase. Consulta `bridge/README.md` o descarga
`vigia-puente-usb.zip` del repositorio. El monitor serie de Arduino IDE debe estar
cerrado mientras se ejecuta el puente. La web no genera historial por las visitas.
La configuración pública de Firebase ya está incorporada; faltan Authentication,
los UID y reglas del proyecto para probar el circuito real.
Las alarmas aparecen en el panel; no hay SMS, correo ni notificaciones con el navegador cerrado.

## Ver la web localmente

Con Node.js, desde esta carpeta:

```powershell
npm start
```

Abre http://127.0.0.1:4173. No abras index.html mediante file:// porque usa módulos.
Para verificar el procesamiento de datos: `npm test`.
La dirección local es solo para esta computadora. Para otros dispositivos usa GitHub Pages.

## Crear Firebase

1. En https://console.firebase.google.com crea un proyecto.
2. Añade una aplicación web y copia su objeto `firebaseConfig` a `config.js`.
3. Crea **Realtime Database**, no Firestore. Copia su URL exacta a `databaseURL`.
4. En Authentication > Sign-in method activa correo/contraseña.
5. En Authentication > Users crea dos usuarios separados: uno para el puente USB y
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

## Contrato de datos usado por el puente USB

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

El puente envía también una muestra en cada cambio de alarma para registrar transiciones.
Los máximos de los episodios se calculan con las lecturas por USB de 1 segundo,
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
El envío de red ocurre en la computadora, fuera del control local del ESP32.
El puente guarda una cola SQLite durante cortes de Internet. No puede recuperar
lecturas durante períodos en que el USB está desconectado o el puente está cerrado.

## Historial y límites

La web escucha `current`, las últimas 1000 muestras ordenadas por `timestamp`
y los últimos 200 eventos ordenados por `startedAt`. Filtra esos resultados
por el período seleccionado; no descarga todo el historial. Si cada muestra
se guarda cada 30 segundos, 1000 cubren unas 8 horas: el filtro de 24 horas
mostrará solo lo disponible. Para 24 horas completas usa al menos 2880 muestras
y ajusta la consulta, o implementa consultas por fecha/paginación.
El CSV exporta los episodios cargados del período, con timestamp Unix en ms.
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
Los datos de demostración no se escriben en Firebase. Si la conexión real falla,
la web conserva una advertencia y no sustituye lecturas reales por simuladas.

## Referencias

- Firebase web: https://firebase.google.com/docs/web/setup
- Lecturas en tiempo real: https://firebase.google.com/docs/database/web/read-and-write
- Historial: https://firebase.google.com/docs/database/web/lists-of-data
- Autenticación: https://firebase.google.com/docs/auth/web/password-auth
- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
