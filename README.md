# Sistema de Despliegue con Webhook

## Descripción General

Este sistema implementa un método de despliegue automatizado basado en webhooks que permite desplegar tanto el frontend como el backend de manera independiente cuando se detectan cambios en las ramas `tst` o `prd`.

## Componentes del Sistema

### 1. Servidor Webhook (webhook.js)

Ubicado en la carpeta raíz del backend, este script Node.js utiliza Express.js y PM2 para gestionar los despliegues automáticos.

**Dependencias:**
- Express.js: Servidor web para recibir las peticiones webhook
- PM2: Gestor de procesos para reiniciar aplicaciones
- node-fetch: Para descargar artefactos desde GitHub

### 2. GitHub Actions Modificadas

Las acciones de GitHub han sido actualizadas para trabajar con el sistema de webhook en lugar de usar SSH directo.

## Variables de Entorno Requeridas

Agregar las siguientes variables al archivo `.env` del backend:

```env
# Configuración del servidor de despliegue
DEPLOY_SERVER_PORT=3001
DEPLOY_SECRET_TOKEN=tu_token_secreto_aqui
GITHUB_ACCESS_TOKEN=tu_token_github_aqui

# Rutas de despliegue para frontend
DEPLOY_FRONTEND_PATH_TST=/ruta/al/frontend/tst
DEPLOY_FRONTEND_PATH_PRD=/ruta/al/frontend/prd

# Rutas de despliegue para backend
DEPLOY_BACKEND_PATH_TST=/ruta/al/backend/tst
DEPLOY_BACKEND_PATH_PRD=/ruta/al/backend/prd
```

## Configuración del GitHub Token (Repositorios Privados)

Para repositorios privados, es necesario configurar un token de acceso personal de GitHub:

### Generar el Token

1. Ve a GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Haz clic en "Generate new token (classic)"
3. Configura el token:
   - **Note**: Descripción del token (ej: "Deploy Webhook Token")
   - **Expiration**: Configura según tus políticas de seguridad
   - **Scopes**: Selecciona `repo` (acceso completo a repositorios privados)
4. Copia el token generado (solo se muestra una vez)

### Configurar el Token

1. Agrega el token al archivo `.env` del backend:
   ```env
   GITHUB_ACCESS_TOKEN=ghp_tu_token_aqui
   ```

2. **Importante**: Nunca commits el token al repositorio. Asegúrate de que el archivo `.env` esté en `.gitignore`

### Funcionamiento

El webhook detecta automáticamente si se proporciona un token de GitHub y lo usa para clonar repositorios privados. Si no se proporciona el token, intentará clonar como repositorio público.

## Secrets de GitHub

Configurar los siguientes secrets en el repositorio de GitHub:

1. **DEPLOY_WEBHOOK_URL**: URL completa del webhook (ej: `http://tu-servidor.com:3001`)
2. **DEPLOY_SECRET_TOKEN**: Token secreto para validar las peticiones (debe coincidir con la variable de entorno)

## Funcionamiento del Sistema

### Despliegue de Frontend

**Trigger:** Cambios detectados en la carpeta `frontend/` en ramas `tst` o `prd`

**Proceso:**
1. GitHub Actions construye el artefacto del frontend
2. Sube el artefacto a GitHub
3. Envía una petición POST al webhook con:
   ```json
   {
     "environment": "tst|prd",
     "artifact_url": "url_del_artefacto",
     "token": "token_secreto"
   }
   ```

**Acciones del Webhook:**
1. Valida el token secreto
2. Procesa la URL del artefacto (si es una URL de API de GitHub, obtiene la URL de descarga real)
3. Descarga el artefacto usando autenticación con GitHub token
4. Extrae y mueve los archivos a la carpeta de destino según el entorno
5. Limpia archivos temporales

**Nota importante sobre artefactos:** El webhook maneja automáticamente las URLs de la API de GitHub (`api.github.com/repos/.../actions/artifacts/...`) obteniendo la URL de descarga real (`archive_download_url`) antes de proceder con la descarga.

### Despliegue de Backend

**Trigger:** Cambios detectados en la carpeta `backend/` en ramas `tst` o `prd`

