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

// Función para descargar y extraer artefactos
async function downloadAndExtractArtifact(artifactUrl, destinationPath) {
    try {
        console.log(`Descargando artefacto desde: ${artifactUrl}`);
        
        // Preparar cabeceras de autenticación para GitHub
        const headers = {};
        const githubToken = process.env.GITHUB_ACCESS_TOKEN;
        
        if (githubToken) {
            headers['Authorization'] = `token ${githubToken}`;
            headers['Accept'] = 'application/vnd.github.v3+json';
            console.log('Usando autenticación con GitHub token para descargar artefacto');
        } else {
            console.log('No se encontró GITHUB_ACCESS_TOKEN, intentando descarga sin autenticación');
        }
        
        // Descargar el artefacto
        const response = await fetch(artifactUrl, { headers });
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new Error(`Error de autenticación al descargar artefacto: ${response.statusText}. Verifica que GITHUB_ACCESS_TOKEN esté configurado correctamente para repositorios privados.`);
            }
            throw new Error(`Error al descargar artefacto: ${response.statusText}`);
        }

        // Crear directorio temporal
        const tempDir = path.join(__dirname, 'temp');
        await fs.mkdir(tempDir, { recursive: true });
        
        const tempFile = path.join(tempDir, 'artifact.zip');
        
        // Guardar el archivo
        const buffer = await response.buffer();
        await fs.writeFile(tempFile, buffer);

        // Crear directorio de destino si no existe
        await fs.mkdir(destinationPath, { recursive: true });

        // Extraer el archivo (asumiendo que es un ZIP)
        await execAsync(`powershell -Command "Expand-Archive -Path '${tempFile}' -DestinationPath '${destinationPath}' -Force"`);

        // Limpiar archivo temporal
        await fs.unlink(tempFile);
        await fs.rmdir(tempDir);

        console.log(`Artefacto extraído exitosamente en: ${destinationPath}`);
        return true;
    } catch (error) {
        console.error('Error al descargar y extraer artefacto:', error);
        throw error;
    }
}

// Función para clonar repositorio y configurar backend
async function deployBackend(environment, projectUrl) {
    try {
        const deployPath = environment === 'tst' 
            ? process.env.DEPLOY_BACKEND_PATH_TST 
            : process.env.DEPLOY_BACKEND_PATH_PRD;

        if (!deployPath) {
            throw new Error(`Variable de entorno DEPLOY_BACKEND_PATH_${environment.toUpperCase()} no configurada`);
        }

        console.log(`Desplegando backend en ambiente: ${environment}`);
        console.log(`Ruta de despliegue: ${deployPath}`);

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
            
            // Clonar monorepo en directorio temporal
            console.log(`Clonando monorepo en directorio temporal: ${tempDir}`);
            await execAsync(`git clone ${cloneUrl} "${tempDir}"`);

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

            // Reiniciar proceso con PM2
            const processName = environment === 'tst' ? 'tst_backend' : 'prd_backend';
            
            const pm2Result = await new Promise((resolve, reject) => {
                pm2.connect((err) => {
                    if (err) {
                        console.error('Error conectando a PM2:', err);
                        reject(err);
                        return;
                    }

                    pm2.restart(processName, (err) => {
                        pm2.disconnect();
                        
                        if (err) {
                            console.error(`Error reiniciando proceso ${processName}:`, err);
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
        console.error('Error en despliegue de backend:', error);
        throw error;
    }
}

// Ruta para despliegue de frontend
app.post('/frontend', async (req, res) => {
    try {
        const { environment, artifact_url, token } = req.body;

        // Validar token
        if (!validateToken(token)) {
            return res.status(401).json({ error: 'Token de autorización inválido' });
        }

        // Validar parámetros requeridos
        if (!environment || !artifact_url) {
            return res.status(400).json({ error: 'Parámetros environment y artifact_url son requeridos' });
        }

        // Validar ambiente
        if (!['tst', 'prd'].includes(environment)) {
            return res.status(400).json({ error: 'Environment debe ser "tst" o "prd"' });
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

        // Descargar y extraer artefacto
        await downloadAndExtractArtifact(artifact_url, deployPath);

        res.json({ 
            success: true, 
            message: `Frontend desplegado exitosamente en ambiente ${environment}`,
            path: deployPath
        });

    } catch (error) {
        console.error('Error en despliegue de frontend:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor', 
            details: error.message 
        });
    }
});

// Ruta para despliegue de backend
app.post('/backend', async (req, res) => {
    try {
        const { environment, project_url, token } = req.body;

        // Validar token
        if (!validateToken(token)) {
            return res.status(401).json({ error: 'Token de autorización inválido' });
        }

        // Validar parámetros requeridos
        if (!environment || !project_url) {
            return res.status(400).json({ error: 'Parámetros environment y project_url son requeridos' });
        }

        // Validar ambiente
        if (!['tst', 'prd'].includes(environment)) {
            return res.status(400).json({ error: 'Environment debe ser "tst" o "prd"' });
        }

        // Desplegar backend
        await deployBackend(environment, project_url);

        res.json({ 
            success: true, 
            message: `Backend desplegado exitosamente en ambiente ${environment}` 
        });

    } catch (error) {
        console.error('Error en despliegue de backend:', error);
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
    console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promesa rechazada no manejada:', reason);
});