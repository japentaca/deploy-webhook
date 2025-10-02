import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pm2 from 'pm2';

// Configuración de ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar variables de entorno
dotenv.config();



// Función para validar variables de entorno requeridas
function validateEnvironmentVariables() {
    const requiredVars = [
        'DEPLOY_SECRET_TOKEN',
        'DEPLOY_SERVER_PORT',
        'GITHUB_ACCESS_TOKEN',
        'DEPLOY_BACKEND_PATH_TST',
        'DEPLOY_BACKEND_PATH_PRD',
        'DEPLOY_FRONTEND_PATH_TST',
        'DEPLOY_FRONTEND_PATH_PRD'
    ];

    const missingVars = [];

    for (const varName of requiredVars) {
        if (!process.env[varName] || process.env[varName].trim() === '') {
            missingVars.push(varName);
        }
    }

    if (missingVars.length > 0) {
        console.error('Error: Las siguientes variables de entorno son requeridas pero no están definidas:');
        missingVars.forEach(varName => {
            console.error(`  - ${varName}`);
        });
        console.error('\nPor favor, define estas variables en tu archivo .env antes de ejecutar el script.');
        process.exit(1);
    }

    console.log('Validación de variables de entorno completada exitosamente.');
}

// Validar variables de entorno al inicio
validateEnvironmentVariables();

const execAsync = promisify(exec);
const app = express();

// Middleware para parsear JSON
app.use(express.json());

// Configuración del puerto
const PORT = process.env.DEPLOY_SERVER_PORT || 3001;

// Función para validar el token de seguridad
function validateToken(token) {
    return token === process.env.DEPLOY_SECRET_TOKEN;
}