**Proceso:**
1. GitHub Actions detecta cambios en el backend
2. Envía una petición POST al webhook con:
   ```json
   {
     "environment": "tst|prd",
     "project_url": "url_del_repositorio_github",
     "token": "token_secreto"
   }
   ```

**Acciones del Webhook:**
1. Valida el token secreto
2. Respalda el archivo `.env` existente
3. Clona el monorepo completo en un directorio temporal
4. Copia únicamente la carpeta `backend/` del monorepo al directorio de destino
5. Limpia el directorio temporal
6. Ejecuta `npm ci` para instalar dependencias
7. Restaura el archivo `.env` respaldado
8. Reinicia el proceso PM2 correspondiente (`tst_backend` o `prd_backend`)

## Iniciar el Servidor Webhook

Para iniciar el servidor webhook en producción:

```bash
cd backend
pm2 start webhook.js --name "deploy-webhook"
pm2 save
pm2 startup
```

Para desarrollo:
```bash
cd backend
node webhook.js
```

## Configuración de PM2

Asegúrate de que los procesos del backend estén configurados en PM2:

```bash
# Para ambiente de testing
pm2 start app.js --name "tst_backend" --env development

# Para ambiente de producción
pm2 start app.js --name "prd_backend" --env production
```

## Logs y Monitoreo

### Logs del Webhook
```bash
pm2 logs deploy-webhook
```

### Logs de los Procesos Backend
```bash
pm2 logs tst_backend
pm2 logs prd_backend
```

### Estado de los Procesos
```bash
pm2 status
```

## Seguridad

1. **Token de Validación:** Todas las peticiones deben incluir el token secreto configurado
2. **Validación de Origen:** El webhook valida que las peticiones vengan de GitHub Actions
3. **Preservación de .env:** El archivo `.env` se preserva durante los despliegues del backend
4. **Limpieza Temporal:** Los archivos temporales se eliminan después de cada despliegue

## Troubleshooting

### Problemas Comunes

1. **Error de conexión al webhook:**
   - Verificar que el servidor webhook esté ejecutándose
   - Comprobar la configuración del puerto y firewall
   - Validar la URL del webhook en los secrets de GitHub

2. **Error de token inválido:**
   - Verificar que `DEPLOY_SECRET_TOKEN` coincida en el `.env` y en los secrets de GitHub

3. **Error al descargar artefactos (404 Not Found):**
   - **Causa más común:** La URL del artefacto requiere autenticación con GitHub token
   - **Solución:** Verificar que `GITHUB_ACCESS_TOKEN` esté configurado en el archivo `.env`
   - **Verificar permisos:** El token debe tener permisos de `actions:read` para acceder a artefactos
   - **URL correcta:** El webhook maneja automáticamente URLs de API de GitHub y URLs directas
   - Verificar conectividad a internet del servidor
   - Comprobar permisos de escritura en las carpetas de destino

4. **Error al reiniciar procesos PM2:**
   - Verificar que los procesos estén configurados correctamente en PM2
   - Comprobar que PM2 esté instalado globalmente

### Comandos Útiles

```bash
# Verificar estado del webhook
curl -X POST http://localhost:3001/health

# Reiniciar el webhook
pm2 restart deploy-webhook

# Ver logs en tiempo real
pm2 logs deploy-webhook --lines 50
```

## Ventajas del Nuevo Sistema

1. **Despliegues Independientes:** Frontend y backend se despliegan por separado
2. **Gestión Centralizada:** Un solo punto de control para todos los despliegues
3. **Preservación de Configuración:** Los archivos `.env` se mantienen intactos
4. **Monitoreo Mejorado:** Logs centralizados y estado de procesos visible
5. **Escalabilidad:** Fácil agregar nuevos entornos o modificar el proceso
6. **Seguridad:** Validación de tokens y control de acceso
7. **Eficiencia de Almacenamiento:** Solo se despliegan los archivos necesarios del backend
8. **Limpieza Automática:** Los directorios temporales se eliminan automáticamente
9. **Separación de Responsabilidades:** El directorio de destino contiene solo código del backend

## Migración desde el Sistema Anterior

1. Instalar las nuevas dependencias: `npm install`
2. Configurar las variables de entorno en `.env`
3. Configurar los secrets en GitHub
4. Iniciar el servidor webhook con PM2
5. Las GitHub Actions ya están actualizadas y funcionarán automáticamente