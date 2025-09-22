# Corrección de URLs de Artefactos en Webhooks

## Problema Identificado

El workflow `deploy-monorepo.yml` estaba enviando URLs inválidas de artefactos al webhook, causando errores 404 al intentar descargar los artefactos.

### URL Problemática (Anterior)
```
https://github.com/{repository}/actions/runs/{run_id}/artifacts/{artifact_name}
```

**Problema**: Los artefactos de GitHub Actions no son accesibles públicamente a través de URLs directas.

## Solución Implementada

### Cambios en el Workflow

1. **Agregado ID al step de upload-artifact**:
   ```yaml
   - name: Subir artefacto
     uses: actions/upload-artifact@v4
     id: upload-artifact  # ← NUEVO
   ```

2. **Modificado el payload del webhook**:
   ```yaml
   PAYLOAD=$(cat <<EOF
   {
     "environment": "${{ needs.detect-changes.outputs.deploy-env }}",
     "artifact_name": "frontend-${{ needs.detect-changes.outputs.deploy-env }}-${{ github.sha }}",
     "artifact_id": "${{ steps.upload-artifact.outputs.artifact-id }}",
     "repository": "${{ github.repository }}",
     "run_id": "${{ github.run_id }}",
     "github_token_required": true,
     "token": "${{ secrets.DEPLOY_SECRET_TOKEN }}"
   }
   EOF
   )
   ```

### Estructura del Nuevo Payload

| Campo | Descripción | Ejemplo |
|-------|-------------|---------|
| `environment` | Entorno de despliegue | `"prd"` o `"tst"` |
| `artifact_name` | Nombre del artefacto | `"frontend-prd-abc123"` |
| `artifact_id` | ID único del artefacto | `"12345678"` |
| `repository` | Repositorio completo | `"owner/repo-name"` |
| `run_id` | ID de la ejecución | `"987654321"` |
| `github_token_required` | Indica que se necesita token | `true` |
| `token` | Token de autenticación del webhook | `"secret-token"` |

## Configuración Requerida en el Webhook

### 1. Token de GitHub

El webhook necesita un token de GitHub con permisos de lectura para acceder a los artefactos:

```bash
# Crear token con permisos:
# - repo (para repositorios privados)
# - actions:read (para leer artefactos)
```

### 2. Descarga de Artefactos

El webhook debe usar la API de GitHub para descargar artefactos:

```bash
# Paso 1: Obtener información del artefacto
curl -H "Authorization: token ${GITHUB_TOKEN}" \
     -H "Accept: application/vnd.github+json" \
     "https://api.github.com/repos/${repository}/actions/artifacts/${artifact_id}"

# Paso 2: Descargar el artefacto
curl -L -H "Authorization: token ${GITHUB_TOKEN}" \
     -H "Accept: application/vnd.github+json" \
     "https://api.github.com/repos/${repository}/actions/artifacts/${artifact_id}/zip" \
     -o artifact.zip
```

### 3. Ejemplo de Implementación en el Webhook

```javascript
// Ejemplo en Node.js
async function downloadArtifact(payload) {
  const { artifact_id, repository } = payload;
  const token = process.env.GITHUB_TOKEN;
  
  // Obtener URL de descarga
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/artifacts/${artifact_id}/zip`,
    {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json'
      },
      redirect: 'manual'
    }
  );
  
  // La URL real está en el header Location
  const downloadUrl = response.headers.get('location');
  
  // Descargar el archivo
  const artifactResponse = await fetch(downloadUrl);
  const artifactBuffer = await artifactResponse.buffer();
  
  return artifactBuffer;
}
```

### 4. Manejo de URLs Temporales

⚠️ **Importante**: Las URLs de descarga de GitHub son temporales (duran ~1 minuto).

```javascript
// Descargar inmediatamente después de obtener la URL
const downloadUrl = response.headers.get('location');
const artifactData = await fetch(downloadUrl); // ← Hacer inmediatamente
```

## Verificación del Cambio

### Antes (Problemático)
```json
{
  "environment": "prd",
  "artifact_url": "https://github.com/owner/repo/actions/runs/123/artifacts/frontend-prd-abc",
  "token": "secret"
}
```

### Después (Correcto)
```json
{
  "environment": "prd",
  "artifact_name": "frontend-prd-abc123",
  "artifact_id": "12345678",
  "repository": "owner/repo-name",
  "run_id": "987654321",
  "github_token_required": true,
  "token": "secret"
}
```

## Secretos Requeridos

Asegúrate de que estos secretos estén configurados en GitHub:

```
DEPLOY_WEBHOOK_URL    # URL del webhook
DEPLOY_SECRET_TOKEN   # Token de autenticación del webhook
```

Y en el servidor webhook:

```
GITHUB_TOKEN          # Token de GitHub con permisos actions:read
```

## Referencias

- [GitHub Actions Artifacts API](https://docs.github.com/en/rest/actions/artifacts)
- [Upload Artifact Action v4](https://github.com/actions/upload-artifact)
- [Download Artifact Action v4](https://github.com/actions/download-artifact)