// Función para descargar y extraer artefactos usando artifact_id
async function downloadAndExtractArtifact(artifactId, repository, destinationPath) {
    try {
        console.log(`Procesando descarga de artefacto ID: ${artifactId} del repositorio: ${repository}`);

        // Preparar cabeceras de autenticación para GitHub
        const headers = {};
        const githubToken = process.env.GITHUB_ACCESS_TOKEN;

        if (!githubToken) {
            throw new Error('GITHUB_ACCESS_TOKEN es requerido para descargar artefactos. Configura esta variable en tu archivo .env');
        }

        headers['Authorization'] = `token ${githubToken}`;
        headers['Accept'] = 'application/vnd.github+json';
        console.log('Usando autenticación con GitHub token para descargar artefacto');

        // Construir URL de la API para obtener información del artefacto
        const artifactApiUrl = `https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}`;
        console.log(`Obteniendo información del artefacto desde: ${artifactApiUrl}`);

        // Obtener información del artefacto
        const artifactResponse = await fetch(artifactApiUrl, { headers });

        if (!artifactResponse.ok) {
            if (artifactResponse.status === 401 || artifactResponse.status === 403) {
                throw new Error(`Error de autenticación al acceder a la API de GitHub: ${artifactResponse.statusText}. Verifica que GITHUB_ACCESS_TOKEN tenga permisos para acceder a artefactos.`);
            }
            if (artifactResponse.status === 404) {
                throw new Error(`Artefacto no encontrado (404). Verifica que el artifact_id ${artifactId} sea correcto y que el artefacto aún exista.`);
            }
            throw new Error(`Error al acceder a la API de GitHub: ${artifactResponse.statusText}`);
        }

        const artifactInfo = await artifactResponse.json();
        console.log(`Artefacto encontrado: ${artifactInfo.name} (ID: ${artifactInfo.id})`);

        // Obtener URL de descarga del artefacto
        const downloadApiUrl = `https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}/zip`;
        console.log(`Descargando artefacto desde: ${downloadApiUrl}`);

        const downloadResponse = await fetch(downloadApiUrl, {
            headers,
            redirect: 'manual' // GitHub devuelve un redirect con la URL temporal
        });

        if (!downloadResponse.ok && downloadResponse.status !== 302) {
            if (downloadResponse.status === 401 || downloadResponse.status === 403) {
                throw new Error(`Error de autenticación al descargar artefacto: ${downloadResponse.statusText}. Verifica que GITHUB_ACCESS_TOKEN esté configurado correctamente.`);
            }
            throw new Error(`Error al descargar artefacto: ${downloadResponse.status} ${downloadResponse.statusText}`);
        }

        // Obtener la URL temporal de descarga del header Location
        const downloadUrl = downloadResponse.headers.get('location');
        if (!downloadUrl) {
            throw new Error('No se pudo obtener la URL de descarga temporal del artefacto');
        }

        console.log('Descargando artefacto desde URL temporal...');

        // Descargar el artefacto usando la URL temporal
        const response = await fetch(downloadUrl);

        if (!response.ok) {
            throw new Error(`Error al descargar artefacto desde URL temporal: ${response.status} ${response.statusText}`);
        }

        // Crear directorio temporal
        const tempDir = path.join(__dirname, 'temp');
        await fs.mkdir(tempDir, { recursive: true });

        const tempFile = path.join(tempDir, 'artifact.zip');

        // Guardar el archivo
        const buffer = await response.buffer();
        await fs.writeFile(tempFile, buffer);

        console.log(`Artefacto descargado, tamaño: ${buffer.length} bytes`);
        console.log(`Archivo temporal guardado en: ${tempFile}`);

        // Verificar que el archivo se guardó correctamente
        const stats = await fs.stat(tempFile);
        console.log(`Verificación del archivo: tamaño en disco ${stats.size} bytes`);

        if (stats.size === 0) {
            throw new Error('El archivo descargado está vacío');
        }

        // Verificar que es un archivo ZIP válido leyendo los primeros bytes
        const fileHeader = await fs.readFile(tempFile, { start: 0, end: 3 });
        const zipSignature = fileHeader.toString('hex');
        //console.log(`Signatura del archivo: ${zipSignature}`);

        // Verificar signatura ZIP (PK\x03\x04 = 504b0304 en hex)
        if (!zipSignature.startsWith('504b')) {
            console.error('El archivo descargado no parece ser un ZIP válido');
            console.error('Signatura encontrada:', zipSignature);
            throw new Error('El archivo descargado no es un ZIP válido');
        }

        // Crear directorio de destino si no existe
        await fs.mkdir(destinationPath, { recursive: true });
        console.log(`Directorio de destino preparado: ${destinationPath}`);

        // Extraer el archivo con mejor manejo de errores
        console.log('Iniciando extracción del archivo ZIP...');
        try {
            const { stdout, stderr } = await execAsync(`unzip -o "${tempFile}" -d "${destinationPath}"`);
            console.log('Extracción completada exitosamente');
            if (stderr) {
                console.warn('Advertencias durante la extracción');
            }
        } catch (unzipError) {
            console.error('Error durante la extracción:', unzipError.message);

            // Intentar obtener información básica del ZIP para diagnóstico
            try {
                const { stdout: listOutput } = await execAsync(`unzip -l "${tempFile}"`);
                const fileCount = (listOutput.match(/\n/g) || []).length - 3; // Aproximar número de archivos
                console.log(`El archivo ZIP contiene aproximadamente ${fileCount} archivos`);
            } catch (listError) {
                console.error('No se pudo obtener información del ZIP');
            }

            throw new Error(`Error al extraer el archivo ZIP: ${unzipError.message}`);
        }

        // Verificar que se extrajeron archivos
        const extractedFiles = await fs.readdir(destinationPath);
        console.log(`Archivos extraídos (${extractedFiles.length}):`, extractedFiles.map(f => f.path || f.name || f));

        if (extractedFiles.length === 0) {
            throw new Error('No se extrajeron archivos del ZIP');
        }

        // Limpiar archivo temporal
        await fs.unlink(tempFile);
        await fs.rmdir(tempDir);

        console.log(`Artefacto extraído exitosamente en: ${destinationPath}`);
        return true;
    } catch (error) {
        console.error('Error al descargar y extraer artefacto:', error.message);
        throw error;
    }
}

