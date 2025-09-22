import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

async function checkPermissions() {
    const token = process.env.GITHUB_ACCESS_TOKEN;
    
    if (!token) {
        console.error('Error: GITHUB_ACCESS_TOKEN no está configurado');
        return;
    }

    const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Deploy-Webhook-Checker'
    };

    try {
        console.log('Verificando permisos específicos del token...\n');

        // Verificar permisos del token
        console.log('1. Verificando permisos del token:');
        const userResponse = await fetch('https://api.github.com/user', { headers });
        
        if (userResponse.ok) {
            const scopes = userResponse.headers.get('x-oauth-scopes');
            const acceptedScopes = userResponse.headers.get('x-accepted-oauth-scopes');
            
            console.log(`   Permisos actuales: ${scopes || 'No disponible (Fine-grained token)'}`);
            console.log(`   Permisos aceptados: ${acceptedScopes || 'No disponible'}`);
        }

        // Probar acceso específico a Actions
        console.log('\n2. Probando acceso a GitHub Actions:');
        const repo = 'mieldesanpedro/monorepo';
        
        // Intentar listar workflow runs
        const workflowsResponse = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=1`, { headers });
        console.log(`   Acceso a workflow runs: ${workflowsResponse.status === 200 ? 'SI' : 'NO'} (${workflowsResponse.status})`);
        
        // Intentar listar artefactos
        const artifactsResponse = await fetch(`https://api.github.com/repos/${repo}/actions/artifacts?per_page=1`, { headers });
        console.log(`   Acceso a artefactos: ${artifactsResponse.status === 200 ? 'SI' : 'NO'} (${artifactsResponse.status})`);
        
        if (artifactsResponse.status === 403) {
            console.log('   Error 403: Permisos insuficientes para acceder a artefactos');
        }

        // Verificar otros endpoints relacionados
        console.log('\n3. Verificando otros accesos necesarios:');
        
        const contentsResponse = await fetch(`https://api.github.com/repos/${repo}/contents`, { headers });
        console.log(`   Acceso a contenidos: ${contentsResponse.status === 200 ? 'SI' : 'NO'} (${contentsResponse.status})`);
        
        const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, { headers });
        console.log(`   Acceso a metadatos del repo: ${repoResponse.status === 200 ? 'SI' : 'NO'} (${repoResponse.status})`);

        console.log('\n4. Permisos necesarios para Fine-grained tokens:');
        console.log('   Para acceder a GitHub Actions y artefactos necesitas:');
        console.log('   - Actions: Read (para leer workflow runs y artefactos)');
        console.log('   - Contents: Read (para acceder al contenido del repositorio)');
        console.log('   - Metadata: Read (para leer metadatos del repositorio)');
        console.log('   - Pull requests: Read (si el webhook maneja PRs)');
        
        console.log('\n5. Configuración en GitHub:');
        console.log('   1. Ve a: https://github.com/settings/personal-access-tokens/fine-grained');
        console.log('   2. Encuentra tu token y haz clic en "Edit"');
        console.log('   3. En "Repository permissions" asegúrate de tener:');
        console.log('      - Actions: Read');
        console.log('      - Contents: Read');
        console.log('      - Metadata: Read');
        console.log('   4. Guarda los cambios');

    } catch (error) {
        console.error('Error durante la verificación:', error.message);
    }
}

// Ejecutar verificación
checkPermissions();