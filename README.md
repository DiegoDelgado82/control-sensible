# Control Sensible

Aplicación mobile first para registrar y consultar productos del Sensible de Electro. Está construida con HTML, CSS y JavaScript, Firebase Authentication, Firestore y Netlify Functions.

## Vistas

- **Administrador:** CRUD de usuarios y productos, importación XLSX, vendedores y Seguridad; acceso a movimientos y anulaciones.
- **Jefe:** dashboard, stock, búsqueda, ingresos, salidas, exhibición, transferencias, service y cambios de estado.
- **Vendedor:** dashboard y búsqueda de productos aptos. No puede crear ni modificar datos.

La aplicación no utiliza fotografías de productos.

## Catálogo de productos

Cada producto utiliza únicamente:

- EAN.
- Descripción.
- Tipo: `celular`, `tablet`, `consola` u `otro`.

Los productos nuevos se crean activos. El stock no se carga desde el catálogo: se calcula exclusivamente mediante movimientos.

### Importación XLSX

El Administrador puede importar hasta 2000 productos desde la primera hoja de un archivo `.xlsx`. La fila 1 debe contener estos encabezados:

```text
EAN | DESCRIPCION | TIPO
```

Los EAN numéricos se convierten a texto antes de enviarse al servidor. Los EAN existentes actualizan descripción y tipo sin modificar sus cantidades; los nuevos se crean con stock cero. Antes de confirmar se muestran la vista previa y los errores del archivo.

### Cámara

El alta manual de productos y los movimientos permiten escanear EAN con la cámara. El lector funciona únicamente sobre HTTPS o localhost, solicita permiso al usuario y no almacena imágenes.

## Experiencia móvil

- La aplicación ocupa el alto disponible del dispositivo y evita el desbordamiento horizontal.
- Las listas extensas se desplazan dentro del área de contenido, manteniendo visibles el encabezado y la navegación.
- Los accesos del inicio abren un movimiento con el tipo bloqueado para evitar cambios accidentales.
- El formulario de movimientos permite agregar rápidamente un vendedor o guardia sin abandonar la operación.
- Los campos EAN tienen mayor tamaño y accesos mediante iconos para cámara y búsqueda.

## Identificación

- Celulares: EAN + IMEI.
- Tablets: solamente EAN.
- Consolas: solamente EAN.
- Otros productos: EAN y número de serie únicamente cuando sea necesario por un estado excepcional.

## Variables de Netlify

Configurar en `Project configuration > Environment variables`:

```text
FIREBASE_PROJECT_ID=analizadorproductos-ca48d
FIREBASE_CLIENT_EMAIL=<client_email de la cuenta de servicio>
FIREBASE_PRIVATE_KEY=<private_key de la cuenta de servicio>
APP_ORIGIN=https://controlsensible.netlify.app
```

`FIREBASE_PRIVATE_KEY` debe marcarse como valor secreto y nunca debe agregarse al repositorio.

## Desarrollo local

Requiere Node.js 20 o superior.

```bash
npm install
npx netlify-cli@latest login
npx netlify-cli@latest link
npx netlify-cli@latest dev
```

Para desarrollo local, crear un archivo `.env` sin subirlo al repositorio:

```text
FIREBASE_PROJECT_ID=analizadorproductos-ca48d
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
APP_ORIGIN=http://localhost:8888
```

## Publicación con GitHub y Netlify

1. Crear un repositorio privado en GitHub.
2. Subir el contenido de esta carpeta a la raíz del repositorio.
3. En Netlify abrir el proyecto `controlsensible`.
4. Ir a `Project configuration > Build & deploy > Continuous deployment`.
5. Elegir `Link repository` y seleccionar el repositorio.
6. Configurar:
   - Build command: dejar vacío.
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
7. Publicar el deploy.

Netlify también leerá estas opciones desde `netlify.toml`.

La carpeta pública contiene únicamente la interfaz. Las funciones protegidas y las dependencias del servidor quedan fuera de la publicación estática.

## Usuario inicial

El Administrador fue creado manualmente en Firebase Authentication con el correo técnico:

```text
administrador@controlsensible.app
```

En Firestore debe existir el documento `usuarios/{UID}` con:

```text
usuario: Administrador
nombre: Administrador del sistema
perfil: administrador
activo: true
cambioClaveObligatorio: true
```

La interfaz convierte automáticamente el usuario `Administrador` al correo técnico utilizado por Firebase.

## Reglas

El archivo `firestore.rules` contiene las reglas de referencia. Las escrituras del navegador permanecen bloqueadas; todas las operaciones protegidas pasan por Netlify Functions y Firebase Admin SDK.

## Comprobación

```bash
npm run check
```

La anulación automática se permite únicamente cuando ningún producto o IMEI afectado tuvo movimientos posteriores. En caso contrario se rechaza para evitar alterar la trazabilidad.