// Función para clonar repositorio y configurar backend
async function deployBackend(environment, projectUrl, branch) {
    try {
        // Validar que la rama esté especificada
        if (!branch || typeof branch !== 'string' || branch.trim() === '') {
            throw new Error('La rama debe estar especificada y no puede estar vacía');
        }

        const deployPath = environment === 'tst'
            ? process.env.DEPLOY_BACKEND_PATH_TST
            : process.env.DEPLOY_BACKEND_PATH_PRD;

        if (!deployPath) {
            throw new Error(`Variable de entorno DEPLOY_BACKEND_PATH_${environment.toUpperCase()} no configurada`);
        }

        console.log(`Desplegando backend en ambiente: ${environment}`);
        console.log(`Ruta de despliegue: ${deployPath}`);
        console.log(`Rama a desplegar: ${branch}`);

        // Crear directorio temporal para clonar el monorepo
        const tempDir = path.join(os.tmpdir(), `deploy-${Date.now()}`);

        // Crear directorio padre del destino si no existe
        const parentDir = path.dirname(deployPath);
        await fs.mkdir(parentDir, { recursive: true });

        // Respaldar archivo .env si existe
        const envPath = path.join(deployPath, '.env');
        let envBackup = null;
        try {
            envBackup = await fs.readFile(envPath, 'utf8');
            console.log('Archivo .env respaldado');
        } catch (error) {
            console.log('No se encontró archivo .env para respaldar');
        }

        try {
            // Preparar URL con token para repositorios privados
            const githubToken = process.env.GITHUB_ACCESS_TOKEN;
            let cloneUrl = projectUrl;

            if (githubToken && projectUrl.includes('github.com')) {
                // Convertir URL de GitHub para usar token de acceso
                // De: https://github.com/usuario/repo.git
                // A: https://token@github.com/usuario/repo.git
                cloneUrl = projectUrl.replace('https://github.com/', `https://${githubToken}@github.com/`);
                console.log('Usando GitHub token para clonar repositorio privado');
            }

            // Clonar monorepo en directorio temporal con la rama específica
            console.log(`Clonando monorepo en directorio temporal: ${tempDir}`);
            console.log(`Clonando rama: ${branch}`);
            await execAsync(`git clone --branch ${branch} --single-branch ${cloneUrl} "${tempDir}"`);

            // Verificar la rama clonada
            const { stdout: currentBranch } = await execAsync(`git -C "${tempDir}" rev-parse --abbrev-ref HEAD`);
            const actualBranch = currentBranch.trim();
            console.log(`Rama clonada confirmada: ${actualBranch}`);
            
            if (actualBranch !== branch) {
                throw new Error(`Error: Se esperaba clonar la rama '${branch}' pero se clonó '${actualBranch}'`);
            }

            // Obtener información del commit actual
            const { stdout: commitInfo } = await execAsync(`git -C "${tempDir}" log -1 --pretty=format:"%H %s %an %ad" --date=short`);
            console.log(`Commit desplegado: ${commitInfo.trim()}`);

            // Obtener hash del commit para el log
            const { stdout: commitHash } = await execAsync(`git -C "${tempDir}" rev-parse HEAD`);
            const deploymentInfo = {
                timestamp: new Date().toISOString(),
                environment: environment,
                branch: actualBranch,
                commit: commitHash.trim(),
                commitMessage: commitInfo.trim(),
                projectUrl: projectUrl
            };

            // Verificar que existe la carpeta backend en el monorepo
            const backendSourcePath = path.join(tempDir, 'backend');
            try {
                await fs.access(backendSourcePath);
            } catch (error) {
                throw new Error('No se encontró la carpeta backend en el monorepo clonado');
            }

            // Eliminar directorio de destino existente si existe
            try {
                await fs.rm(deployPath, { recursive: true, force: true });
            } catch (error) {
                console.log('Directorio de destino no existía previamente');
            }

            // Copiar solo la carpeta backend del monorepo al destino
            console.log(`Copiando carpeta backend desde ${backendSourcePath} a ${deployPath}`);
            await fs.cp(backendSourcePath, deployPath, { recursive: true });

            // Cambiar al directorio del backend desplegado
            process.chdir(deployPath);

            // Restaurar archivo .env si existía
            if (envBackup) {
                await fs.writeFile(envPath, envBackup);
                console.log('Archivo .env restaurado');
            }

            // Instalar dependencias
            console.log('Instalando dependencias...');
            await execAsync('npm ci');

            // Crear archivo de log del despliegue
            const deployLogPath = path.join(deployPath, 'deployment.log');
            const logEntry = `${deploymentInfo.timestamp} - Despliegue exitoso\n` +
                           `Ambiente: ${deploymentInfo.environment}\n` +
                           `Rama: ${deploymentInfo.branch}\n` +
                           `Commit: ${deploymentInfo.commit}\n` +
                           `Mensaje: ${deploymentInfo.commitMessage}\n` +
                           `URL: ${deploymentInfo.projectUrl}\n` +
                           `---\n`;
            
            try {
                await fs.appendFile(deployLogPath, logEntry);
                console.log(`Log de despliegue actualizado: ${deployLogPath}`);
            } catch (error) {
                console.warn('Error escribiendo log de despliegue:', error.message);
            }

            // Reiniciar proceso con PM2
            const processName = environment === 'tst' ? 'tst_backend' : 'prd_backend';

            const pm2Result = await new Promise((resolve, reject) => {
                pm2.connect((err) => {
                    if (err) {
                        console.error('Error conectando a PM2:', err.message);
                        reject(err);
                        return;
                    }

                    pm2.restart(processName, (err) => {
                        pm2.disconnect();

                        if (err) {
                            console.error(`Error reiniciando proceso ${processName}:`, err.message);
                            reject(err);
                        } else {
                            console.log(`Proceso ${processName} reiniciado exitosamente`);
                            resolve(true);
                        }
                    });
                });
            });

            return pm2Result;

        } finally {
            // Limpiar directorio temporal
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
                console.log('Directorio temporal limpiado');
            } catch (error) {
                console.warn('Error limpiando directorio temporal:', error.message);
            }
        }

    } catch (error) {
        console.error('Error en despliegue de backend:', error.message);
        throw error;
    }
}

// Ruta para despliegue de frontend
app.post('/frontend', async (req, res) => {
    try {
        const {
            environment,
            artifact_name,
            artifact_id,
            repository,
            run_id,
            github_token_required,
            token
        } = req.body;

        // Validar token
        if (!validateToken(token)) {
            return res.status(401).json({ error: 'Token de autorización inválido' });
        }

        // Validar parámetros requeridos
        if (!environment || !artifact_id || !repository) {
            return res.status(400).json({
                error: 'Parámetros environment, artifact_id y repository son requeridos'
            });
        }

        // Validar ambiente
        if (!['tst', 'prd'].includes(environment)) {
            return res.status(400).json({ error: 'Environment debe ser "tst" o "prd"' });
        }

        // Validar que se requiere token de GitHub
        if (github_token_required !== true) {
            return res.status(400).json({
                error: 'github_token_required debe ser true para este tipo de despliegue'
            });
        }

        // Obtener ruta de despliegue
        const deployPath = environment === 'tst'
            ? process.env.DEPLOY_FRONTEND_PATH_TST
            : process.env.DEPLOY_FRONTEND_PATH_PRD;

        if (!deployPath) {
            return res.status(500).json({
                error: `Variable de entorno DEPLOY_FRONTEND_PATH_${environment.toUpperCase()} no configurada`
            });
        }

        console.log(`Iniciando despliegue de frontend para ambiente: ${environment}`);
        console.log(`Artefacto: ${artifact_name} (ID: ${artifact_id})`);
        console.log(`Repositorio: ${repository}`);
        console.log(`Run ID: ${run_id}`);

        // Descargar y extraer artefacto usando el nuevo formato
        await downloadAndExtractArtifact(artifact_id, repository, deployPath);

        res.json({
            success: true,
            message: `Frontend desplegado exitosamente en ambiente ${environment}`,
            path: deployPath,
            artifact_name: artifact_name,
            artifact_id: artifact_id,
            repository: repository,
            run_id: run_id
        });

    } catch (error) {
        console.error('Error en despliegue de frontend:', error.message);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Ruta para despliegue de backend
app.post('/backend', async (req, res) => {
    try {
        const { environment, project_url, token, branch } = req.body;

        // Validar token
        if (!validateToken(token)) {
            return res.status(401).json({ error: 'Token de autorización inválido' });
        }

        // Validar parámetros requeridos
        if (!environment || !project_url || !branch) {
            return res.status(400).json({ 
                error: 'Parámetros environment, project_url y branch son requeridos',
                missing: {
                    environment: !environment,
                    project_url: !project_url,
                    branch: !branch
                }
            });
        }

        // Validar ambiente
        if (!['tst', 'prd'].includes(environment)) {
            return res.status(400).json({ error: 'Environment debe ser "tst" o "prd"' });
        }

        // Validar rama
        if (typeof branch !== 'string' || branch.trim() === '') {
            return res.status(400).json({ error: 'El parámetro branch debe ser una cadena de texto no vacía' });
        }

        const deployBranch = branch.trim();

        console.log(`Iniciando despliegue de backend:`);
        console.log(`- Ambiente: ${environment}`);
        console.log(`- URL del proyecto: ${project_url}`);
        console.log(`- Rama: ${deployBranch}`);

        // Desplegar backend
        await deployBackend(environment, project_url, deployBranch);

        res.json({
            success: true,
            message: `Backend desplegado exitosamente en ambiente ${environment}`,
            branch: deployBranch,
            environment: environment
        });

    } catch (error) {
        console.error('Error en despliegue de backend:', error.message);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Ruta de salud del servicio
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'webhook-deploy-server'
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor webhook de despliegue ejecutándose en puerto ${PORT}`);
    console.log(`Rutas disponibles:`);
    console.log(`  POST /frontend - Despliegue de frontend`);
    console.log(`  POST /backend - Despliegue de backend`);
    console.log(`  GET /health - Estado del servicio`);
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
    console.error('Error no capturado:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promesa rechazada no manejada:', reason?.message || reason);
});